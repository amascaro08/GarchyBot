import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail, getUserId } from '@/lib/auth';
import {
  addActivityLog,
  closeTrade,
  getBotConfig,
  getOrCreateUser,
  getTradeById,
  updateDailyPnL,
  Trade as DbTrade,
} from '@/lib/db';

const UpdateTradeSchema = z.object({
  status: z.enum(['tp', 'sl', 'breakeven', 'cancelled']),
  exitPrice: z.number().positive(),
});

type UpdateTradePayload = z.infer<typeof UpdateTradeSchema>;

function serializeTrade(record: DbTrade) {
  return {
    id: record.id,
    time: record.entry_time.toISOString(),
    side: record.side,
    entry: Number(record.entry_price),
    tp: Number(record.tp_price),
    sl: Number(record.sl_price),
    reason: record.reason || '',
    status: record.status,
    symbol: record.symbol,
    leverage: Number(record.leverage),
    positionSize: Number(record.position_size),
    exitPrice: record.exit_price !== null ? Number(record.exit_price) : undefined,
  };
}

async function ensureUserContext() {
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

  return { userId: user.id, botConfig };
}

function calculatePnl(trade: DbTrade, exitPrice: number): number {
  const positionSize = Number(trade.position_size);
  const entry = Number(trade.entry_price);

  if (positionSize === 0) return 0;

  if (trade.side === 'LONG') {
    return (exitPrice - entry) * positionSize;
  }

  return (entry - exitPrice) * positionSize;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId, botConfig } = await ensureUserContext();
    const payloadJson = await request.json();
    const payload: UpdateTradePayload = UpdateTradeSchema.parse(payloadJson);

    const { id } = await context.params;
    const trade = await getTradeById(id);

    if (!trade || trade.user_id !== userId) {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }

    if (trade.status !== 'open') {
      return NextResponse.json({ success: false, error: 'Trade already closed' }, { status: 400 });
    }

    const exitPrice = payload.exitPrice;
    const pnl = calculatePnl(trade, exitPrice);
    const updatedTrade = await closeTrade(trade.id, payload.status, exitPrice, pnl);
    await updateDailyPnL(userId, pnl);

    let logLevel: 'success' | 'warning' | 'error' = 'success';
    if (payload.status === 'sl') logLevel = 'error';
    if (payload.status === 'breakeven' || payload.status === 'cancelled') logLevel = 'warning';

    const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    await addActivityLog(
      userId,
      logLevel,
      `Trade ${payload.status}: ${trade.side} @ $${Number(trade.entry_price).toFixed(2)} → $${exitPrice.toFixed(2)} (P&L: ${pnlFormatted})`,
      {
        symbol: trade.symbol,
        status: payload.status,
        exitPrice,
        pnl,
      },
      botConfig.id
    );

    return NextResponse.json({
      success: true,
      trade: serializeTrade(updatedTrade),
      pnlChange: pnl,
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

    console.error('Error updating trade:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update trade' },
      { status: 500 }
    );
  }
}

