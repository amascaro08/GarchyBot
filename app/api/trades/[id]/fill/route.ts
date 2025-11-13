import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserEmail, getUserId } from '@/lib/auth';
import {
  addActivityLog,
  getBotConfig,
  getOrCreateUser,
  getTradeById,
  updateTrade,
  Trade as DbTrade,
} from '@/lib/db';

const FillTradeSchema = z.object({
  fillPrice: z.number().positive().optional(),
});

function serializeTrade(record: DbTrade) {
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId, botConfig } = await ensureUserContext();
    const payloadJson = await request.json();
    const payload = FillTradeSchema.parse(payloadJson);

    const { id } = await context.params;
    const trade = await getTradeById(id);

    if (!trade || trade.user_id !== userId) {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }

    if (trade.status !== 'pending') {
      return NextResponse.json({ success: false, error: 'Trade is not pending' }, { status: 400 });
    }

    const fillPrice = payload.fillPrice ?? Number(trade.entry_price);

    const updatedTrade = await updateTrade(trade.id, {
      status: 'open',
      entry_price: fillPrice,
      entry_time: new Date(),
    } as any);

    await addActivityLog(
      userId,
      'success',
      `Limit order filled: ${trade.side} @ $${fillPrice.toFixed(2)}`,
      { tradeId: trade.id, fillPrice },
      botConfig.id
    );

    return NextResponse.json({
      success: true,
      trade: serializeTrade(updatedTrade),
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

    console.error('Error filling trade:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fill trade' },
      { status: 500 }
    );
  }
}

