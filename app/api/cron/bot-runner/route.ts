import { NextRequest, NextResponse } from 'next/server';
import { 
  getRunningBots, 
  getOpenTrades, 
  createTrade, 
  updateTrade, 
  closeTrade,
  addActivityLog,
  updateLastPolled,
  updateDailyPnL,
  resetDailyPnL,
  getUserByEmail,
  getOrCreateUser
} from '@/lib/db';
import { applyBreakeven } from '@/lib/strategy';
import { confirmLevelTouch } from '@/lib/orderbook';
import type { Candle } from '@/lib/types';

/**
 * Cron job endpoint that runs trading bots in the background
 * 
 * Setup in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/bot-runner",
 *     "schedule": "* * * * *"  // Every minute
 *   }]
 * }
 * 
 * To test locally: POST http://localhost:3000/api/cron/bot-runner
 * with header: Authorization: Bearer YOUR_CRON_SECRET
 */

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[CRON] Bot runner started at', new Date().toISOString());

    // Reset daily P&L if new day
    await resetDailyPnL();

    // Get all running bots
    const runningBots = await getRunningBots();
    console.log(`[CRON] Found ${runningBots.length} running bot(s)`);

    if (runningBots.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No running bots',
        processed: 0 
      });
    }

    const results = await Promise.allSettled(
      runningBots.map(async (botConfig) => {
        try {
          console.log(`[CRON] Processing bot for user ${botConfig.user_id}, symbol ${botConfig.symbol}`);
          
          // Check daily limits
          const dailyTargetValue = botConfig.daily_target_type === 'percent'
            ? (botConfig.capital * botConfig.daily_target_amount) / 100
            : botConfig.daily_target_amount;

          const dailyStopValue = botConfig.daily_stop_type === 'percent'
            ? (botConfig.capital * botConfig.daily_stop_amount) / 100
            : botConfig.daily_stop_amount;

          const isDailyTargetHit = botConfig.daily_pnl >= dailyTargetValue && dailyTargetValue > 0;
          const isDailyStopHit = botConfig.daily_pnl <= -dailyStopValue && dailyStopValue > 0;

          if (isDailyTargetHit || isDailyStopHit) {
            const reason = isDailyTargetHit ? 'Daily target reached' : 'Daily stop loss hit';
            await addActivityLog(botConfig.user_id, 'warning', `Bot auto-stopped: ${reason}`, null, botConfig.id);
            // Stop the bot by updating is_running to false
            await updateLastPolled(botConfig.id);
            console.log(`[CRON] Bot ${botConfig.id} stopped: ${reason}`);
            return { userId: botConfig.user_id, status: 'stopped', reason };
          }

          // Fetch current market data
          const klinesRes = await fetch(
            `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/klines?symbol=${botConfig.symbol}&interval=${botConfig.candle_interval}&limit=200&testnet=false`
          );

          if (!klinesRes.ok) {
            throw new Error('Failed to fetch klines');
          }

          const candles: Candle[] = await klinesRes.json();
          if (!candles || candles.length === 0) {
            throw new Error('No candles received');
          }

          const lastClose = candles[candles.length - 1].close;

          // Fetch levels (includes VWAP and k%)
          const levelsRes = await fetch(
            `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/levels`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol: botConfig.symbol,
                subdivisions: botConfig.subdivisions,
                testnet: false,
                ...(botConfig.garch_mode === 'custom' && { customKPct: botConfig.custom_k_pct }),
              }),
            }
          );

          if (!levelsRes.ok) {
            throw new Error('Failed to fetch levels');
          }

          const levels = await levelsRes.json();

          // Apply breakeven to open trades
          const openTrades = await getOpenTrades(botConfig.user_id, botConfig.id);
          for (const trade of openTrades) {
            const newSL = applyBreakeven(
              trade.side as 'LONG' | 'SHORT',
              Number(trade.entry_price),
              Number(trade.current_sl),
              lastClose,
              levels.vwap
            );
            
            if (newSL !== Number(trade.current_sl)) {
              await updateTrade(trade.id, { current_sl: newSL } as any);
              await addActivityLog(
                botConfig.user_id,
                'success',
                `Breakeven applied: ${trade.side} @ $${trade.entry_price}, SL → $${newSL.toFixed(2)}`,
                null,
                botConfig.id
              );
            }

            // Check if TP or SL hit
            const lastCandle = candles[candles.length - 1];
            let hitTP = false;
            let hitSL = false;
            let exitPrice: number | null = null;

            if (trade.side === 'LONG') {
              if (lastCandle.high >= Number(trade.tp_price)) {
                hitTP = true;
                exitPrice = Number(trade.tp_price);
              } else if (lastCandle.low <= newSL) {
                hitSL = true;
                exitPrice = newSL;
              }
            } else {
              if (lastCandle.low <= Number(trade.tp_price)) {
                hitTP = true;
                exitPrice = Number(trade.tp_price);
              } else if (lastCandle.high >= newSL) {
                hitSL = true;
                exitPrice = newSL;
              }
            }

            if (hitTP || hitSL) {
              const pnl = trade.side === 'LONG'
                ? (exitPrice! - Number(trade.entry_price)) * Number(trade.position_size)
                : (Number(trade.entry_price) - exitPrice!) * Number(trade.position_size);

              await closeTrade(trade.id, hitTP ? 'tp' : 'sl', exitPrice!, pnl);
              await updateDailyPnL(botConfig.user_id, pnl);
              
              const logLevel = hitTP ? 'success' : 'error';
              const logMsg = hitTP 
                ? `Take profit hit: ${trade.side} @ $${trade.entry_price} → $${exitPrice!.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`
                : `Stop loss hit: ${trade.side} @ $${trade.entry_price} → $${exitPrice!.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`;
              
              await addActivityLog(botConfig.user_id, logLevel, logMsg, null, botConfig.id);
            }
          }

          // Calculate signal
          const signalRes = await fetch(
            `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/signal`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol: botConfig.symbol,
                kPct: levels.kPct,
                subdivisions: botConfig.subdivisions,
                noTradeBandPct: botConfig.no_trade_band_pct,
                candles,
              }),
            }
          );

          const signal = await signalRes.json();

          // Check for new trade signal
          if (signal.signal && signal.touchedLevel) {
            const openTradesCount = openTrades.length;

            if (openTradesCount < botConfig.max_trades) {
              // Check for duplicate trade
              const isDuplicate = openTrades.some(
                (t) =>
                  t.symbol === botConfig.symbol &&
                  t.side === signal.signal &&
                  Math.abs(Number(t.entry_price) - signal.touchedLevel) < 0.01
              );

              if (!isDuplicate) {
                // Optional: Order book confirmation
                let approved = true;
                if (botConfig.use_orderbook_confirm) {
                  try {
                    approved = await confirmLevelTouch({
                      symbol: botConfig.symbol,
                      level: signal.touchedLevel,
                      side: signal.signal,
                      windowMs: 8000,
                      minNotional: 50000,
                      proximityBps: 5,
                    });
                  } catch (err) {
                    console.error('Order book confirmation error:', err);
                    approved = false;
                  }
                }

                if (approved) {
                  // Calculate position size
                  const riskPerTrade = botConfig.risk_type === 'percent'
                    ? (botConfig.capital * botConfig.risk_amount) / 100
                    : botConfig.risk_amount;

                  const stopLossDistance = Math.abs(signal.touchedLevel - signal.sl);
                  const positionSize = stopLossDistance > 0 ? riskPerTrade / stopLossDistance : 0;

                  // Create trade
                  await createTrade({
                    user_id: botConfig.user_id,
                    bot_config_id: botConfig.id,
                    symbol: botConfig.symbol,
                    side: signal.signal,
                    status: 'open',
                    entry_price: signal.touchedLevel,
                    tp_price: signal.tp,
                    sl_price: signal.sl,
                    current_sl: signal.sl,
                    exit_price: null,
                    position_size: positionSize,
                    leverage: botConfig.leverage,
                    pnl: 0,
                    reason: signal.reason,
                    entry_time: new Date(),
                    exit_time: null,
                  });

                  await addActivityLog(
                    botConfig.user_id,
                    'success',
                    `Trade opened: ${signal.signal} @ $${signal.touchedLevel.toFixed(2)}, TP: $${signal.tp.toFixed(2)}, SL: $${signal.sl.toFixed(2)}`,
                    { signal, positionSize },
                    botConfig.id
                  );
                }
              }
            }
          }

          // Update last polled timestamp
          await updateLastPolled(botConfig.id);

          return { userId: botConfig.user_id, status: 'success' };
        } catch (error) {
          console.error(`[CRON] Error processing bot ${botConfig.id}:`, error);
          await addActivityLog(
            botConfig.user_id,
            'error',
            `Bot processing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            null,
            botConfig.id
          );
          return { userId: botConfig.user_id, status: 'error', error: String(error) };
        }
      })
    );

    const summary = {
      success: true,
      processed: results.length,
      successful: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
      timestamp: new Date().toISOString(),
    };

    console.log('[CRON] Bot runner completed:', summary);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[CRON] Fatal error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

// Allow GET for testing (remove in production)
export async function GET(request: NextRequest) {
  return POST(request);
}
