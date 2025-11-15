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
import { computeTrailingBreakeven, applyBreakevenOnVWAPFlip, strictSignalWithDailyOpen } from '@/lib/strategy';
import { placeOrder, cancelOrder, getKlines, getTicker } from '@/lib/bybit';
import { confirmLevelTouch } from '@/lib/orderbook';
import { computeSessionAnchoredVWAP, computeSessionAnchoredVWAPLine } from '@/lib/vwap';
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

          // Fetch current market data directly (bypass HTTP calls to avoid Vercel auth issues)
          let candles: Candle[];
          try {
            // Type assertion for candle_interval (from database VARCHAR to union type)
            const interval = botConfig.candle_interval as '1' | '3' | '5' | '15' | '60' | '120' | '240' | 'D' | 'W' | 'M' | '1d';
            
            // Try mainnet first for accurate data
            try {
              candles = await getKlines(botConfig.symbol, interval, 200, false);
            } catch (mainnetError) {
              // Fallback to testnet if mainnet fails
              console.warn(`[CRON] Mainnet failed for ${botConfig.symbol}, trying testnet:`, mainnetError);
              candles = await getKlines(botConfig.symbol, interval, 200, true);
            }
            
            if (!candles || candles.length === 0) {
              throw new Error('No candles received from Bybit API');
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to fetch klines for bot ${botConfig.id} (${botConfig.symbol}): ${errorMsg}`);
          }

          const lastClose = candles[candles.length - 1].close;

          // Fetch real-time ticker data for faster signal detection
          let realtimePrice: number | undefined = undefined;
          try {
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

          // Calculate current VWAP directly (bypass HTTP calls to avoid Vercel auth issues)
          // We need intraday candles for VWAP calculation
          let intradayCandles: Candle[];
          try {
            try {
              intradayCandles = await getKlines(botConfig.symbol, '5', 288, false);
            } catch (mainnetError) {
              intradayCandles = await getKlines(botConfig.symbol, '5', 288, true);
            }
          } catch (error) {
            // Fallback to using the candles we already fetched
            console.warn(`[CRON] Failed to fetch intraday candles for VWAP, using existing candles:`, error);
            intradayCandles = candles;
          }
          
          const intradayAsc = intradayCandles.slice().reverse(); // Ensure ascending order
          const vwap = computeSessionAnchoredVWAP(intradayAsc, { source: 'hlc3', useAllCandles: true });
          const vwapLine = computeSessionAnchoredVWAPLine(intradayAsc, { source: 'hlc3', useAllCandles: true });
          console.log(`[CRON] VWAP calculated: ${vwap.toFixed(2)}`);

          // Combine stored levels with current VWAP
          // getDailyLevels now returns properly typed values (numbers/arrays)
          // But ensure VWAP is a number and validate everything
          const levels = {
            ...storedLevels,
            vwap: Number(vwap),
            vwapLine: vwapLine,
            kPct: storedLevels.calculated_volatility, // Already a number from getDailyLevels
            dOpen: storedLevels.daily_open_price, // Already a number from getDailyLevels
            upper: storedLevels.upper_range, // Already a number from getDailyLevels
            lower: storedLevels.lower_range, // Already a number from getDailyLevels
            upLevels: storedLevels.up_levels, // Already a number[] from getDailyLevels
            dnLevels: storedLevels.dn_levels, // Already a number[] from getDailyLevels
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
                    // Check order status for pending trades (especially market orders)
                    if (trade.status === 'pending') {
                      try {
                        const orderStatus = await getOrderStatus({
                          symbol: trade.symbol,
                          orderId: trade.order_id,
                          testnet: botConfig.api_mode !== 'live',
                          apiKey: botConfig.api_key,
                          apiSecret: botConfig.api_secret,
                        });
                        
                        const order = orderStatus.result?.list?.[0];
                        if (order) {
                          const orderStatusStr = order.orderStatus?.toLowerCase() || '';
                          const isFilled = orderStatusStr === 'filled' || 
                                          orderStatusStr === 'partiallyfilled' ||
                                          orderStatusStr.includes('fill') ||
                                          (order.avgPrice && parseFloat(order.avgPrice) > 0);
                          
                          if (isFilled) {
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
                                
                                const { setTakeProfitStopLoss, getInstrumentInfo, roundPrice } = await import('@/lib/bybit');
                                
                                // Round TP/SL to match tick size
                                let roundedTP = Number(trade.tp_price);
                                let roundedSL = Number(trade.current_sl ?? trade.sl_price);
                                try {
                                  const instrumentInfo = await getInstrumentInfo(trade.symbol, botConfig.api_mode !== 'live');
                                  if (instrumentInfo && instrumentInfo.tickSize) {
                                    roundedTP = roundPrice(roundedTP, instrumentInfo.tickSize);
                                    roundedSL = roundPrice(roundedSL, instrumentInfo.tickSize);
                                  }
                                } catch (priceRoundError) {
                                  console.warn(`[CRON] Failed to round TP/SL prices:`, priceRoundError);
                                }
                                
                                await setTakeProfitStopLoss({
                                  symbol: trade.symbol,
                                  takeProfit: roundedTP,
                                  stopLoss: roundedSL,
                                  testnet: botConfig.api_mode !== 'live',
                                  apiKey: botConfig.api_key,
                                  apiSecret: botConfig.api_secret,
                                  positionIdx: 0,
                                });
                                console.log(`[CRON] TP/SL set on Bybit after order fill: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                                await addActivityLog(
                                  botConfig.user_id,
                                  'success',
                                  `TP/SL set on Bybit: ${trade.side} ${trade.symbol} TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`,
                                  { orderId: trade.order_id, tp: roundedTP, sl: roundedSL },
                                  botConfig.id
                                );
                              } catch (tpSlError) {
                                console.error(`[CRON] Failed to set TP/SL after order fill:`, tpSlError);
                                // Retry once
                                try {
                                  await new Promise(resolve => setTimeout(resolve, 2000));
                                  const { setTakeProfitStopLoss, getInstrumentInfo, roundPrice } = await import('@/lib/bybit');
                                  let roundedTP = Number(trade.tp_price);
                                  let roundedSL = Number(trade.current_sl ?? trade.sl_price);
                                  try {
                                    const instrumentInfo = await getInstrumentInfo(trade.symbol, botConfig.api_mode !== 'live');
                                    if (instrumentInfo && instrumentInfo.tickSize) {
                                      roundedTP = roundPrice(roundedTP, instrumentInfo.tickSize);
                                      roundedSL = roundPrice(roundedSL, instrumentInfo.tickSize);
                                    }
                                  } catch (priceRoundError) {
                                    // Use unrounded values
                                  }
                                  await setTakeProfitStopLoss({
                                    symbol: trade.symbol,
                                    takeProfit: roundedTP,
                                    stopLoss: roundedSL,
                                    testnet: botConfig.api_mode !== 'live',
                                    apiKey: botConfig.api_key,
                                    apiSecret: botConfig.api_secret,
                                    positionIdx: 0,
                                  });
                                  console.log(`[CRON] ✓ TP/SL set on retry: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                                } catch (retryError) {
                                  await addActivityLog(
                                    botConfig.user_id,
                                    'warning',
                                    `Failed to set TP/SL on Bybit after order fill for ${trade.side} ${trade.symbol}: ${tpSlError instanceof Error ? tpSlError.message : 'Unknown error'}. Will retry on next cron run.`,
                                    { orderId: trade.order_id, error: tpSlError instanceof Error ? tpSlError.message : String(tpSlError) },
                                    botConfig.id
                                  );
                                }
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
                      
                      // Get mark price from position if available, otherwise use lastClose
                      const markPrice = position ? parseFloat(position.markPrice || '0') : lastClose;
                      
                      // Check if position is closed (size is 0 or position doesn't exist)
                      const positionSize = parseFloat(position?.size || '0');
                      if (!position || positionSize === 0) {
                        // Position doesn't exist on Bybit - trade was closed
                        console.log(`[CRON] Position closed on Bybit for trade ${trade.id}: position size = ${positionSize}`);
                        
                        // Try to get the actual exit price and P&L from execution history
                        try {
                          const { getExecutionHistory } = await import('@/lib/bybit');
                          
                          // Get recent executions for this symbol to find the close execution
                          let exitPrice: number | null = null;
                          let actualPnl: number | null = null;
                          
                          try {
                            const executions = await getExecutionHistory({
                              symbol: trade.symbol,
                              limit: 50, // Get last 50 executions
                              testnet: botConfig.api_mode !== 'live',
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                            });
                            
                            // Find the most recent execution that closed this position
                            // Look for executions after trade entry time
                            const entryTime = trade.entry_time ? new Date(trade.entry_time).getTime() : 0;
                            const closeExecutions = executions.result?.list?.filter((exec: any) => {
                              const execTime = parseInt(exec.execTime || '0');
                              return execTime >= entryTime && 
                                     exec.side === (trade.side === 'LONG' ? 'Sell' : 'Buy'); // Opposite side = closing
                            }) || [];
                            
                            if (closeExecutions.length > 0) {
                              // Use the most recent close execution
                              const latestClose = closeExecutions[closeExecutions.length - 1];
                              exitPrice = parseFloat(latestClose.execPrice || '0');
                              // Use closed PnL from execution if available
                              if (latestClose.closedPnl) {
                                actualPnl = parseFloat(latestClose.closedPnl);
                              }
                              console.log(`[CRON] Found close execution: price=${exitPrice}, pnl=${actualPnl}`);
                            }
                          } catch (execError) {
                            console.warn(`[CRON] Failed to get execution history, trying order history:`, execError);
                          }
                          
                          // Fallback: Try to get from order history
                          if (!exitPrice || exitPrice === 0) {
                            const orderStatus = await getOrderStatus({
                              symbol: trade.symbol,
                              orderId: trade.order_id,
                              testnet: botConfig.api_mode !== 'live',
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
                            
                            if (closeOrder) {
                              exitPrice = parseFloat(closeOrder.avgPrice || closeOrder.price || '0');
                              console.log(`[CRON] Found close order: price=${exitPrice}`);
                            }
                          }
                          
                          // Final fallback: use mark price or last close
                          if (!exitPrice || exitPrice === 0) {
                            exitPrice = markPrice || lastClose;
                            console.log(`[CRON] Using fallback price: ${exitPrice}`);
                          }
                          
                          // Calculate P&L if not from execution
                          if (actualPnl === null) {
                            const entryPrice = Number(trade.entry_price);
                            const posSize = Number(trade.position_size);
                            actualPnl = trade.side === 'LONG'
                              ? (exitPrice - entryPrice) * posSize
                              : (entryPrice - exitPrice) * posSize;
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
                          
                          const closeStatus = isTP ? 'tp' : (isSL ? 'sl' : 'breakeven'); // Default to breakeven if unclear
                          
                          await closeTrade(trade.id, closeStatus, exitPrice, actualPnl);
                          await updateDailyPnL(botConfig.user_id, actualPnl);
                          await addActivityLog(
                            botConfig.user_id,
                            'success',
                            `Position closed on Bybit: ${trade.side} ${trade.symbol} @ $${exitPrice.toFixed(2)} (P&L: ${actualPnl >= 0 ? '+' : ''}$${actualPnl.toFixed(2)}, Status: ${closeStatus.toUpperCase()})`,
                            { orderId: trade.order_id, exitPrice, pnl: actualPnl, closeStatus, source: 'bybit' },
                            botConfig.id
                          );
                          console.log(`[CRON] Trade ${trade.id} closed: ${closeStatus} @ $${exitPrice.toFixed(2)}, P&L: $${actualPnl.toFixed(2)}`);
                        } catch (err) {
                          console.error(`[CRON] Error checking closed position for trade ${trade.id}:`, err);
                          // Mark as cancelled if we can't determine what happened
                          await updateTrade(trade.id, {
                            status: 'cancelled',
                            exit_time: new Date(),
                          } as any);
                          await addActivityLog(
                            botConfig.user_id,
                            'warning',
                            `Position not found on Bybit (may have been closed manually): ${trade.side} ${trade.symbol}. Error: ${err instanceof Error ? err.message : 'Unknown'}`,
                            { orderId: trade.order_id, error: err instanceof Error ? err.message : String(err) },
                            botConfig.id
                          );
                        }
                      } else {
                        // Position exists - update with actual data from Bybit
                        const actualSize = parseFloat(position.size || '0');
                        const actualEntryPrice = parseFloat(position.avgPrice || trade.entry_price);
                        const unrealizedPnl = parseFloat(position.unrealisedPnl || '0');
                        const currentMarkPrice = parseFloat(position.markPrice || lastClose);
                        
                        // Check if TP/SL are set on Bybit
                        const bybitTP = position.takeProfit ? parseFloat(position.takeProfit) : null;
                        const bybitSL = position.stopLoss ? parseFloat(position.stopLoss) : null;
                        const tradeTP = Number(trade.tp_price);
                        const tradeSL = Number(trade.current_sl ?? trade.sl_price);
                        
                        // Detect if SL was manually changed on Bybit (different from our database)
                        // If Bybit SL exists and is different from our stored SL, sync it to database
                        if (bybitSL !== null && Math.abs(bybitSL - tradeSL) > 0.01) {
                          console.log(`[CRON] Detected SL change on Bybit for trade ${trade.id}: DB=${tradeSL.toFixed(2)}, Bybit=${bybitSL.toFixed(2)}`);
                          await updateTrade(trade.id, {
                            current_sl: bybitSL,
                          } as any);
                          await addActivityLog(
                            botConfig.user_id,
                            'info',
                            `Stop loss synced from Bybit: ${trade.side} ${trade.symbol} SL → $${bybitSL.toFixed(2)} (manually changed on Bybit)`,
                            { tradeId: trade.id, previousSl: tradeSL, newSl: bybitSL, source: 'bybit' },
                            botConfig.id
                          );
                        }
                        
                        // Set TP/SL if they're not set on Bybit or don't match our trade values
                        // But only if Bybit SL wasn't manually changed (we just synced it above)
                        const shouldSetTP = !bybitTP || Math.abs(bybitTP - tradeTP) > 0.01;
                        // Only set SL if it's not already set on Bybit (don't overwrite manual changes)
                        const shouldSetSL = !bybitSL && tradeSL > 0;
                        
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
                        
                        // Check for breakeven: if price goes against VWAP direction, move stop to entry
                        const entryPrice = Number(trade.entry_price);
                        const initialSl = Number(trade.sl_price);
                        const currentSl = Number(trade.current_sl ?? trade.sl_price);
                        const currentVWAP = levels.vwap;
                        
                        // Apply breakeven if price invalidates the trade (goes against VWAP direction)
                        // Pass entry time for grace period check
                        const entryTime = trade.entry_time ? new Date(trade.entry_time) : undefined;
                        const breakevenSl = applyBreakevenOnVWAPFlip(
                          currentMarkPrice,
                          currentVWAP,
                          trade.side as 'LONG' | 'SHORT',
                          entryPrice,
                          currentSl,
                          0.01, // confirmationBufferPct (1% - requires significant move, increased from 0.5%)
                          entryTime, // entryTime for grace period
                          600000 // 10 minutes grace period (increased from 5 minutes)
                        );
                        
                        if (breakevenSl !== null && Math.abs(breakevenSl - currentSl) > 0.01) {
                          await updateTrade(trade.id, { current_sl: breakevenSl } as any);
                          // Also update on Bybit
                          try {
                            const { setTakeProfitStopLoss } = await import('@/lib/bybit');
                            await setTakeProfitStopLoss({
                              symbol: trade.symbol,
                              stopLoss: breakevenSl,
                              testnet: false,
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            await addActivityLog(
                              botConfig.user_id,
                              'warning',
                              `Breakeven applied: ${trade.side} ${trade.symbol} SL → $${breakevenSl.toFixed(2)} (price invalidated trade - moved against VWAP direction)`,
                              { currentPrice: currentMarkPrice, vwap: currentVWAP, entry: entryPrice },
                              botConfig.id
                            );
                            console.log(`[CRON] Breakeven applied for trade ${trade.id}: ${trade.side} ${trade.symbol}, price ${currentMarkPrice.toFixed(2)} vs VWAP ${currentVWAP.toFixed(2)}`);
                          } catch (slError) {
                            console.error(`[CRON] Failed to update SL to breakeven on Bybit:`, slError);
                          }
                        } else {
                          // Update trailing stop based on VWAP (only if breakeven not applied)
                          const trailingSl = computeTrailingBreakeven(
                            trade.side as 'LONG' | 'SHORT',
                            entryPrice,
                            initialSl,
                            currentSl,
                            currentMarkPrice
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
              const currentVWAP = levels.vwap;

              // Check for breakeven: if price goes against VWAP direction, move stop to entry
              // Pass entry time for grace period check
              const entryTime = trade.entry_time ? new Date(trade.entry_time) : undefined;
              const breakevenSl = applyBreakevenOnVWAPFlip(
                lastClose,
                currentVWAP,
                trade.side as 'LONG' | 'SHORT',
                entryPrice,
                currentSl,
                0.005, // confirmationBufferPct (0.5% - requires significant move)
                entryTime, // entryTime for grace period
                300000 // 5 minutes grace period
              );

              if (breakevenSl !== null && Math.abs(breakevenSl - currentSl) > 0.01) {
                await updateTrade(trade.id, { current_sl: breakevenSl } as any);
                await addActivityLog(
                  botConfig.user_id,
                  'warning',
                  `Breakeven applied: ${trade.side} ${trade.symbol} SL → $${breakevenSl.toFixed(2)} (price invalidated trade - moved against VWAP direction)`,
                  { currentPrice: lastClose, vwap: currentVWAP, entry: entryPrice },
                  botConfig.id
                );
                console.log(`[CRON] Breakeven applied for trade ${trade.id}: ${trade.side} ${trade.symbol}, price ${lastClose.toFixed(2)} vs VWAP ${currentVWAP.toFixed(2)}`);
                continue;
              }

              // Update trailing stop based on VWAP (only if breakeven not applied)
              const trailingSl = computeTrailingBreakeven(
                trade.side as 'LONG' | 'SHORT',
                entryPrice,
                initialSl,
                currentSl,
                lastClose
              );

              if (trailingSl !== null && Math.abs(trailingSl - currentSl) > 0.01) {
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

          // Calculate signal directly using stored levels, current candles, and real-time price
          // Bypass HTTP calls to avoid Vercel auth issues
          console.log(`[CRON] Calculating signal for ${botConfig.symbol}:`);
          console.log(`  dOpen: ${levels.dOpen} (type: ${typeof levels.dOpen})`);
          console.log(`  vwap: ${levels.vwap} (type: ${typeof levels.vwap})`);
          console.log(`  upperLevels: ${Array.isArray(levels.upLevels) ? `array[${levels.upLevels.length}]` : typeof levels.upLevels}`);
          console.log(`  lowerLevels: ${Array.isArray(levels.dnLevels) ? `array[${levels.dnLevels.length}]` : typeof levels.dnLevels}`);
          console.log(`  realtimePrice: ${realtimePrice || 'N/A'}`);

          // Call signal function directly (bypass HTTP)
          const signal = strictSignalWithDailyOpen({
            candles,
            vwap: levels.vwap,
            dOpen: levels.dOpen,
            upLevels: levels.upLevels,
            dnLevels: levels.dnLevels,
            noTradeBandPct: botConfig.no_trade_band_pct || 0.001,
            useDailyOpenEntry: botConfig.use_daily_open_entry ?? true,
            kPct: levels.kPct,
            subdivisions: botConfig.subdivisions,
            realtimePrice,
          });

          // Log if signal is detected
          if (signal.side) {
            console.log(`[CRON] Signal detected - ${signal.side} at ${signal.entry?.toFixed(2)}, Reason: ${signal.reason}`);
            
            // Check if this is a daily open entry
            if (signal.reason && signal.reason.includes('daily open')) {
              console.log(`[CRON] ✓ Daily open entry detected! Price touched ${signal.entry?.toFixed(2)}`);
            }
          }

          // Check for new trade signal
          if (signal.side && signal.entry) {
            const openTradesCount = openTrades.length;

            if (openTradesCount < botConfig.max_trades) {
              // Check for duplicate trade
              const isDuplicate = openTrades.some(
                (t) =>
                  t.symbol === botConfig.symbol &&
                  t.side === signal.side &&
                  Math.abs(Number(t.entry_price) - signal.entry) < 0.01
              );

              if (!isDuplicate) {
                // Check trade cooldown: don't enter new trades within 5 minutes of last trade
                const lastTrade = openTrades
                  .filter(t => t.symbol === botConfig.symbol)
                  .sort((a, b) => {
                    const aTime = a.entry_time ? new Date(a.entry_time).getTime() : 0;
                    const bTime = b.entry_time ? new Date(b.entry_time).getTime() : 0;
                    return bTime - aTime;
                  })[0];
                
                if (lastTrade && lastTrade.entry_time) {
                  const lastTradeTime = new Date(lastTrade.entry_time).getTime();
                  const timeSinceLastTrade = Date.now() - lastTradeTime;
                  const cooldownMs = 300000; // 5 minutes cooldown
                  
                  if (timeSinceLastTrade < cooldownMs) {
                    console.log(`[CRON] Trade cooldown active - last trade was ${Math.round(timeSinceLastTrade / 1000)}s ago, need ${cooldownMs / 1000}s`);
                    await addActivityLog(
                      botConfig.user_id,
                      'info',
                      `Trade signal ignored - cooldown active (last trade ${Math.round(timeSinceLastTrade / 1000)}s ago)`,
                      { signal: signal.side, level: signal.entry, timeSinceLastTrade },
                      botConfig.id
                    );
                    // Skip this signal, wait for cooldown
                    // Continue to next iteration - skip rest of trade creation
                  } else {
                    // Cooldown passed, proceed with trade creation
                    
                    // Mandatory: Order book confirmation
                    // Rules: The bot must scan the Level 2 Order Book at that exact level and see:
                    // - LONG: significant increase in buy-side limit orders (buy wall) OR rapid execution of sell orders
                    // - SHORT: significant increase in sell-side limit orders (sell wall) OR rapid execution of buy orders
                    let approved = false;
                    try {
                      approved = await confirmLevelTouch({
                        symbol: botConfig.symbol,
                        level: signal.entry,
                        side: signal.side,
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
                      const entryPrice = signal.entry;
                      const rawPositionSize = entryPrice > 0 ? tradeValueUSDT / entryPrice : 0;
                      const positionSize = Number.isFinite(rawPositionSize) ? rawPositionSize : 0;
                            
                      if (positionSize <= 0) {
                        console.log('[CRON] Skipping trade - calculated position size <= 0');
                      } else {
                        console.log(`[CRON] New trade signal - ${signal.side} @ ${signal.entry.toFixed(2)}, Trade value: $${tradeValueUSDT.toFixed(2)} USDT (risk_type: ${botConfig.risk_type}, capital: $${botConfig.capital}, risk_amount: ${botConfig.risk_amount}${botConfig.risk_type === 'percent' ? '%' : '$'}, capital_to_use: $${capitalToUse.toFixed(2)} * leverage: ${botConfig.leverage}x), Position size: ${positionSize.toFixed(8)}`);

                        const tradeRecord = await createTrade({
                          user_id: botConfig.user_id,
                          bot_config_id: botConfig.id,
                          symbol: botConfig.symbol,
                          side: signal.side,
                          status: 'pending',
                          entry_price: signal.entry,
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
                            const { placeOrder, setTakeProfitStopLoss, getInstrumentInfo, roundPrice } = await import('@/lib/bybit');
                            
                            // Place MARKET order for immediate execution (no price needed)
                            console.log(`[CRON] Placing MARKET order: ${signal.side} ${botConfig.symbol} qty ${orderQty.toFixed(8)}`);
                            
                            const orderResult = await placeOrder({
                        symbol: botConfig.symbol,
                        side: signal.side === 'LONG' ? 'Buy' : 'Sell',
                        qty: orderQty,
                        // No price parameter = Market order
                        testnet: botConfig.api_mode !== 'live',
                        apiKey: botConfig.api_key,
                        apiSecret: botConfig.api_secret,
                        timeInForce: 'IOC', // Immediate or Cancel - ensures immediate execution
                        positionIdx: 0, // One-way mode
                      });

                      // Check if order was filled successfully
                      if (orderResult?.retCode === 0 && orderResult?.result) {
                        const orderId = orderResult.result.orderId;
                        const orderStatus = orderResult.result.orderStatus;
                        const orderStatusLower = orderStatus?.toLowerCase() || '';
                        const avgPrice = parseFloat(orderResult.result.avgPrice || orderResult.result.price || orderResult.result.avgPrice || signal.entry);
                        const executedQty = parseFloat(orderResult.result.executedQty || orderResult.result.executedQty || orderResult.result.qty || orderQty);
                        
                        // Market orders should be filled immediately
                        // Check for various status strings (Bybit may return different cases)
                        if (orderStatusLower === 'filled' || orderStatusLower === 'partiallyfilled' || 
                            orderStatus === 'Filled' || orderStatus === 'PartiallyFilled' ||
                            orderStatusLower.includes('fill')) {
                          console.log(`[CRON] Market order FILLED: ${signal.side} ${botConfig.symbol} @ $${avgPrice.toFixed(2)}, qty: ${executedQty.toFixed(8)}, Order ID: ${orderId}`);
                          
                          // Round TP/SL prices to match Bybit's tick size
                          let roundedTP = signal.tp;
                          let roundedSL = signal.sl;
                          try {
                            const instrumentInfo = await getInstrumentInfo(botConfig.symbol, botConfig.api_mode !== 'live');
                            if (instrumentInfo && instrumentInfo.tickSize) {
                              roundedTP = roundPrice(signal.tp, instrumentInfo.tickSize);
                              roundedSL = roundPrice(signal.sl, instrumentInfo.tickSize);
                            }
                          } catch (priceRoundError) {
                            console.warn(`[CRON] Failed to round TP/SL prices:`, priceRoundError);
                          }
                          
                          // Set TP/SL immediately after order is filled
                          // Wait a moment for position to be established on Bybit
                          try {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            await setTakeProfitStopLoss({
                              symbol: botConfig.symbol,
                              takeProfit: roundedTP,
                              stopLoss: roundedSL,
                              testnet: botConfig.api_mode !== 'live',
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                              positionIdx: 0,
                            });
                            console.log(`[CRON] ✓ TP/SL set immediately: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                          } catch (tpSlError) {
                            console.error(`[CRON] Failed to set TP/SL, retrying...`, tpSlError);
                            // Retry after another delay
                            try {
                              await new Promise(resolve => setTimeout(resolve, 2000));
                              await setTakeProfitStopLoss({
                                symbol: botConfig.symbol,
                                takeProfit: roundedTP,
                                stopLoss: roundedSL,
                                testnet: botConfig.api_mode !== 'live',
                                apiKey: botConfig.api_key,
                                apiSecret: botConfig.api_secret,
                                positionIdx: 0,
                              });
                              console.log(`[CRON] ✓ TP/SL set on retry: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                            } catch (retryError) {
                              console.error(`[CRON] Failed to set TP/SL on retry:`, retryError);
                              // Log but continue - cron job will retry on next run
                              await addActivityLog(
                                botConfig.user_id,
                                'warning',
                                `TP/SL not set yet for ${signal.side} ${botConfig.symbol}, will retry on next cron run`,
                                { orderId, tp: roundedTP, sl: roundedSL, error: retryError instanceof Error ? retryError.message : String(retryError) },
                                botConfig.id
                              );
                            }
                          }
                          
                          // Update trade with actual filled price and status
                          await updateTrade(tradeRecord.id, {
                            status: 'open',
                            order_id: orderId,
                            entry_price: avgPrice,
                            position_size: executedQty,
                          } as any);

                          await addActivityLog(
                            botConfig.user_id,
                            'success',
                            `Market order FILLED: ${signal.side} ${botConfig.symbol} @ $${avgPrice.toFixed(2)}, qty: ${executedQty.toFixed(8)}, TP: $${roundedTP.toFixed(2)}, SL: $${roundedSL.toFixed(2)}, Order ID: ${orderId}`,
                            { orderResult, orderId, avgPrice, executedQty, tp: roundedTP, sl: roundedSL },
                            botConfig.id
                          );
                        } else {
                          // Order placed but status unclear - check order status via API
                          console.warn(`[CRON] Market order placed but status is ${orderStatus}, checking order status...`);
                          
                          try {
                            const { getOrderStatus } = await import('@/lib/bybit');
                            // Wait a moment for order to process
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            const orderStatusCheck = await getOrderStatus({
                              symbol: botConfig.symbol,
                              orderId: orderId,
                              testnet: botConfig.api_mode !== 'live',
                              apiKey: botConfig.api_key,
                              apiSecret: botConfig.api_secret,
                            });
                            
                            const order = orderStatusCheck.result?.list?.[0];
                            if (order) {
                              const checkStatus = order.orderStatus?.toLowerCase() || '';
                              if (checkStatus === 'filled' || checkStatus === 'partiallyfilled' || checkStatus.includes('fill')) {
                                const filledPrice = parseFloat(order.avgPrice || order.price || signal.entry);
                                const filledQty = parseFloat(order.executedQty || order.qty || orderQty);
                                
                                // Round TP/SL
                                let roundedTP = signal.tp;
                                let roundedSL = signal.sl;
                                try {
                                  const instrumentInfo = await getInstrumentInfo(botConfig.symbol, botConfig.api_mode !== 'live');
                                  if (instrumentInfo && instrumentInfo.tickSize) {
                                    roundedTP = roundPrice(signal.tp, instrumentInfo.tickSize);
                                    roundedSL = roundPrice(signal.sl, instrumentInfo.tickSize);
                                  }
                                } catch (priceRoundError) {
                                  console.warn(`[CRON] Failed to round TP/SL prices:`, priceRoundError);
                                }
                                
                                // Set TP/SL
                                try {
                                  await setTakeProfitStopLoss({
                                    symbol: botConfig.symbol,
                                    takeProfit: roundedTP,
                                    stopLoss: roundedSL,
                                    testnet: botConfig.api_mode !== 'live',
                                    apiKey: botConfig.api_key,
                                    apiSecret: botConfig.api_secret,
                                    positionIdx: 0,
                                  });
                                  console.log(`[CRON] ✓ TP/SL set after status check: TP=$${roundedTP.toFixed(2)}, SL=$${roundedSL.toFixed(2)}`);
                                } catch (tpSlError) {
                                  console.error(`[CRON] Failed to set TP/SL:`, tpSlError);
                                }
                                
                                // Update trade
                                await updateTrade(tradeRecord.id, {
                                  status: 'open',
                                  order_id: orderId,
                                  entry_price: filledPrice,
                                  position_size: filledQty,
                                } as any);
                                
                                await addActivityLog(
                                  botConfig.user_id,
                                  'success',
                                  `Market order FILLED (verified): ${signal.side} ${botConfig.symbol} @ $${filledPrice.toFixed(2)}, qty: ${filledQty.toFixed(8)}, TP: $${roundedTP.toFixed(2)}, SL: $${roundedSL.toFixed(2)}, Order ID: ${orderId}`,
                                  { orderResult, orderId, filledPrice, filledQty, tp: roundedTP, sl: roundedSL },
                                  botConfig.id
                                );
                              } else {
                                // Still not filled
                                await updateTrade(tradeRecord.id, {
                                  order_id: orderId,
                                  // Keep status as 'pending' until filled
                                } as any);
                                
                                await addActivityLog(
                                  botConfig.user_id,
                                  'warning',
                                  `Market order placed but not filled yet: ${signal.side} ${botConfig.symbol}, Order ID: ${orderId}, Status: ${checkStatus}`,
                                  { orderResult, orderId, orderStatus: checkStatus },
                                  botConfig.id
                                );
                              }
                            } else {
                              // Couldn't get order status
                              await updateTrade(tradeRecord.id, {
                                order_id: orderId,
                              } as any);
                            }
                          } catch (statusError) {
                            console.error(`[CRON] Error checking order status:`, statusError);
                            await updateTrade(tradeRecord.id, {
                              order_id: orderId,
                            } as any);
                          }
                        }
                      } else {
                        // Order was rejected by Bybit
                        const errorMsg = orderResult?.retMsg || 'Unknown error';
                        const retCode = orderResult?.retCode || 'N/A';
                        throw new Error(`Bybit rejected order (retCode: ${retCode}): ${errorMsg}`);
                      }
                    } catch (error) {
                      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                      console.error(`[CRON] Market order failed:`, errorMsg);
                        await addActivityLog(
                          botConfig.user_id,
                          'error',
                          `Market order failed: ${errorMsg}`,
                          { symbol: botConfig.symbol, side: signal.side, qty: orderQty, error: errorMsg },
                          botConfig.id
                        );
                      }
                    }

                      // Activity log for market order is already added above when order is filled
                      // This log is only for demo/testnet mode or when API keys are not configured
                      if (!botConfig.api_key || !botConfig.api_secret) {
                        await addActivityLog(
                          botConfig.user_id,
                          'success',
                          `Market order (demo): ${signal.side} @ $${signal.entry.toFixed(2)}, TP: $${signal.tp.toFixed(2)}, SL: $${signal.sl.toFixed(2)}`,
                          { signal, positionSize },
                          botConfig.id
                        );
                      }
                      } // End else block (positionSize > 0)
                    } // End if (approved)
                  } // End else block (cooldown check)
                } // End if (lastTrade && lastTrade.entry_time)
              } // End if (!isDuplicate)
              } // End if (openTradesCount < botConfig.max_trades)
            } // End if (signal.side && signal.entry)

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
