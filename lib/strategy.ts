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
function findClosestGridLevels(
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
  */
 function checkLevelTouch(candle: Candle, level: number, previousCandle?: Candle): boolean {
   const { low, high, open, close } = candle;
   const roundedLevel = roundLevel(level);
   
   // Standard check: level is within candle's high/low range
   if (low <= roundedLevel && roundedLevel <= high) {
     return true;
   }
   
   // Enhanced check: price crossed through the level
   // For LONG signals: price was above level, now below (pulled back to support)
   // For SHORT signals: price was below level, now above (rallied to resistance)
   if (previousCandle) {
     const prevClose = previousCandle.close;
     const currentClose = close;
     
     // Check if price crossed through the level
     const crossedDown = prevClose >= roundedLevel && currentClose < roundedLevel;
     const crossedUp = prevClose <= roundedLevel && currentClose > roundedLevel;
     
     // Also check if the level is very close to the candle (within 0.1% tolerance)
     const tolerance = roundedLevel * 0.001; // 0.1% tolerance
     const nearLevel = Math.abs(low - roundedLevel) <= tolerance || 
                       Math.abs(high - roundedLevel) <= tolerance ||
                       Math.abs(close - roundedLevel) <= tolerance;
     
     if (crossedDown || crossedUp || nearLevel) {
       return true;
     }
   }
   
   return false;
 }

 /**
  * Check if real-time price touches a level (for immediate signal detection)
  */
 function checkRealtimeLevelTouch(currentPrice: number, level: number, tolerance: number = 0.001): boolean {
   const roundedLevel = roundLevel(level);
   const priceTolerance = roundedLevel * tolerance; // Default 0.1% tolerance
   
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
  offsetBps: number = TRAIL_STOP_OFFSET_BPS
): number | null {
  const risk = Math.abs(entry - initialSl);
  if (risk <= 0 || !isFinite(risk)) {
    return null;
  }

  const profit = side === 'LONG' ? lastClose - entry : entry - lastClose;
  if (!isFinite(profit) || profit < risk) {
    return null;
  }

  const offset = entry * (offsetBps / 10000);
  const breakeven =
    side === 'LONG'
      ? Math.max(entry, entry + offset)
      : Math.min(entry, entry - offset);

  if (
    (side === 'LONG' && currentSl >= breakeven) ||
    (side === 'SHORT' && currentSl <= breakeven)
  ) {
    return null;
  }

  return breakeven;
}

/**
 * Breakeven stop logic: if VWAP flips against open trade, move stop to entry
 * @deprecated Use applyBreakeven instead - this function checks VWAP position relative to entry, not price
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
