import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail, getUserId } from '@/lib/auth';
import {
  addActivityLog,
  createTrade,
  getBotConfig,
  getOrCreateUser,
  BotConfig,
  Trade as DbTrade,
} from '@/lib/db';
import { placeOrder } from '@/lib/bybit';

const CreateTradeSchema = z.object({
  symbol: z.string(),
  side: z.enum(['LONG', 'SHORT']),
  entry: z.number().positive(),
  tp: z.number().positive(),
  sl: z.number().positive(),
  positionSize: z.number().nonnegative(),
  leverage: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
});

type CreateTradePayload = z.infer<typeof CreateTradeSchema>;

function serializeTrade(record: DbTrade): {
  id: string;
  time: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  initialSl: number;
  reason: string;
  status: DbTrade['status'];
  symbol: string;
  leverage: number;
  positionSize: number;
  exitPrice?: number;
} {
  return {
    id: record.id,
    time: record.entry_time.toISOString(),
    side: record.side,
    entry: Number(record.entry_price),
    tp: Number(record.tp_price),
    sl: Number(record.current_sl ?? record.sl_price),
    initialSl: Number(record.sl_price),
    reason: record.reason || '',
    status: record.status,
    symbol: record.symbol,
    leverage: Number(record.leverage),
    positionSize: Number(record.position_size),
    exitPrice: record.exit_price !== null ? Number(record.exit_price) : undefined,
  };
}

async function ensureUserAndConfig(): Promise<{ userId: string; email: string; botConfig: BotConfig }> {
  const authId = await getUserId();
  const email = await getUserEmail();

  if (!authId || !email) {
    throw new Error('Unauthorized');
  }

  const user = await getOrCreateUser(email, authId);
  const botConfig = await getBotConfig(user.id);

  if (!botConfig) {
    throw new Error('Bot configuration not found');
  }

  return { userId: user.id, email, botConfig };
}

export async function POST(request: NextRequest) {
  try {
    const { userId, botConfig } = await ensureUserAndConfig();

    const payloadJson = await request.json();
    const payload: CreateTradePayload = CreateTradeSchema.parse(payloadJson);

    const now = new Date();
    const leverage = payload.leverage ?? botConfig.leverage;

    const tradeRecord = await createTrade({
      user_id: userId,
      bot_config_id: botConfig.id,
      symbol: payload.symbol,
      side: payload.side,
      status: 'open',
      entry_price: payload.entry,
      tp_price: payload.tp,
      sl_price: payload.sl,
      current_sl: payload.sl,
      exit_price: null,
      position_size: payload.positionSize,
      leverage,
      pnl: 0,
      reason: payload.reason || null,
      entry_time: now,
      exit_time: null,
    });

    await addActivityLog(
      userId,
      'success',
      `Trade opened: ${payload.side} @ $${payload.entry.toFixed(2)}, TP $${payload.tp.toFixed(2)}, SL $${payload.sl.toFixed(2)}`,
      {
        symbol: payload.symbol,
        positionSize: payload.positionSize,
        leverage,
      },
      botConfig.id
    );

    let orderResult: any = null;
    const orderQty = Math.max(0, Number(payload.positionSize));
    if (botConfig.api_key && botConfig.api_secret && orderQty > 0) {
      try {
        orderResult = await placeOrder({
          symbol: payload.symbol,
          side: payload.side === 'LONG' ? 'Buy' : 'Sell',
          qty: orderQty,
          price: payload.entry,
          testnet: botConfig.api_mode !== 'live',
          apiKey: botConfig.api_key,
          apiSecret: botConfig.api_secret,
        });

        await addActivityLog(
          userId,
          'success',
          `Order sent to Bybit (${botConfig.api_mode.toUpperCase()}): ${payload.side} ${payload.symbol} qty ${payload.positionSize}`,
          { orderResult },
          botConfig.id
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error placing order';
        await addActivityLog(
          userId,
          'error',
          `Bybit order failed: ${message}`,
          { symbol: payload.symbol, side: payload.side, qty: payload.positionSize },
          botConfig.id
        );
      }
    }

    return NextResponse.json({
      success: true,
      trade: serializeTrade(tradeRecord),
      orderResult,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (error instanceof Error && error.message === 'Bot configuration not found') {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }

    console.error('Error creating trade:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create trade' },
      { status: 500 }
    );
  }
}

