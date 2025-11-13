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
  // All grid levels sorted
  const allLevels = [...dnLevels, dOpen, ...upLevels].sort((a, b) => a - b);

  if (side === 'LONG') {
    // For LONG: TP should be next level up, SL should be next level down
    const tpCandidates = allLevels.filter(level => level > entry);
    const slCandidates = allLevels.filter(level => level < entry);

    // Use next available grid level, not closest
    const tp = tpCandidates.length > 0 ? roundLevel(tpCandidates[0]) : roundLevel(entry + (entry * 0.005)); // 0.5% fallback
    const sl = slCandidates.length > 0 ? roundLevel(slCandidates[slCandidates.length - 1]) : roundLevel(entry - (entry * 0.005)); // 0.5% fallback

    return { tp, sl };
  } else {
    // For SHORT: TP should be next level down, SL should be next level up
    const tpCandidates = allLevels.filter(level => level < entry);
    const slCandidates = allLevels.filter(level => level > entry);

    // Use next available grid level, not closest
    const tp = tpCandidates.length > 0 ? roundLevel(tpCandidates[tpCandidates.length - 1]) : roundLevel(entry - (entry * 0.005)); // 0.5% fallback
    const sl = slCandidates.length > 0 ? roundLevel(slCandidates[0]) : roundLevel(entry + (entry * 0.005)); // 0.5% fallback

    return { tp, sl };
  }
}

/**
  * Strict signal logic: LONG-ONLY if price ABOVE VWAP, SHORT-ONLY if price BELOW VWAP
  * Checks if last bar touches a grid level on the bias side
  * Rules: LONG when price ABOVE VWAP, SHORT when price BELOW VWAP
  * Entry conditions: Price has just pulled back/rallied to touch a LowerRange/DailyOpen (LONG) or UpperRange/DailyOpen (SHORT) grid line
  */
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
 }): {
   side: 'LONG' | 'SHORT' | null;
   entry: number | null;
   tp: number | null;
   sl: number | null;
   reason: string;
 } {
   const { candles, vwap, dOpen, upLevels, dnLevels, noTradeBandPct, useDailyOpenEntry = true, kPct = 0.03, subdivisions = 5 } = params;

  if (candles.length === 0) {
    return { side: null, entry: null, tp: null, sl: null, reason: 'No candles' };
  }

  const lastCandle = candles[candles.length - 1];
  const { open, close, high, low } = lastCandle;

  // Check if within no-trade band around VWAP
  const vwapBand = vwap * noTradeBandPct;
  if (Math.abs(close - vwap) < vwapBand) {
    return { side: null, entry: null, tp: null, sl: null, reason: 'Within VWAP dead zone' };
  }

  // Determine bias: LONG-ONLY if price ABOVE VWAP, SHORT-ONLY if price BELOW VWAP
  const isLongBias = close > vwap;
  const isShortBias = close < vwap;

  if (!isLongBias && !isShortBias) {
    return { side: null, entry: null, tp: null, sl: null, reason: 'No clear bias (price equals VWAP)' };
  }

  // Check for level touches
  if (isLongBias) {
    // LONG Entry: Price has just pulled back to touch a LowerRange or DailyOpenPrice grid line (acting as support)
    // Check in order: D1 (first lower level), Daily Open, then other lower levels

    // Check if bar touches D1 (first lower level - entry at D1)
    if (dnLevels.length > 0) {
      const d1Level = roundLevel(dnLevels[0]);
      if (low <= d1Level && d1Level <= high) {
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

    // Check if bar touches daily open (entry at daily open, acting as support)
    if (useDailyOpenEntry && low <= dOpen && dOpen <= high) {
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

    // Check if bar touches U1 (entry at U1) - U1 is first upper level above daily open
    if (upLevels.length > 0) {
      const u1Level = roundLevel(upLevels[0]);
      if (low <= u1Level && u1Level <= high) {
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

    // Check if bar touches any other upper level (U2, U3, etc.)
    for (let i = 1; i < upLevels.length; i++) {
      const level = roundLevel(upLevels[i]);
      if (low <= level && level <= high) {
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

    // Check if bar touches any lower level below D1 (D2, D3, etc.)
    for (let i = 1; i < dnLevels.length; i++) {
      const level = roundLevel(dnLevels[i]);
      if (low <= level && level <= high) {
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

    return { side: null, entry: null, tp: null, sl: null, reason: 'Long bias but no level touch' };
  } else {
    // SHORT Entry: Price has just rallied up to touch an UpperRange or DailyOpenPrice grid line (acting as resistance)
    // Check in order: Daily Open, U1, then other upper levels

    // Check if bar touches daily open (entry at daily open, acting as resistance)
    if (useDailyOpenEntry && low <= dOpen && dOpen <= high) {
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

    // Check if bar touches U1 (first upper level - entry at U1, acting as resistance)
    if (upLevels.length > 0) {
      const u1Level = roundLevel(upLevels[0]);
      if (low <= u1Level && u1Level <= high) {
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

    // Check if bar touches any lower level (D1, D2, etc.)
    for (let i = 0; i < dnLevels.length; i++) {
      const level = roundLevel(dnLevels[i]);
      if (low <= level && level <= high) {
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

    // Check if bar touches any upper level between U1 and daily open
    for (let i = 1; i < upLevels.length; i++) {
      const level = roundLevel(upLevels[i]);
      if (low <= level && level <= high) {
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
