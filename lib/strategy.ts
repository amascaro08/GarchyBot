import type { Candle } from './types';
import { vwapFromOHLCV, vwapLineFromOHLCV } from './vwap';

export const VWAP_FLIP_CONFIRM_CANDLES = 2;
export const VWAP_FLIP_MIN_BPS = 5;
export const TRAIL_STOP_OFFSET_BPS = 5;

/**
 * Find daily open at UTC 00:00 boundary
 * Uses the first candle's open after the last UTC midnight boundary
 */
export function dailyOpenUTC(candles: Candle[]): number {
  if (candles.length === 0) {
    throw new Error('No candles provided');
  }

  // Find the most recent UTC 00:00 timestamp
  const now = candles[candles.length - 1].ts;
  const nowDate = new Date(now);
  const utcMidnight = new Date(Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate(),
    0, 0, 0, 0
  ));
  const utcMidnightTs = utcMidnight.getTime();

  // Find first candle after UTC midnight (or use first candle if all are before)
  for (const candle of candles) {
    if (candle.ts >= utcMidnightTs) {
      return candle.open; // Use open of first candle after boundary
    }
  }

  // Fallback: use first candle's open
  return candles[0].open;
}

// VWAP functions are now imported from ./vwap module
// Re-export for backward compatibility
export { vwapFromOHLCV, vwapLineFromOHLCV } from './vwap';

/**
 * Generate grid levels around daily open
 * Returns upper/lower bounds and arrays of levels
 */
export function gridLevels(
  dOpen: number,
  kPct: number,
  subdivisions: number
): { upper: number; lower: number; upLevels: number[]; dnLevels: number[] } {
  const upper = dOpen * (1 + kPct);
  const lower = dOpen * (1 - kPct);

  const upLevels: number[] = [];
  const dnLevels: number[] = [];

  // Upper levels (above dOpen)
  const upStep = (upper - dOpen) / subdivisions;
  for (let i = 1; i <= subdivisions; i++) {
    upLevels.push(dOpen + upStep * i);
  }

  // Lower levels (below dOpen)
  const dnStep = (dOpen - lower) / subdivisions;
  for (let i = 1; i <= subdivisions; i++) {
    dnLevels.push(dOpen - dnStep * i);
  }

  return { upper, lower, upLevels, dnLevels };
}

/**
 * Find next available grid levels for TP/SL based on entry position
 */
export function findClosestGridLevels(
  entry: number,
  dOpen: number,
  upLevels: number[],
  dnLevels: number[],
  side: 'LONG' | 'SHORT'
): { tp: number; sl: number } {
  const allLevels = [...dnLevels, dOpen, ...upLevels]
    .map(roundLevel)
    .sort((a, b) => a - b);

  const tolerance = Math.max(Math.abs(entry) * 1e-8, 1e-6);
  const entryIndex = allLevels.findIndex(level => Math.abs(level - entry) <= tolerance);

  const findNextIndex = () => {
    if (entryIndex >= 0 && entryIndex < allLevels.length - 1) {
      return entryIndex + 1;
    }
    for (let i = 0; i < allLevels.length; i++) {
      if (allLevels[i] - entry > tolerance) {
        return i;
      }
    }
    return -1;
  };

  const findPrevIndex = () => {
    if (entryIndex > 0) {
      return entryIndex - 1;
    }
    for (let i = allLevels.length - 1; i >= 0; i--) {
      if (entry - allLevels[i] > tolerance) {
        return i;
      }
    }
    return -1;
  };

  const fallbackLongTp = roundLevel(entry + entry * 0.005);
  const fallbackLongSl = roundLevel(entry - entry * 0.005);
  const fallbackShortTp = roundLevel(entry - entry * 0.005);
  const fallbackShortSl = roundLevel(entry + entry * 0.005);

  if (side === 'LONG') {
    const nextIdx = findNextIndex();
    const prevIdx = findPrevIndex();

    const tp = nextIdx >= 0 ? allLevels[nextIdx] : fallbackLongTp;
    const sl = prevIdx >= 0 ? allLevels[prevIdx] : fallbackLongSl;

    return { tp, sl };
  } else {
    const nextIdx = findPrevIndex();
    const prevIdx = findNextIndex();

    const tp = nextIdx >= 0 ? allLevels[nextIdx] : fallbackShortTp;
    const sl = prevIdx >= 0 ? allLevels[prevIdx] : fallbackShortSl;

    return { tp, sl };
  }
}

