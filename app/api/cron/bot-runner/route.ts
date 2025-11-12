import { NextRequest, NextResponse } from 'next/server';
import {
  getRunningBots,
  getOpenTrades,
  createTrade,
  closeTrade,
  addActivityLog,
  updateLastPolled,
  updateDailyPnL,
  resetDailyPnL,
  getUserByEmail,
  getOrCreateUser,
  getDailyLevels,
  checkPhase2Completed
} from '@/lib/db';
import { priceFlipAgainstVWAP } from '@/lib/strategy';
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

    // Build base URL for internal API calls
    // On Vercel, VERCEL_URL doesn't include protocol, so we need to add https://
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:3000';

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

          // Check for immediate bias change closure first
          const openTrades = await getOpenTrades(botConfig.user_id, botConfig.id);
          for (const trade of openTrades) {
            let shouldClose = false;
            let closeReason = '';
            let exitPrice = lastClose;

            // Immediate closure if bias changes (price crosses VWAP)
            // Rules: If the bot is in a LONG trade and the price crosses below the VWAP,
            // the setup is invalid and the trade should be closed immediately (and vice-versa for shorts)
            if (priceFlipAgainstVWAP(lastClose, levels.vwap, trade.side as 'LONG' | 'SHORT')) {
              shouldClose = true;
              closeReason = trade.side === 'LONG'
                ? 'Setup invalidated: LONG trade closed as price fell below VWAP'
                : 'Setup invalidated: SHORT trade closed as price rose above VWAP';
            }

            if (shouldClose) {
              const pnl = trade.side === 'LONG'
                ? (exitPrice - Number(trade.entry_price)) * Number(trade.position_size)
                : (Number(trade.entry_price) - exitPrice) * Number(trade.position_size);

              await closeTrade(trade.id, 'breakeven', exitPrice, pnl);
              await updateDailyPnL(botConfig.user_id, pnl);

              await addActivityLog(
                botConfig.user_id,
                'warning',
                `${closeReason}: ${trade.side} @ $${trade.entry_price} → $${exitPrice.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`,
                null,
                botConfig.id
              );
              continue; // Skip other trade management for this invalidated trade
            }

            // Check if TP or SL hit
            const lastCandle = candles[candles.length - 1];
            let hitTP = false;
            let hitSL = false;

            if (trade.side === 'LONG') {
              if (lastCandle.high >= Number(trade.tp_price)) {
                hitTP = true;
                exitPrice = Number(trade.tp_price);
              } else if (lastCandle.low <= Number(trade.sl_price)) {
                hitSL = true;
                exitPrice = Number(trade.sl_price);
              }
            } else {
              if (lastCandle.low <= Number(trade.tp_price)) {
                hitTP = true;
                exitPrice = Number(trade.tp_price);
              } else if (lastCandle.high >= Number(trade.sl_price)) {
                hitSL = true;
                exitPrice = Number(trade.sl_price);
              }
            }

            if (hitTP || hitSL) {
              const pnl = trade.side === 'LONG'
                ? (exitPrice - Number(trade.entry_price)) * Number(trade.position_size)
                : (Number(trade.entry_price) - exitPrice) * Number(trade.position_size);

              await closeTrade(trade.id, hitTP ? 'tp' : 'sl', exitPrice, pnl);
              await updateDailyPnL(botConfig.user_id, pnl);

              const logLevel = hitTP ? 'success' : 'error';
              const logMsg = hitTP
                ? `Take profit hit: ${trade.side} @ $${trade.entry_price} → $${exitPrice.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`
                : `Stop loss hit: ${trade.side} @ $${trade.entry_price} → $${exitPrice.toFixed(2)} (P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)})`;

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
