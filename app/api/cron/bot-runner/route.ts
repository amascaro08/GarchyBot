import { NextRequest, NextResponse } from 'next/server';
import {
  getRunningBots,
  getOpenTrades,
  getPendingTrades,
  getExpiredPendingTrades,
  createTrade,
  closeTrade,
  addActivityLog,
  updateLastPolled,
  updateDailyPnL,
  resetDailyPnL,
  getUserByEmail,
  getOrCreateUser,
  getDailyLevels,
  checkPhase2Completed,
  updateTrade,
} from '@/lib/db';
import { computeTrailingBreakeven } from '@/lib/strategy';
import { placeOrder, cancelOrder } from '@/lib/bybit';
import { confirmLevelTouch } from '@/lib/orderbook';
import type { Candle } from '@/lib/types';

const NO_TRADE_BAND_PCT = 0.001;

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

    // Build base URL for internal API calls
    // On Vercel, VERCEL_URL doesn't include protocol, so we need to add https://
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';

    // Reset daily P&L if new day
    await resetDailyPnL();

    // Cancel expired pending orders (older than 1 hour)
    try {
      const expiredTrades = await getExpiredPendingTrades(1);
      console.log(`[CRON] Found ${expiredTrades.length} expired pending orders to cancel`);
      
      for (const trade of expiredTrades) {
        if (!trade.order_id || !trade.api_key || !trade.api_secret) {
          continue;
        }

        try {
          await cancelOrder({
            symbol: trade.symbol,
            orderId: trade.order_id,
            testnet: trade.api_mode !== 'live',
            apiKey: trade.api_key,
            apiSecret: trade.api_secret,
          });

          // Update trade status to cancelled
          await updateTrade(trade.id, {
            status: 'cancelled',
            exit_time: new Date(),
          } as any);

          await addActivityLog(
            trade.user_id,
            'warning',
            `Order expired and cancelled: ${trade.side} ${trade.symbol} @ $${Number(trade.entry_price).toFixed(2)} (Order ID: ${trade.order_id})`,
            { orderId: trade.order_id, expiryHours: 1 },
            trade.bot_config_id
          );

          console.log(`[CRON] Cancelled expired order ${trade.order_id} for trade ${trade.id}`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[CRON] Failed to cancel expired order ${trade.order_id}:`, errorMsg);
          
          // Try to update trade status anyway in case order was already cancelled
          try {
            await updateTrade(trade.id, {
              status: 'cancelled',
              exit_time: new Date(),
            } as any);
          } catch (updateError) {
            console.error(`[CRON] Failed to update trade ${trade.id} status:`, updateError);
          }
        }
      }
    } catch (error) {
      console.error('[CRON] Error processing expired orders:', error);
      // Continue with normal bot processing even if expiry check fails
    }

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
          console.log(`[CRON] Bot settings - GARCH mode: ${botConfig.garch_mode}, custom k%: ${botConfig.custom_k_pct}, subdivisions: ${botConfig.subdivisions}, risk: ${botConfig.risk_amount} (${botConfig.risk_type}), capital: ${botConfig.capital}, daily open entries: ${botConfig.use_daily_open_entry ? 'ENABLED' : 'DISABLED'}`);
          
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
            `${baseUrl}/api/klines?symbol=${botConfig.symbol}&interval=${botConfig.candle_interval}&limit=200&testnet=false`
          );

          if (!klinesRes.ok) {
            throw new Error('Failed to fetch klines');
          }

          const candles: Candle[] = await klinesRes.json();
          if (!candles || candles.length === 0) {
            throw new Error('No candles received');
          }

          const lastClose = candles[candles.length - 1].close;

          // Check if Phase 2 is completed for this symbol
          const phase2Completed = await checkPhase2Completed(botConfig.symbol);
          if (!phase2Completed) {
            console.warn(`[CRON] Phase 2 not completed for ${botConfig.symbol}, skipping bot execution`);
            await addActivityLog(botConfig.user_id, 'warning', `Bot execution skipped - Phase 2 not completed for ${botConfig.symbol}`, null, botConfig.id);
            await updateLastPolled(botConfig.id);
            return { userId: botConfig.user_id, status: 'skipped', reason: 'Phase 2 not completed' };
          }

          // Fetch stored daily levels from database
          const storedLevels = await getDailyLevels(botConfig.symbol);
          if (!storedLevels) {
            console.error(`[CRON] No stored levels found for ${botConfig.symbol}`);
            await addActivityLog(botConfig.user_id, 'error', `No stored levels found for ${botConfig.symbol}`, null, botConfig.id);
            await updateLastPolled(botConfig.id);
            return { userId: botConfig.user_id, status: 'error', error: 'No stored levels found' };
          }

          console.log(`[CRON] Using stored levels for ${botConfig.symbol}:`);
          console.log(`  Daily Open: ${storedLevels.daily_open_price.toFixed(2)}`);
          console.log(`  Upper Range: ${storedLevels.upper_range.toFixed(2)}`);
          console.log(`  Lower Range: ${storedLevels.lower_range.toFixed(2)}`);
          console.log(`  Grid Levels - Up: ${storedLevels.up_levels.length}, Down: ${storedLevels.dn_levels.length}`);

          // Fetch current VWAP for signal calculation
          const vwapRes = await fetch(
            `${baseUrl}/api/levels`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol: botConfig.symbol,
                subdivisions: botConfig.subdivisions,
                testnet: false,
                // Use stored volatility for consistency
                customKPct: storedLevels.calculated_volatility,
              }),
            }
          );

          if (!vwapRes.ok) {
            throw new Error('Failed to fetch VWAP data');
          }

          const vwapData = await vwapRes.json();
          console.log(`[CRON] VWAP calculated: ${vwapData.vwap.toFixed(2)}`);

          // Combine stored levels with current VWAP
          const levels = {
            ...storedLevels,
            vwap: vwapData.vwap,
            vwapLine: vwapData.vwapLine,
            kPct: storedLevels.calculated_volatility,
            dOpen: storedLevels.daily_open_price,
            upper: storedLevels.upper_range,
            lower: storedLevels.lower_range,
            upLevels: storedLevels.up_levels,
            dnLevels: storedLevels.dn_levels,
          };

          const lastCandle = candles[candles.length - 1];
          const pendingTrades = await getPendingTrades(botConfig.user_id, botConfig.id);
          const nowMs = Date.now();
          const pendingDelayMs = 5000;

          for (const trade of pendingTrades) {
            const entryPrice = Number(trade.entry_price);
            const placedAtMs = trade.entry_time ? new Date(trade.entry_time).getTime() : nowMs;
            if (nowMs - placedAtMs < pendingDelayMs) {
              continue;
            }

            const biasBuffer = Math.abs(levels.vwap) * NO_TRADE_BAND_PCT;
            const biasValid = trade.side === 'LONG'
              ? lastClose > levels.vwap + biasBuffer
              : lastClose < levels.vwap - biasBuffer;

            if (!biasValid) {
              continue;
            }

            const retest = trade.side === 'LONG'
              ? lastCandle.low <= entryPrice
              : lastCandle.high >= entryPrice;

            if (retest) {
              await updateTrade(trade.id, {
                status: 'open',
                entry_time: new Date(),
                entry_price: entryPrice,
              } as any);

              await addActivityLog(
                botConfig.user_id,
                'success',
                `Limit order filled: ${trade.side} ${trade.symbol} @ $${entryPrice.toFixed(2)}`,
                null,
                botConfig.id
              );
            }
          }

          // Check for immediate bias change closure first
          const openTrades = await getOpenTrades(botConfig.user_id, botConfig.id);
          for (const trade of openTrades) {
            const entryPrice = Number(trade.entry_price);
            const tpPrice = Number(trade.tp_price);
            const initialSl = Number(trade.sl_price);
            const currentSl = Number(trade.current_sl ?? trade.sl_price);
            const positionSize = Number(trade.position_size);

            const trailingSl = computeTrailingBreakeven(
              trade.side as 'LONG' | 'SHORT',
              entryPrice,
              initialSl,
              currentSl,
              lastClose
            );

            if (trailingSl !== null) {
              await updateTrade(trade.id, { current_sl: trailingSl } as any);
              await addActivityLog(
                botConfig.user_id,
                'info',
                `Stop moved: ${trade.side} ${trade.symbol} SL → $${trailingSl.toFixed(2)}`,
                null,
                botConfig.id
              );
              continue;
            }

            const lastCandle = candles[candles.length - 1];
            let exitPrice = lastClose;
            let hitTP = false;
            let hitSL = false;

            if (trade.side === 'LONG') {
              if (lastCandle.high >= tpPrice) {
                hitTP = true;
                exitPrice = tpPrice;
              } else if (lastCandle.low <= currentSl) {
                hitSL = true;
                exitPrice = currentSl;
              }
            } else {
              if (lastCandle.low <= tpPrice) {
                hitTP = true;
                exitPrice = tpPrice;
              } else if (lastCandle.high >= currentSl) {
                hitSL = true;
                exitPrice = currentSl;
              }
            }

            if (hitTP || hitSL) {
              const pnl =
                trade.side === 'LONG'
                  ? (exitPrice - entryPrice) * positionSize
                  : (entryPrice - exitPrice) * positionSize;

              await closeTrade(trade.id, hitTP ? 'tp' : 'sl', exitPrice, pnl);
              await updateDailyPnL(botConfig.user_id, pnl);

              const logLevel = hitTP ? 'success' : 'error';
              const logMsg = hitTP
                ? `Take profit hit: ${trade.side} @ $${entryPrice} → $${exitPrice.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`
                : `Stop loss hit: ${trade.side} @ $${entryPrice} → $${exitPrice.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`;

              await addActivityLog(botConfig.user_id, logLevel, logMsg, null, botConfig.id);
            }
          }

          // Calculate signal using stored levels and current candles
          const signalRes = await fetch(
            `${baseUrl}/api/signal`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol: botConfig.symbol,
                kPct: levels.kPct,
                subdivisions: botConfig.subdivisions,
                noTradeBandPct: botConfig.no_trade_band_pct,
                useDailyOpenEntry: botConfig.use_daily_open_entry,
                candles,
                // Pass stored levels directly to avoid recalculation
                dOpen: levels.dOpen,
                upperLevels: levels.upLevels,
                lowerLevels: levels.dnLevels,
                vwap: levels.vwap,
              }),
            }
          );

          const signal = await signalRes.json();

          // Log if signal is detected
          if (signal.signal) {
            console.log(`[CRON] Signal detected - ${signal.signal} at ${signal.touchedLevel?.toFixed(2)}, Reason: ${signal.reason}`);
            
            // Check if this is a daily open entry
            if (signal.reason && signal.reason.includes('daily open')) {
              console.log(`[CRON] ✓ Daily open entry detected! Price touched ${signal.touchedLevel?.toFixed(2)}`);
            }
          }

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
                // Mandatory: Order book confirmation
                // Rules: The bot must scan the Level 2 Order Book at that exact level and see:
                // - LONG: significant increase in buy-side limit orders (buy wall) OR rapid execution of sell orders
                // - SHORT: significant increase in sell-side limit orders (sell wall) OR rapid execution of buy orders
                let approved = false;
                try {
                  approved = await confirmLevelTouch({
                    symbol: botConfig.symbol,
                    level: signal.touchedLevel,
                    side: signal.signal,
                    windowMs: 8000, // 8 second window to observe order book activity
                    minNotional: 50000, // Minimum $50k notional for wall detection
                    proximityBps: 5, // 0.05% proximity to level
                  });
                } catch (err) {
                  console.error('Order book confirmation error:', err);
                  approved = false;
                }

                if (approved) {
                  // Calculate position size based on risk management
                  // Rules: Risk amount per trade, with stop loss at next grid level
                  const riskPerTrade = botConfig.risk_type === 'percent'
                    ? (botConfig.capital * botConfig.risk_amount) / 100
                    : botConfig.risk_amount;

                  const stopLossDistance = Math.abs(signal.touchedLevel - signal.sl);
                  const rawPositionSize = stopLossDistance > 0 ? riskPerTrade / stopLossDistance : 0;
                  const positionSize = Number.isFinite(rawPositionSize) ? rawPositionSize : 0;
                  
                  if (positionSize <= 0) {
                    console.log('[CRON] Skipping trade - calculated position size <= 0');
                  } else {
                    console.log(`[CRON] New trade signal - ${signal.signal} @ ${signal.touchedLevel.toFixed(2)}, Risk: $${riskPerTrade.toFixed(2)}, Position size: ${positionSize.toFixed(4)}`);

                  const tradeRecord = await createTrade({
                      user_id: botConfig.user_id,
                      bot_config_id: botConfig.id,
                      symbol: botConfig.symbol,
                      side: signal.signal,
                      status: 'pending',
                      entry_price: signal.touchedLevel,
                      tp_price: signal.tp,
                      sl_price: signal.sl,
                      current_sl: signal.sl,
                      exit_price: null,
                      position_size: positionSize,
                      leverage: botConfig.leverage,
                      pnl: 0,
                      reason: signal.reason,
                      order_id: null, // Will be set after order is placed
                      entry_time: new Date(),
                      exit_time: null,
                    });

                  if (botConfig.api_key && botConfig.api_secret && positionSize > 0) {
                    const orderQty = Math.max(0, Number(positionSize));
                    try {
                      const orderResult = await placeOrder({
                        symbol: botConfig.symbol,
                        side: signal.signal === 'LONG' ? 'Buy' : 'Sell',
                        qty: orderQty,
                        price: signal.touchedLevel,
                        testnet: botConfig.api_mode !== 'live',
                        apiKey: botConfig.api_key,
                        apiSecret: botConfig.api_secret,
                        timeInForce: 'GoodTillCancel', // Changed from PostOnly to allow immediate execution
                      });

                      // Check if order was actually created successfully
                      if (orderResult?.retCode === 0 && orderResult?.result?.orderId) {
                        const orderId = orderResult.result.orderId;
                        await updateTrade(tradeRecord.id, {
                          status: 'open',
                          order_id: orderId,
                        } as any);

                        await addActivityLog(
                          botConfig.user_id,
                          'success',
                          `Limit order sent to Bybit (${botConfig.api_mode.toUpperCase()}): ${signal.signal} ${botConfig.symbol} qty ${orderQty.toFixed(4)}, Order ID: ${orderId}`,
                          { orderResult, orderId },
                          botConfig.id
                        );
                      } else {
                        // Order was rejected by Bybit
                        const errorMsg = orderResult?.retMsg || 'Unknown error';
                        const retCode = orderResult?.retCode || 'N/A';
                        throw new Error(`Bybit rejected order (retCode: ${retCode}): ${errorMsg}`);
                      }
                    } catch (error) {
                      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                      await addActivityLog(
                        botConfig.user_id,
                        'error',
                        `Bybit order failed: ${errorMsg}`,
                        { symbol: botConfig.symbol, side: signal.signal, qty: orderQty, error: errorMsg },
                        botConfig.id
                      );
                    }
                  }

                    await addActivityLog(
                      botConfig.user_id,
                      'success',
                      `Limit order placed: ${signal.signal} @ $${signal.touchedLevel.toFixed(2)}, TP: $${signal.tp.toFixed(2)}, SL: $${signal.sl.toFixed(2)}`,
                      { signal, positionSize },
                      botConfig.id
                    );
                  }
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