/**
  * Strict signal logic: LONG-ONLY if price ABOVE VWAP, SHORT-ONLY if price BELOW VWAP
  * Checks if last bar touches a grid level on the bias side
  * Rules: LONG when price ABOVE VWAP, SHORT when price BELOW VWAP
  * Entry conditions: Price has just pulled back/rallied to touch a LowerRange/DailyOpen (LONG) or UpperRange/DailyOpen (SHORT) grid line
  */
 /**
  * Check if a level was touched in a candle (more sensitive detection)
  * Also checks if price crossed through the level (went from above to below or vice versa)
  * Uses tighter tolerance for more precise detection
  */
 function checkLevelTouch(candle: Candle, level: number, previousCandle?: Candle): boolean {
   const { low, high, open, close } = candle;
   const roundedLevel = roundLevel(level);
   
   // Primary check: level is within candle's high/low range (most reliable)
   // This means the price definitely touched the level during the candle
   if (low <= roundedLevel && roundedLevel <= high) {
     return true;
   }
   
   // Enhanced check: price crossed through the level between candles
   // For LONG signals: price was above level, now below (pulled back to support)
   // For SHORT signals: price was below level, now above (rallied to resistance)
   if (previousCandle) {
     const prevClose = previousCandle.close;
     const currentClose = close;
     
     // Check if price crossed through the level
     const crossedDown = prevClose >= roundedLevel && currentClose < roundedLevel;
     const crossedUp = prevClose <= roundedLevel && currentClose > roundedLevel;
     
     if (crossedDown || crossedUp) {
       return true;
     }
     
     // Tight tolerance check: level is very close to candle boundaries (within 0.05% tolerance)
     // This catches cases where the level is just outside the candle but very close
     const tolerance = roundedLevel * 0.0005; // 0.05% tolerance (tighter)
     const nearLevel = Math.abs(low - roundedLevel) <= tolerance || 
                       Math.abs(high - roundedLevel) <= tolerance;
     
     if (nearLevel) {
       return true;
     }
   }
   
   return false;
 }

 /**
  * Check if real-time price touches a level (for immediate signal detection)
  * Uses tighter tolerance for more precise detection
  */
 function checkRealtimeLevelTouch(currentPrice: number, level: number, tolerance: number = 0.0005): boolean {
   const roundedLevel = roundLevel(level);
   const priceTolerance = roundedLevel * tolerance; // Default 0.05% tolerance (tighter)
   
   // Check if current price is within tolerance of the level
   return Math.abs(currentPrice - roundedLevel) <= priceTolerance;
 }

 export function strictSignalWithDailyOpen(params: {
   candles: Candle[];
   vwap: number;
   dOpen: number;
   upLevels: number[];
   dnLevels: number[];
   noTradeBandPct: number;
   useDailyOpenEntry?: boolean; // Enable/disable daily open entries (default: true)
   kPct?: number; // Add kPct parameter
   subdivisions?: number; // Add subdivisions parameter
   realtimePrice?: number; // Optional real-time price for faster signal detection
 }): {
   side: 'LONG' | 'SHORT' | null;
   entry: number | null;
   tp: number | null;
   sl: number | null;
   reason: string;
 } {
   const { candles, vwap, dOpen, upLevels, dnLevels, noTradeBandPct, useDailyOpenEntry = true, kPct = 0.03, subdivisions = 5, realtimePrice } = params;

  if (candles.length === 0) {
    return { side: null, entry: null, tp: null, sl: null, reason: 'No candles' };
  }

  const lastCandle = candles[candles.length - 1];
  // Use real-time price if available, otherwise use last candle close
  const currentPrice = realtimePrice && realtimePrice > 0 ? realtimePrice : lastCandle.close;
  const { close } = lastCandle;

  // Check if within no-trade band around VWAP (use real-time price if available)
  const vwapBand = vwap * noTradeBandPct;
  if (Math.abs(currentPrice - vwap) < vwapBand) {
    return { side: null, entry: null, tp: null, sl: null, reason: 'Within VWAP dead zone' };
  }

  // Determine bias: LONG-ONLY if price ABOVE VWAP, SHORT-ONLY if price BELOW VWAP (use real-time price)
  const isLongBias = currentPrice > vwap;
  const isShortBias = currentPrice < vwap;

  if (!isLongBias && !isShortBias) {
    return { side: null, entry: null, tp: null, sl: null, reason: 'No clear bias (price equals VWAP)' };
  }

  // Check last 5 candles for level touches (more responsive detection)
  // This catches touches that happened in recent candles, not just the last one
  const candlesToCheck = candles.slice(-5); // Check last 5 candles

  // Helper to get previous candle for a given candle index
  const getPreviousCandle = (candleIndex: number): Candle | undefined => {
    if (candleIndex > 0) {
      return candles[candleIndex - 1];
    }
    return undefined;
  };

  // Check for level touches - prioritize real-time price check for faster detection
  if (isLongBias) {
    // LONG Entry: Price has just pulled back to touch a LowerRange or DailyOpenPrice grid line (acting as support)
    // Check in order: D1 (first lower level), Daily Open, then other lower levels

    // First check real-time price if available (fastest detection)
    if (realtimePrice && realtimePrice > 0) {
      // Check D1
      if (dnLevels.length > 0) {
        const d1Level = roundLevel(dnLevels[0]);
        if (checkRealtimeLevelTouch(realtimePrice, d1Level)) {
          const entry = d1Level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: real-time price touched D1 support at ${entry.toFixed(2)}`,
          };
        }
      }

      // Check daily open
      if (useDailyOpenEntry && checkRealtimeLevelTouch(realtimePrice, dOpen)) {
        const entry = roundLevel(dOpen);
        const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
        return {
          side: 'LONG',
          entry,
          tp,
          sl,
          reason: `Long signal: real-time price touched daily open support at ${entry.toFixed(2)}`,
        };
      }

      // Check U1
      if (upLevels.length > 0) {
        const u1Level = roundLevel(upLevels[0]);
        if (checkRealtimeLevelTouch(realtimePrice, u1Level)) {
          const entry = u1Level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: real-time price touched U1 at ${entry.toFixed(2)}`,
          };
        }
      }

      // Check other levels
      for (let i = 1; i < upLevels.length; i++) {
        const level = roundLevel(upLevels[i]);
        if (checkRealtimeLevelTouch(realtimePrice, level)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: real-time price touched U${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }

      for (let i = 1; i < dnLevels.length; i++) {
        const level = roundLevel(dnLevels[i]);
        if (checkRealtimeLevelTouch(realtimePrice, level)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');
          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: real-time price touched D${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }
    }

    // Fallback to candle-based detection (check recent candles)
    // Check if any recent candle touches D1 (first lower level - entry at D1)
    if (dnLevels.length > 0) {
      const d1Level = roundLevel(dnLevels[0]);
      for (let i = 0; i < candlesToCheck.length; i++) {
        const candle = candlesToCheck[i];
        const candleIndex = candles.length - candlesToCheck.length + i;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, d1Level, prevCandle)) {
          const entry = d1Level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');

          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: touched D1 support at ${entry.toFixed(2)}`,
          };
        }
      }
    }

    // Check if any recent candle touches daily open (entry at daily open, acting as support)
    if (useDailyOpenEntry) {
      for (let i = 0; i < candlesToCheck.length; i++) {
        const candle = candlesToCheck[i];
        const candleIndex = candles.length - candlesToCheck.length + i;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, dOpen, prevCandle)) {
          const entry = roundLevel(dOpen);
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');

          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: touched daily open support at ${entry.toFixed(2)}`,
          };
        }
      }
    }

    // Check if any recent candle touches U1 (entry at U1) - U1 is first upper level above daily open
    if (upLevels.length > 0) {
      const u1Level = roundLevel(upLevels[0]);
      for (let i = 0; i < candlesToCheck.length; i++) {
        const candle = candlesToCheck[i];
        const candleIndex = candles.length - candlesToCheck.length + i;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, u1Level, prevCandle)) {
          const entry = u1Level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');

          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: touched U1 at ${entry.toFixed(2)}`,
          };
        }
      }
    }

    // Check if any recent candle touches any other upper level (U2, U3, etc.)
    for (let i = 1; i < upLevels.length; i++) {
      const level = roundLevel(upLevels[i]);
      for (let j = 0; j < candlesToCheck.length; j++) {
        const candle = candlesToCheck[j];
        const candleIndex = candles.length - candlesToCheck.length + j;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, level, prevCandle)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');

          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: touched U${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }
    }

    // Check if any recent candle touches any lower level below D1 (D2, D3, etc.)
    for (let i = 1; i < dnLevels.length; i++) {
      const level = roundLevel(dnLevels[i]);
      for (let j = 0; j < candlesToCheck.length; j++) {
        const candle = candlesToCheck[j];
        const candleIndex = candles.length - candlesToCheck.length + j;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, level, prevCandle)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'LONG');

          return {
            side: 'LONG',
            entry,
            tp,
            sl,
            reason: `Long signal: touched D${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }
    }

    return { side: null, entry: null, tp: null, sl: null, reason: 'Long bias but no level touch' };
  } else {
    // SHORT Entry: Price has just rallied up to touch an UpperRange or DailyOpenPrice grid line (acting as resistance)
    // Check in order: Daily Open, U1, then other upper levels

    // First check real-time price if available (fastest detection)
    if (realtimePrice && realtimePrice > 0) {
      // Check daily open
      if (useDailyOpenEntry && checkRealtimeLevelTouch(realtimePrice, dOpen)) {
        const entry = roundLevel(dOpen);
        const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');
        return {
          side: 'SHORT',
          entry,
          tp,
          sl,
          reason: `Short signal: real-time price touched daily open resistance at ${entry.toFixed(2)}`,
        };
      }

      // Check U1
      if (upLevels.length > 0) {
        const u1Level = roundLevel(upLevels[0]);
        if (checkRealtimeLevelTouch(realtimePrice, u1Level)) {
          const entry = u1Level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');
          return {
            side: 'SHORT',
            entry,
            tp,
            sl,
            reason: `Short signal: real-time price touched U1 resistance at ${entry.toFixed(2)}`,
          };
        }
      }

      // Check other levels
      for (let i = 0; i < dnLevels.length; i++) {
        const level = roundLevel(dnLevels[i]);
        if (checkRealtimeLevelTouch(realtimePrice, level)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');
          return {
            side: 'SHORT',
            entry,
            tp,
            sl,
            reason: `Short signal: real-time price touched D${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }

      for (let i = 1; i < upLevels.length; i++) {
        const level = roundLevel(upLevels[i]);
        if (checkRealtimeLevelTouch(realtimePrice, level)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');
          return {
            side: 'SHORT',
            entry,
            tp,
            sl,
            reason: `Short signal: real-time price touched U${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }
    }

    // Fallback to candle-based detection (check recent candles)
    // Check if any recent candle touches daily open (entry at daily open, acting as resistance)
    if (useDailyOpenEntry) {
      for (let i = 0; i < candlesToCheck.length; i++) {
        const candle = candlesToCheck[i];
        const candleIndex = candles.length - candlesToCheck.length + i;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, dOpen, prevCandle)) {
          const entry = roundLevel(dOpen);
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');

          return {
            side: 'SHORT',
            entry,
            tp,
            sl,
            reason: `Short signal: touched daily open resistance at ${entry.toFixed(2)}`,
          };
        }
      }
    }

    // Check if any recent candle touches U1 (first upper level - entry at U1, acting as resistance)
    if (upLevels.length > 0) {
      const u1Level = roundLevel(upLevels[0]);
      for (let i = 0; i < candlesToCheck.length; i++) {
        const candle = candlesToCheck[i];
        const candleIndex = candles.length - candlesToCheck.length + i;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, u1Level, prevCandle)) {
          const entry = u1Level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');

          return {
            side: 'SHORT',
            entry,
            tp,
            sl,
            reason: `Short signal: touched U1 resistance at ${entry.toFixed(2)}`,
          };
        }
      }
    }

    // Check if any recent candle touches any lower level (D1, D2, etc.)
    for (let i = 0; i < dnLevels.length; i++) {
      const level = roundLevel(dnLevels[i]);
      for (let j = 0; j < candlesToCheck.length; j++) {
        const candle = candlesToCheck[j];
        const candleIndex = candles.length - candlesToCheck.length + j;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, level, prevCandle)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');

          return {
            side: 'SHORT',
            entry,
            tp,
            sl,
            reason: `Short signal: touched D${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }
    }

    // Check if any recent candle touches any upper level between U1 and daily open
    for (let i = 1; i < upLevels.length; i++) {
      const level = roundLevel(upLevels[i]);
      for (let j = 0; j < candlesToCheck.length; j++) {
        const candle = candlesToCheck[j];
        const candleIndex = candles.length - candlesToCheck.length + j;
        const prevCandle = getPreviousCandle(candleIndex);
        if (checkLevelTouch(candle, level, prevCandle)) {
          const entry = level;
          const { tp, sl } = findClosestGridLevels(entry, dOpen, upLevels, dnLevels, 'SHORT');

          return {
            side: 'SHORT',
            entry,
            tp,
            sl,
            reason: `Short signal: touched U${i + 1} at ${level.toFixed(2)}`,
          };
        }
      }
    }

    return { side: null, entry: null, tp: null, sl: null, reason: 'Short bias but no level touch' };
  }
}

/**
 * Returns true if PRICE (not VWAP) flipped against the trade direction relative to VWAP.
 * LONG: price flipped if lastClose < vwap (invalidates LONG trade)
 * SHORT: price flipped if lastClose > vwap (invalidates SHORT trade)
 */
export function priceFlipAgainstVWAP(
  lastClose: number,
  vwap: number,
  side: 'LONG' | 'SHORT'
): boolean {
  if (side === 'LONG') return lastClose < vwap;
  if (side === 'SHORT') return lastClose > vwap;
  return false;
}

export function shouldExitOnVWAPFlip(
  candles: Candle[],
  vwap: number,
  side: 'LONG' | 'SHORT',
  confirmCandles: number = VWAP_FLIP_CONFIRM_CANDLES,
  minBps: number = VWAP_FLIP_MIN_BPS
): boolean {
  if (candles.length < confirmCandles) {
    return false;
  }

  const recent = candles.slice(-confirmCandles);
  const threshold = vwap * (minBps / 10000);

  if (side === 'LONG') {
    return recent.every((candle) => candle.close < vwap - threshold);
  }

  return recent.every((candle) => candle.close > vwap + threshold);
}

export function computeTrailingBreakeven(
  side: 'LONG' | 'SHORT',
  entry: number,
  initialSl: number,
  currentSl: number,
  lastClose: number,
  offsetBps: number = TRAIL_STOP_OFFSET_BPS,
  minProfitPct: number = 0.02 // Minimum 2% profit required before trailing stop activates (gives trades room to breathe)
): number | null {
  const risk = Math.abs(entry - initialSl);
  if (risk <= 0 || !isFinite(risk)) {
    return null;
  }

  // Calculate profit in absolute terms
  const profit = side === 'LONG' ? lastClose - entry : entry - lastClose;
  if (!isFinite(profit)) {
    return null;
  }

  // Only activate trailing stop if trade is profitable
  if (profit <= 0) {
    return null; // Trade is not profitable yet
  }

  // Calculate profit as percentage of entry price
  const profitPct = profit / entry;

  // Require minimum profit before trailing stop activates (2% by default)
  // This gives trades room to breathe and avoids stopping out on minor pullbacks
  // Alternative approach: wait until profit is at least 1x the risk (1:1 risk/reward)
  const riskPct = risk / entry;
  const minProfitByRisk = riskPct * 1; // Wait for at least 1:1 risk/reward
  
  // Use the higher of the two thresholds: absolute 2% OR 1x risk
  const effectiveMinProfit = Math.max(minProfitPct, minProfitByRisk);
  
  if (profitPct < effectiveMinProfit) {
    return null; // Not enough profit yet, don't activate trailing stop
  }

  // Calculate the trailing stop based on current price
  // Trail stop should follow price as it moves favorably
  const offset = lastClose * (offsetBps / 10000);
  let trailingStop: number;
  
  if (side === 'LONG') {
    // For LONG: trail stop below current price to lock in profits
    // Calculate stop as: current price - offset (percentage of current price)
    // But ensure it's at least slightly above entry (breakeven protection)
    const minStop = entry + (entry * 0.001); // At least 0.1% above entry for safety
    const priceBasedStop = lastClose - offset; // Stop trails below current price
    trailingStop = Math.max(minStop, priceBasedStop);
    
    // Only move stop up (never down) - we want to lock in more profit as price rises
    if (trailingStop <= currentSl) {
      // If calculated stop is below or equal to current stop, don't move it down
      return null;
    }
  } else {
    // For SHORT: trail stop above current price to lock in profits
    // Calculate stop as: current price + offset (percentage of current price)
    // But ensure it's at least slightly below entry (breakeven protection)
    const maxStop = entry - (entry * 0.001); // At least 0.1% below entry for safety
    const priceBasedStop = lastClose + offset; // Stop trails above current price
    trailingStop = Math.min(maxStop, priceBasedStop);
    
    // Only move stop down (never up) - we want to lock in more profit as price falls
    if (trailingStop >= currentSl) {
      // If calculated stop is above or equal to current stop, don't move it up
      return null;
    }
  }

  // Only update if the new stop is significantly different (> 0.01 or 1 cent)
  // This prevents excessive updates for tiny changes
  const stopDiff = Math.abs(trailingStop - currentSl);
  if (stopDiff < 0.01) {
    return null; // Not enough change to warrant update
  }

  return trailingStop;
}

/**
 * Breakeven stop logic: if price goes against the VWAP direction that was initially happening, move stop to entry
 * This invalidates the trade by moving stop loss to breakeven (entry price)
 * 
 * Requires a CONFIRMED direction change (not just a touch) to avoid whipsaws:
 * - Uses a significant buffer (0.5% of VWAP) to confirm the direction change
 * - Price must be clearly on the other side of VWAP, not just touching it
 * - Includes safeguards to prevent immediate triggers after entry (5 minute grace period)
 * 
 * Logic:
 * - LONG trades: entered when price > VWAP (bullish bias). If price < VWAP - buffer, trade is invalidated → move to breakeven
 * - SHORT trades: entered when price < VWAP (bearish bias). If price > VWAP + buffer, trade is invalidated → move to breakeven
 * 
 * @param currentPrice Current market price
 * @param currentVWAP Current VWAP value
 * @param side Trade side ('LONG' or 'SHORT')
 * @param entry Entry price
 * @param currentSl Current stop loss
 * @param confirmationBufferPct Percentage buffer for confirmation (default 0.1% = 0.001)
 * @param entryTime Optional entry time to add grace period (milliseconds since epoch)
 * @param gracePeriodMs Grace period after entry before applying breakeven (default 60 seconds)
 * @returns New stop loss (entry price if breakeven should be applied, null if not)
 */
export function applyBreakevenOnVWAPFlip(
  currentPrice: number,
  currentVWAP: number,
  side: 'LONG' | 'SHORT',
  entry: number,
  currentSl: number,
  confirmationBufferPct: number = 0.005, // 0.5% buffer to confirm direction change (increased from 0.1%)
  entryTime?: number | Date, // Optional entry time for grace period
  gracePeriodMs: number = 300000 // 5 minutes grace period (increased from 60 seconds)
): number | null {
  // Only apply if current SL is not already at or beyond entry (breakeven)
  const isAlreadyAtBreakeven = side === 'LONG' 
    ? currentSl >= entry 
    : currentSl <= entry;
  
  if (isAlreadyAtBreakeven) {
    return null; // Already at breakeven or better
  }

  // Grace period: Don't apply breakeven immediately after entry
  // This prevents trades from being closed seconds after opening
  if (entryTime) {
    const entryTimestamp = entryTime instanceof Date ? entryTime.getTime() : entryTime;
    const timeSinceEntry = Date.now() - entryTimestamp;
    if (timeSinceEntry < gracePeriodMs) {
      return null; // Still in grace period, don't apply breakeven yet
    }
  }

  // Safety check: Verify entry was on the correct side of VWAP
  // If entry itself is on wrong side, don't apply breakeven (trade shouldn't have been opened)
  // This prevents false triggers when entry is at or very close to VWAP
  const entryBuffer = currentVWAP * 0.0005; // 0.05% tolerance for entry validation
  if (side === 'LONG') {
    // For LONG, entry should be above VWAP (or very close)
    // If entry is clearly below VWAP, something is wrong - don't apply breakeven
    if (entry < currentVWAP - entryBuffer) {
      return null; // Entry was on wrong side, skip breakeven
    }
  } else {
    // For SHORT, entry should be below VWAP (or very close)
    // If entry is clearly above VWAP, something is wrong - don't apply breakeven
    if (entry > currentVWAP + entryBuffer) {
      return null; // Entry was on wrong side, skip breakeven
    }
  }

  // Safety check: Don't move stop to entry if price is already at or beyond entry
  // This prevents immediate stop loss hits
  if (side === 'LONG' && currentPrice <= entry) {
    return null; // Price already at or below entry, don't move stop (would hit immediately)
  }
  if (side === 'SHORT' && currentPrice >= entry) {
    return null; // Price already at or above entry, don't move stop (would hit immediately)
  }

  // Calculate confirmation buffer (small percentage of VWAP to avoid whipsaws)
  const buffer = currentVWAP * confirmationBufferPct;

  if (side === 'LONG') {
    // LONG trades: entered when price > VWAP (bullish bias)
    // Require confirmed direction change: price must be clearly below VWAP (VWAP - buffer)
    // This ensures it's not just a touch, but a confirmed move against the trade
    if (currentPrice < currentVWAP - buffer) {
      return entry; // Move stop to entry (breakeven)
    }
  } else {
    // SHORT trades: entered when price < VWAP (bearish bias)
    // Require confirmed direction change: price must be clearly above VWAP (VWAP + buffer)
    // This ensures it's not just a touch, but a confirmed move against the trade
    if (currentPrice > currentVWAP + buffer) {
      return entry; // Move stop to entry (breakeven)
    }
  }
  
  return null; // No breakeven needed
}

/**
 * Breakeven stop logic: if VWAP flips against open trade, move stop to entry
 * @deprecated Use applyBreakevenOnVWAPFlip instead - this function checks VWAP position relative to entry, not price
 */
export function breakevenStopOnVWAPFlip(
  currentVWAP: number,
  side: 'LONG' | 'SHORT',
  entry: number,
  sl: number
): number {
  if (side === 'LONG') {
    // If VWAP drops below entry, move stop to entry
    if (currentVWAP < entry) {
      return entry;
    }
  } else {
    // If VWAP rises above entry, move stop to entry
    if (currentVWAP > entry) {
      return entry;
    }
  }
  return sl;
}

const roundLevel = (value: number) => Number(value.toFixed(8));
