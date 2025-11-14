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

          // Fetch real-time ticker data for faster signal detection
          let realtimePrice: number | undefined = undefined;
          try {
            const { getTicker } = await import('@/lib/bybit');
            const ticker = await getTicker(botConfig.symbol, botConfig.api_mode !== 'live');
            if (ticker && ticker.lastPrice > 0) {
              realtimePrice = ticker.lastPrice;
              console.log(`[CRON] Fetched real-time price for ${botConfig.symbol}: $${realtimePrice.toFixed(2)}`);
            }
          } catch (tickerError) {
            console.warn(`[CRON] Failed to fetch ticker for ${botConfig.symbol}, using candle close:`, tickerError);
            // Continue with candle data if ticker fetch fails
          }

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

          // Verify stored levels are for today (UTC)
          // Parse stored date string (format: YYYY-MM-DD) and compare with UTC today
          const storedDateStr = storedLevels.date; // Should be in YYYY-MM-DD format
          const nowUTC = new Date();
          const todayUTC = new Date(Date.UTC(
            nowUTC.getUTCFullYear(),
            nowUTC.getUTCMonth(),
            nowUTC.getUTCDate(),
            0, 0, 0, 0
          ));
          const todayUTCStr = todayUTC.toISOString().split('T')[0]; // YYYY-MM-DD in UTC
          
          if (storedDateStr !== todayUTCStr) {
            console.error(`[CRON] Stored levels for ${botConfig.symbol} are from ${storedDateStr} (UTC), but today is ${todayUTCStr} (UTC)!`);
            console.error(`[CRON] Current UTC time: ${nowUTC.toISOString()}`);
            await addActivityLog(
              botConfig.user_id,
              'warning',
              `Stored levels are stale (date: ${storedDateStr} UTC, today: ${todayUTCStr} UTC). Please run daily-setup cron.`,
              { storedDate: storedDateStr, todayUTC: todayUTCStr, currentUTC: nowUTC.toISOString() },
              botConfig.id
            );
            // Continue with stale levels but log warning - daily-setup should be run
          } else {
            console.log(`[CRON] ✓ Stored levels date matches today (UTC): ${storedDateStr}`);
          }

          console.log(`[CRON] Using stored levels for ${botConfig.symbol} (date: ${storedLevels.date}):`);
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
          // Ensure all values are properly converted to numbers/arrays
          const levels = {
            ...storedLevels,
            vwap: Number(vwapData.vwap),
            vwapLine: vwapData.vwapLine,
            kPct: Number(storedLevels.calculated_volatility),
            dOpen: Number(storedLevels.daily_open_price),
            upper: Number(storedLevels.upper_range),
            lower: Number(storedLevels.lower_range),
            upLevels: Array.isArray(storedLevels.up_levels) 
              ? storedLevels.up_levels.map((l: any) => Number(l))
              : [],
            dnLevels: Array.isArray(storedLevels.dn_levels)
              ? storedLevels.dn_levels.map((l: any) => Number(l))
              : [],
          };

          // Validate levels before using
          if (!levels.dOpen || !levels.vwap || levels.upLevels.length === 0 || levels.dnLevels.length === 0) {
            console.error(`[CRON] Invalid stored levels for ${botConfig.symbol}:`);
            console.error(`  dOpen: ${levels.dOpen}, vwap: ${levels.vwap}`);
            console.error(`  upLevels: ${levels.upLevels.length} levels, dnLevels: ${levels.dnLevels.length} levels`);
            throw new Error('Invalid stored levels - missing required values');
          }

          console.log(`[CRON] ✓ Validated stored levels for ${botConfig.symbol}:`);
          console.log(`  Daily Open: ${levels.dOpen.toFixed(2)}`);
          console.log(`  VWAP: ${levels.vwap.toFixed(2)}`);
          console.log(`  Upper Levels: ${levels.upLevels.map(l => l.toFixed(2)).join(', ')}`);
          console.log(`  Lower Levels: ${levels.dnLevels.map(l => l.toFixed(2)).join(', ')}`);

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

          // Get open trades first (used for both live and demo modes)
          const openTrades = await getOpenTrades(botConfig.user_id, botConfig.id);
          
          // Sync trades with Bybit's actual data (for live mode only)
          if (botConfig.api_mode === 'live' && botConfig.api_key && botConfig.api_secret) {
            const { fetchPosition, getOrderStatus } = await import('@/lib/bybit');
            
            for (const trade of openTrades) {
              try {
                // Check if trade has an order ID (pending or open)
                if (trade.order_id) {
                  // Check order status for pending trades
                  if (trade.status === 'pending') {
                    try {
                      const orderStatus = await getOrderStatus({
                        symbol: trade.symbol,
                        orderId: trade.order_id,
                        testnet: false,
                        apiKey: botConfig.api_key,
                        apiSecret: botConfig.api_secret,
                      });
                      
                      const order = orderStatus.result?.list?.[0];
                      if (order) {
                        const orderStatusStr = order.orderStatus?.toLowerCase();
                        if (orderStatusStr === 'filled') {
                          // Order was filled, update trade to open and set TP/SL on Bybit
                          const filledEntryPrice = parseFloat(order.avgPrice || order.price || trade.entry_price);
                          const filledQty = parseFloat(order.executedQty || trade.position_size);
                          
                          await updateTrade(trade.id, {
                            status: 'open',
                            entry_price: filledEntryPrice,
                            position_size: filledQty,
                          } as any);
                          
                          // Set TP/SL on Bybit now that we have an actual position
                          // Wait a small delay to ensure position is fully established on Bybit
                          if (trade.tp_price && trade.sl_price) {
                            try {
                              // Small delay to ensure position is established
                              await new Promise(resolve => setTimeout(resolve, 1000));
                              
                              const { setTakeProfitStopLoss } = await import('@/lib/bybit');
                              await setTakeProfitStopLoss({
                                symbol: trade.symbol,
                                takeProfit: Number(trade.tp_price),
                                stopLoss: Number(trade.current_sl ?? trade.sl_price),
                                testnet: false,
                                apiKey: botConfig.api_key,
                                apiSecret: botConfig.api_secret,
                                positionIdx: 0,
                              });
                              console.log(`[CRON] TP/SL set on Bybit after order fill: TP=$${Number(trade.tp_price).toFixed(2)}, SL=$${Number(trade.current_sl ?? trade.sl_price).toFixed(2)}`);
                              await addActivityLog(
                                botConfig.user_id,
                                'success',
                                `TP/SL set on Bybit: ${trade.side} ${trade.symbol} TP=$${Number(trade.tp_price).toFixed(2)}, SL=$${Number(trade.current_sl ?? trade.sl_price).toFixed(2)}`,
                                { orderId: trade.order_id, tp: Number(trade.tp_price), sl: Number(trade.current_sl ?? trade.sl_price) },
                                botConfig.id
                              );
                            } catch (tpSlError) {
                              console.error(`[CRON] Failed to set TP/SL after order fill:`, tpSlError);
                              await addActivityLog(
                                botConfig.user_id,
                                'warning',
                                `Failed to set TP/SL on Bybit after order fill for ${trade.side} ${trade.symbol}: ${tpSlError instanceof Error ? tpSlError.message : 'Unknown error'}. Will retry on next cron run.`,
                                { orderId: trade.order_id, error: tpSlError instanceof Error ? tpSlError.message : String(tpSlError) },
                                botConfig.id
                              );
                              // Don't fail the trade update - TP/SL will be retried on next cron run
                            }
                          }
                          
                          await addActivityLog(
                            botConfig.user_id,
                            'success',
                            `Order filled on Bybit: ${trade.side} ${trade.symbol} @ $${filledEntryPrice.toFixed(2)}, Position opened`,
                            { orderId: trade.order_id, filledQty, entryPrice: filledEntryPrice },
                            botConfig.id
                          );
                        } else if (orderStatusStr === 'cancelled' || orderStatusStr === 'rejected') {
                          // Order was cancelled/rejected, update trade
                          await updateTrade(trade.id, {
                            status: 'cancelled',
                            exit_time: new Date(),
                          } as any);
                          await addActivityLog(
                            botConfig.user_id,
                            'warning',
                            `Order ${orderStatusStr} on Bybit: ${trade.side} ${trade.symbol}`,
                            { orderId: trade.order_id, orderStatus: orderStatusStr },
                            botConfig.id
                          );
                        }
                      }
                    } catch (orderError) {
                      console.error(`[CRON] Error checking order status for trade ${trade.id}:`, orderError);
                    }
                  }
                  
                  // Check position status for open trades
                  if (trade.status === 'open') {
                    try {
                      const positionData = await fetchPosition({
                        symbol: trade.symbol,
                        testnet: false,
                        apiKey: botConfig.api_key,
                        apiSecret: botConfig.api_secret,
                        positionIdx: 0,
                      });
                      
                      const position = positionData.result?.list?.find((p: any) => 
                        p.symbol === trade.symbol.toUpperCase() && 
                        parseFloat(p.size || '0') !== 0
                      );
                      
                      if (!position || parseFloat(position.size || '0') === 0) {
                        // Position doesn't exist on Bybit - trade was closed
                        // Try to get the actual exit price and P&L from order history
                        try {
                          const orderStatus = await getOrderStatus({
                            symbol: trade.symbol,
                            orderId: trade.order_id,
                            testnet: false,
                            apiKey: botConfig.api_key,
                            apiSecret: botConfig.api_secret,
                          });
                          
                          // Look for closed orders - find orders that closed the position
                          const allOrders = orderStatus.result?.list || [];
                          // Find the most recent filled order that might be a close order
                          const closeOrder = allOrders.find((o: any) => 
                            o.orderStatus?.toLowerCase() === 'filled' &&
                            (o.side === (trade.side === 'LONG' ? 'Sell' : 'Buy')) // Opposite side = closing order
                          );
                          
                          // Calculate P&L from close order or use fallback
                          let exitPrice = parseFloat(closeOrder?.avgPrice || trade.entry_price);
                          const entryPrice = Number(trade.entry_price);
                          const positionSize = Number(trade.position_size);
                          let actualPnl = trade.side === 'LONG'
                            ? (exitPrice - entryPrice) * positionSize
                            : (entryPrice - exitPrice) * positionSize;
                          
                          // If no close order found, use mark price as fallback
                          if (!closeOrder) {
                            exitPrice = lastClose;
                            actualPnl = trade.side === 'LONG'
                              ? (exitPrice - entryPrice) * positionSize
                              : (entryPrice - exitPrice) * positionSize;
                          }
                          
                          // Determine if it was TP or SL based on exit price vs TP/SL levels
                          const tpPrice = Number(trade.tp_price);
                          const slPrice = Number(trade.current_sl ?? trade.sl_price);
                          const isTP = trade.side === 'LONG' 
                            ? exitPrice >= tpPrice * 0.99 // Within 1% of TP
                            : exitPrice <= tpPrice * 1.01;
                          const isSL = trade.side === 'LONG'
                            ? exitPrice <= slPrice * 1.01
                            : exitPrice >= slPrice * 0.99;
                          
                          const closeStatus = isTP ? 'tp' : (isSL ? 'sl' : 'tp'); // Default to TP if unclear
                          
                          await closeTrade(trade.id, closeStatus, exitPrice, actualPnl);
                          await updateDailyPnL(botConfig.user_id, actualPnl);
                          await addActivityLog(
                            botConfig.user_id,
                            'success',
                            `Position closed on Bybit: ${trade.side} ${trade.symbol} @ $${exitPrice.toFixed(2)} (P&L: ${actualPnl >= 0 ? '+' : ''}$${actualPnl.toFixed(2)})`,
                            { orderId: trade.order_id, exitPrice, pnl: actualPnl, closeStatus },
                            botConfig.id
                          );
                        } catch (err) {
                          console.error(`[CRON] Error checking closed order for trade ${trade.id}:`, err);
                          // Mark as cancelled if we can't determine what happened
                          await updateTrade(trade.id, {
                            status: 'cancelled',
                            exit_time: new Date(),
                          } as any);
                          await addActivityLog(
                            botConfig.user_id,
                            'warning',
                            `Position not found on Bybit (may have been closed manually): ${trade.side} ${trade.symbol}`,
                            { orderId: trade.order_id },
                            botConfig.id
                          );
                        }
                      } else {
                        // Position exists - update with actual data from Bybit
                        const actualSize = parseFloat(position.size || '0');
                        const actualEntryPrice = parseFloat(position.avgPrice || trade.entry_price);
                        const unrealizedPnl = parseFloat(position.unrealisedPnl || '0');
                        const markPrice = parseFloat(position.markPrice || lastClose);
                        
                        // Check if TP/SL are set on Bybit
                        const bybitTP = position.takeProfit ? parseFloat(position.takeProfit) : null;
                        const bybitSL = position.stopLoss ? parseFloat(position.stopLoss) : null;
                        const tradeTP = Number(trade.tp_price);
                        const tradeSL = Number(trade.current_sl ?? trade.sl_price);
                        
                        // Set TP/SL if they're not set on Bybit or don't match our trade values
                        const shouldSetTP = !bybitTP || Math.abs(bybitTP - tradeTP) > 0.01;
                        const shouldSetSL = !bybitSL || Math.abs(bybitSL - tradeSL) > 0.01;
                        
                        if (shouldSetTP || shouldSetSL) {
                          try {
                            const { setTakeProfitStopLoss } = await import('@/lib/bybit');
                            const tpToSet = shouldSetTP ? tradeTP : undefined;
                            const slToSet = shouldSetSL ? tradeSL : undefined;
                            
                            await setTakeProfitStopLoss({
                              symbol: trade.symbol,
                              takeProfit: tpToSet,
                              stopLoss: slToSet,
                              testnet: false,
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            
                            const setMsg = [];
                            if (shouldSetTP) setMsg.push(`TP=$${tradeTP.toFixed(2)}`);
                            if (shouldSetSL) setMsg.push(`SL=$${tradeSL.toFixed(2)}`);
                            
                            console.log(`[CRON] TP/SL set on Bybit for trade ${trade.id}: ${setMsg.join(', ')}`);
                            await addActivityLog(
                              botConfig.user_id,
                              'success',
                              `TP/SL set on Bybit: ${trade.side} ${trade.symbol} ${setMsg.join(', ')}`,
                              { orderId: trade.order_id, tp: tpToSet, sl: slToSet },
                              botConfig.id
                            );
                          } catch (tpSlError) {
                            console.error(`[CRON] Failed to set TP/SL for open position ${trade.id}:`, tpSlError);
                            await addActivityLog(
                              botConfig.user_id,
                              'warning',
                              `Failed to set TP/SL on Bybit for ${trade.side} ${trade.symbol}: ${tpSlError instanceof Error ? tpSlError.message : 'Unknown error'}`,
                              { orderId: trade.order_id, error: tpSlError instanceof Error ? tpSlError.message : String(tpSlError) },
                              botConfig.id
                            );
                          }
                        }
                        
                        // Update position size, entry price, and P&L from Bybit's actual data
                        const needsUpdate = 
                          Math.abs(actualSize - Number(trade.position_size)) > 0.0001 || 
                          Math.abs(actualEntryPrice - Number(trade.entry_price)) > 0.01;
                        
                        if (needsUpdate) {
                          await updateTrade(trade.id, {
                            position_size: actualSize,
                            entry_price: actualEntryPrice,
                            pnl: unrealizedPnl, // Store Bybit's actual unrealized P&L
                          } as any);
                          console.log(`[CRON] Updated trade ${trade.id} with actual Bybit data: size=${actualSize}, entry=${actualEntryPrice}, unrealizedPnl=${unrealizedPnl.toFixed(2)}`);
                        } else if (Math.abs(unrealizedPnl - Number(trade.pnl || 0)) > 0.01) {
                          // Update P&L even if size/entry haven't changed
                          await updateTrade(trade.id, {
                            pnl: unrealizedPnl,
                          } as any);
                          console.log(`[CRON] Updated trade ${trade.id} P&L from Bybit: ${unrealizedPnl.toFixed(2)}`);
                        }
                        
                        // Update trailing stop based on VWAP (still use this logic)
                        const entryPrice = Number(trade.entry_price);
                        const initialSl = Number(trade.sl_price);
                        const currentSl = Number(trade.current_sl ?? trade.sl_price);
                        
                        const trailingSl = computeTrailingBreakeven(
                          trade.side as 'LONG' | 'SHORT',
                          entryPrice,
                          initialSl,
                          currentSl,
                          markPrice
                        );
                        
                        if (trailingSl !== null && Math.abs(trailingSl - currentSl) > 0.01) {
                          await updateTrade(trade.id, { current_sl: trailingSl } as any);
                          // Also update on Bybit
                          try {
                            const { setTakeProfitStopLoss } = await import('@/lib/bybit');
                            await setTakeProfitStopLoss({
                              symbol: trade.symbol,
                              stopLoss: trailingSl,
                              testnet: false,
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            await addActivityLog(
                              botConfig.user_id,
                              'info',
                              `Stop moved: ${trade.side} ${trade.symbol} SL → $${trailingSl.toFixed(2)}`,
                              null,
                              botConfig.id
                            );
                          } catch (slError) {
                            console.error(`[CRON] Failed to update SL on Bybit:`, slError);
                          }
                        }
                      }
                    } catch (positionError) {
                      console.error(`[CRON] Error checking position for trade ${trade.id}:`, positionError);
                    }
                  }
                }
              } catch (error) {
                console.error(`[CRON] Error syncing trade ${trade.id} with Bybit:`, error);
              }
            }
          } else {
            // For demo/testnet mode, use chart-based checking (fallback)
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
          }

          // Calculate signal using stored levels, current candles, and real-time price
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
                // Pass real-time price for faster signal detection
                realtimePrice,
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
            // Calculate actual capital to use based on risk_type and risk_amount
            let capitalToUse: number;
            if (botConfig.risk_type === 'percent') {
              // risk_amount is a percentage (e.g., 20 means 20%)
              capitalToUse = botConfig.capital * (botConfig.risk_amount / 100);
            } else {
              // risk_type is 'fixed', risk_amount is the fixed amount to use
              capitalToUse = botConfig.risk_amount;
            }
            
            // Ensure we don't exceed available capital
            capitalToUse = Math.min(capitalToUse, botConfig.capital);
            
            // Calculate position size based on USDT trade value
            // Order value in USDT = capital_to_use * leverage
            // Position size in base asset = (capital_to_use * leverage) / entry_price
            const tradeValueUSDT = capitalToUse * botConfig.leverage;
            const entryPrice = signal.touchedLevel;
            const rawPositionSize = entryPrice > 0 ? tradeValueUSDT / entryPrice : 0;
            const positionSize = Number.isFinite(rawPositionSize) ? rawPositionSize : 0;
                  
            if (positionSize <= 0) {
              console.log('[CRON] Skipping trade - calculated position size <= 0');
            } else {
              console.log(`[CRON] New trade signal - ${signal.signal} @ ${signal.touchedLevel.toFixed(2)}, Trade value: $${tradeValueUSDT.toFixed(2)} USDT (risk_type: ${botConfig.risk_type}, capital: $${botConfig.capital}, risk_amount: ${botConfig.risk_amount}${botConfig.risk_type === 'percent' ? '%' : '$'}, capital_to_use: $${capitalToUse.toFixed(2)} * leverage: ${botConfig.leverage}x), Position size: ${positionSize.toFixed(8)}`);

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
                      const { placeOrder, getInstrumentInfo, roundPrice } = await import('@/lib/bybit');
                      
                      // Round entry price to match Bybit's tick size (price precision)
                      // This ensures the order price exactly matches the calculated level
                      let roundedEntryPrice = signal.touchedLevel;
                      try {
                        const instrumentInfo = await getInstrumentInfo(botConfig.symbol, botConfig.api_mode !== 'live');
                        if (instrumentInfo && instrumentInfo.tickSize) {
                          roundedEntryPrice = roundPrice(signal.touchedLevel, instrumentInfo.tickSize);
                          if (Math.abs(roundedEntryPrice - signal.touchedLevel) > 0.0001) {
                            console.log(`[CRON] Rounded entry price from ${signal.touchedLevel.toFixed(8)} to ${roundedEntryPrice.toFixed(8)} to match Bybit tick size ${instrumentInfo.tickSize}`);
                          }
                        }
                      } catch (priceRoundError) {
                        console.warn(`[CRON] Failed to round price, using original:`, priceRoundError);
                        // Continue with original price if rounding fails
                      }
                      
                      const orderResult = await placeOrder({
                        symbol: botConfig.symbol,
                        side: signal.signal === 'LONG' ? 'Buy' : 'Sell',
                        qty: orderQty,
                        price: roundedEntryPrice, // Use rounded price to match Bybit precision
                        testnet: botConfig.api_mode !== 'live',
                        apiKey: botConfig.api_key,
                        apiSecret: botConfig.api_secret,
                        timeInForce: 'GTC', // Good Till Cancel - matches Bybit API format
                        positionIdx: 0, // One-way mode
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
