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

const UpdateStopSchema = z.object({
  currentSl: z.number().positive(),
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
    pnl: record.pnl !== null && record.pnl !== undefined ? Number(record.pnl) : undefined,
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, botConfig } = await ensureUserContext();
    const payloadJson = await request.json();
    const payload = UpdateStopSchema.parse(payloadJson);

    const { id } = await context.params;
    const trade = await getTradeById(id);

    if (!trade || trade.user_id !== userId) {
      return NextResponse.json({ success: false, error: 'Trade not found' }, { status: 404 });
    }

    if (trade.status !== 'open') {
      return NextResponse.json({ success: false, error: 'Trade already closed' }, { status: 400 });
    }

    // Update stop loss on Bybit if API keys are available
    if (botConfig.api_key && botConfig.api_secret && trade.status === 'open') {
      try {
        const { setTakeProfitStopLoss, getInstrumentInfo, roundPrice } = await import('@/lib/bybit');
        
        // Round stop loss to match Bybit's tick size
        let roundedSL = payload.currentSl;
        try {
          const instrumentInfo = await getInstrumentInfo(trade.symbol, botConfig.api_mode !== 'live');
          if (instrumentInfo && instrumentInfo.tickSize) {
            roundedSL = roundPrice(payload.currentSl, instrumentInfo.tickSize);
            if (Math.abs(roundedSL - payload.currentSl) > 0.0001) {
              console.log(`[SL Update] Rounded SL from ${payload.currentSl.toFixed(8)} to ${roundedSL.toFixed(8)} to match tick size ${instrumentInfo.tickSize}`);
            }
          }
        } catch (priceRoundError) {
          console.warn(`[SL Update] Failed to round SL price, using original:`, priceRoundError);
        }
        
        await setTakeProfitStopLoss({
          symbol: trade.symbol,
          stopLoss: roundedSL,
          testnet: botConfig.api_mode !== 'live',
          apiKey: botConfig.api_key,
          apiSecret: botConfig.api_secret,
          positionIdx: 0,
        });
        
        console.log(`[SL Update] Stop loss updated on Bybit: ${trade.side} ${trade.symbol} SL → $${roundedSL.toFixed(2)}`);
      } catch (bybitError) {
        const errorMsg = bybitError instanceof Error ? bybitError.message : 'Unknown error';
        console.error(`[SL Update] Failed to update stop loss on Bybit:`, errorMsg);
        // Continue to update database even if Bybit update fails
        await addActivityLog(
          userId,
          'warning',
          `Stop loss updated in database but failed on Bybit: ${errorMsg}`,
          { tradeId: trade.id, newSl: payload.currentSl, error: errorMsg },
          botConfig.id
        );
      }
    }

    const updatedTrade = await updateTrade(trade.id, {
      current_sl: payload.currentSl,
    } as any);

    await addActivityLog(
      userId,
      'info',
      `Stop moved: ${trade.side} ${trade.symbol} SL → $${payload.currentSl.toFixed(2)}`,
      { tradeId: trade.id, previousSl: trade.current_sl, newSl: payload.currentSl },
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

    console.error('Error updating stop loss:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update stop loss' },
      { status: 500 }
    );
  }
}

