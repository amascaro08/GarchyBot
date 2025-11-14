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
  updateTrade,
  Trade as DbTrade,
} from '@/lib/db';

const UpdateTradeSchema = z.object({
  status: z.enum(['tp', 'sl', 'breakeven', 'cancelled']),
  exitPrice: z.number().positive().optional(),
});

type UpdateTradePayload = z.infer<typeof UpdateTradeSchema>;

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

    if (trade.status === 'pending') {
      // Actually cancel the order on Bybit if we have API keys and order_id
      if (botConfig.api_key && botConfig.api_secret && trade.order_id) {
        try {
          const { cancelOrder } = await import('@/lib/bybit');
          await cancelOrder({
            symbol: trade.symbol,
            orderId: trade.order_id,
            testnet: botConfig.api_mode !== 'live',
            apiKey: botConfig.api_key,
            apiSecret: botConfig.api_secret,
          });
          console.log(`[TRADE] Order ${trade.order_id} cancelled on Bybit`);
          await addActivityLog(
            userId,
            'success',
            `Pending order cancelled on Bybit: ${trade.side} ${trade.symbol} @ $${Number(trade.entry_price).toFixed(2)}`,
            { orderId: trade.order_id },
            botConfig.id
          );
        } catch (cancelError) {
          const errorMsg = cancelError instanceof Error ? cancelError.message : 'Unknown error';
          console.error(`[TRADE] Failed to cancel order on Bybit:`, errorMsg);
          await addActivityLog(
            userId,
            'warning',
            `Failed to cancel order on Bybit (may already be filled/cancelled): ${errorMsg}`,
            { orderId: trade.order_id, error: errorMsg },
            botConfig.id
          );
          // Continue to update DB anyway - order might already be cancelled/filled
        }
      } else {
        await addActivityLog(
          userId,
          'warning',
          `Pending order cancelled (no API keys or order_id): ${trade.side} ${trade.symbol} @ $${Number(trade.entry_price).toFixed(2)}`,
          null,
          botConfig.id
        );
      }

      const updatedTrade = await updateTrade(trade.id, {
        status: 'cancelled',
        exit_time: new Date(),
      } as any);

      return NextResponse.json({
        success: true,
        trade: serializeTrade(updatedTrade),
        pnlChange: 0,
      });
    }

    if (trade.status !== 'open') {
      return NextResponse.json({ success: false, error: 'Trade already closed' }, { status: 400 });
    }

    // Actually close the position on Bybit if we have API keys
    let actualExitPrice = payload.exitPrice ?? Number(trade.entry_price);
    let actualPnl = 0;
    
    if (botConfig.api_key && botConfig.api_secret && botConfig.api_mode === 'live') {
      try {
        const { closePosition, fetchPosition } = await import('@/lib/bybit');
        
        // Close the position on Bybit
        const closeResult = await closePosition({
          symbol: trade.symbol,
          side: trade.side as 'LONG' | 'SHORT',
          testnet: false,
          apiKey: botConfig.api_key,
          apiSecret: botConfig.api_secret,
          positionIdx: 0,
        });
        
        // Get actual exit price from the close order
        if (closeResult?.result?.orderId) {
          // Wait a moment for order to fill, then get position to verify it's closed
          // For market orders, they should fill immediately
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          try {
            const positionData = await fetchPosition({
              symbol: trade.symbol,
              testnet: false,
              apiKey: botConfig.api_key,
              apiSecret: botConfig.api_secret,
              positionIdx: 0,
            });
            
            const position = positionData.result?.list?.find((p: any) => 
              p.symbol === trade.symbol.toUpperCase()
            );
            
            // If position is closed, try to get the actual fill price from order history
            // For now, use mark price or provided exit price
            if (!position || parseFloat(position.size || '0') === 0) {
              // Position closed successfully
              actualExitPrice = payload.exitPrice ?? parseFloat(position?.markPrice || trade.entry_price);
              actualPnl = calculatePnl(trade, actualExitPrice);
              console.log(`[TRADE] Position closed on Bybit. Exit price: ${actualExitPrice.toFixed(2)}, P&L: ${actualPnl.toFixed(2)}`);
            } else {
              throw new Error('Position still open after close attempt');
            }
          } catch (posError) {
            console.warn(`[TRADE] Could not verify position closure, using provided exit price`);
            actualPnl = calculatePnl(trade, actualExitPrice);
          }
        }
        
        await addActivityLog(
          userId,
          'success',
          `Position closed on Bybit: ${trade.side} ${trade.symbol} @ $${actualExitPrice.toFixed(2)}`,
          { orderId: closeResult?.result?.orderId, exitPrice: actualExitPrice },
          botConfig.id
        );
      } catch (closeError) {
        const errorMsg = closeError instanceof Error ? closeError.message : 'Unknown error';
        console.error(`[TRADE] Failed to close position on Bybit:`, errorMsg);
        await addActivityLog(
          userId,
          'error',
          `Failed to close position on Bybit: ${errorMsg}. Trade will be marked as closed in DB only.`,
          { error: errorMsg },
          botConfig.id
        );
        // Calculate P&L anyway so we can update DB
        actualPnl = calculatePnl(trade, actualExitPrice);
      }
    } else {
      // Demo mode or no API keys - just calculate P&L
      actualPnl = calculatePnl(trade, actualExitPrice);
    }

    const updatedTrade = await closeTrade(trade.id, payload.status, actualExitPrice, actualPnl);
    await updateDailyPnL(userId, actualPnl);

    let logLevel: 'success' | 'warning' | 'error' = 'success';
    if (payload.status === 'sl') logLevel = 'error';
    if (payload.status === 'breakeven' || payload.status === 'cancelled') logLevel = 'warning';

    const pnlFormatted = actualPnl >= 0 ? `+$${actualPnl.toFixed(2)}` : `-$${Math.abs(actualPnl).toFixed(2)}`;
    await addActivityLog(
      userId,
      logLevel,
      `Trade ${payload.status}: ${trade.side} @ $${Number(trade.entry_price).toFixed(2)} → $${actualExitPrice.toFixed(2)} (P&L: ${pnlFormatted})`,
      {
        symbol: trade.symbol,
        status: payload.status,
        exitPrice: actualExitPrice,
        pnl: actualPnl,
      },
      botConfig.id
    );

    return NextResponse.json({
      success: true,
      trade: serializeTrade(updatedTrade),
      pnlChange: actualPnl,
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

