import type { Candle } from './types';
import { vwapFromOHLCV, vwapLineFromOHLCV } from './vwap';

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
 * Strict signal logic: Long only if open & close > VWAP, Short mirrored
 * Checks if last bar touches a grid level on the bias side
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

  // Determine bias: Long if open > VWAP && close > VWAP
  const isLongBias = open > vwap && close > vwap;
  const isShortBias = open < vwap && close < vwap;

  if (!isLongBias && !isShortBias) {
    return { side: null, entry: null, tp: null, sl: null, reason: 'No clear bias (mixed VWAP)' };
  }

  // Check for level touches
  if (isLongBias) {
    // Check if bar touches D1 (entry at D1)
    if (dnLevels.length > 0) {
      const d1Level = dnLevels[0];
      if (low <= d1Level && d1Level <= high) {
        const entry = d1Level;
        // If long opens at D1: TP at D2, SL at daily open
        const tp = dnLevels.length > 1 ? dnLevels[1] : d1Level - (dOpen - d1Level); // D2
        const sl = dOpen; // Daily open

        return {
          side: 'LONG',
          entry,
          tp,
          sl,
          reason: `Long signal: touched D1 at ${entry.toFixed(2)}`,
        };
      }
    }

    // Check if bar touches daily open first (entry at daily open, which is between daily open and U1)
    if (useDailyOpenEntry && low <= dOpen && dOpen <= high) {
      const entry = dOpen;
      // If long opens at daily open: TP at U1, SL at D1
      const tp = upLevels.length > 0 ? upLevels[0] : dOpen + (dOpen * kPct / subdivisions); // U1
      const sl = dnLevels.length > 0 ? dnLevels[0] : dOpen - (dOpen * kPct / subdivisions); // D1

      return {
        side: 'LONG',
        entry,
        tp,
        sl,
        reason: `Long signal: touched daily open at ${entry.toFixed(2)}`,
      };
    }

    // Check if bar touches U1 (entry at U1)
    if (upLevels.length > 0) {
      const u1Level = upLevels[0];
      if (low <= u1Level && u1Level <= high) {
        const entry = u1Level;
        // If long opens at U1: TP at next upper level (U2), SL at D1
        const tp = upLevels.length > 1 ? upLevels[1] : u1Level + (u1Level - dOpen); // U2
        const sl = dnLevels.length > 0 ? dnLevels[0] : dOpen; // SL at D1

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
      const level = upLevels[i];
      if (low <= level && level <= high) {
        const entry = level;
        // For long at upper levels: TP at next level, SL at previous level
        const tp = i < upLevels.length - 1 ? upLevels[i + 1] : upLevels[i] + (upLevels[i] - upLevels[i - 1]);
        const sl = upLevels[i - 1]; // Previous upper level

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
      const level = dnLevels[i];
      if (low <= level && level <= high) {
        const entry = level;
        // For long at lower levels: TP at next level up, SL at daily open
        const tp = dnLevels[i - 1]; // Next level up (closer to daily open)
        const sl = dOpen; // Daily open

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
    // Short bias: check lower levels
    // Check if bar touches daily open
    if (useDailyOpenEntry && low <= dOpen && dOpen <= high) {
      const entry = dOpen;
      // If short opens at daily open: TP at D1, SL at U1
      const tp = dnLevels.length > 0 ? dnLevels[0] : dOpen - (dOpen * kPct / subdivisions); // D1
      const sl = upLevels.length > 0 ? upLevels[0] : dOpen + (dOpen * kPct / subdivisions); // U1

      return {
        side: 'SHORT',
        entry,
        tp,
        sl,
        reason: `Short signal: touched daily open at ${entry.toFixed(2)}`,
      };
    }

    // Check if bar touches U1 (entry at U1)
    if (upLevels.length > 0) {
      const u1Level = upLevels[0];
      if (low <= u1Level && u1Level <= high) {
        const entry = u1Level;
        // If short opens at U1: TP at U2, SL at daily open
        const tp = upLevels.length > 1 ? upLevels[1] : u1Level + (u1Level - dOpen); // U2
        const sl = dOpen; // Daily open

        return {
          side: 'SHORT',
          entry,
          tp,
          sl,
          reason: `Short signal: touched U1 at ${entry.toFixed(2)}`,
        };
      }
    }

    // Check if bar touches any lower level (D1, D2, etc.)
    for (let i = 0; i < dnLevels.length; i++) {
      const level = dnLevels[i];
      if (low <= level && level <= high) {
        const entry = level;
        // For short at lower levels: TP at next level down, SL at previous level or daily open
        const tp = i < dnLevels.length - 1 ? dnLevels[i + 1] : dnLevels[i] - (dnLevels[i] - (i > 0 ? dnLevels[i - 1] : dOpen));
        const sl = i > 0 ? dnLevels[i - 1] : dOpen; // Use daily open as SL if at D1

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
      const level = upLevels[i];
      if (low <= level && level <= high) {
        const entry = level;
        // For short at upper levels (U2, U3, etc.): TP at next level down, SL at daily open
        const tp = i > 0 ? upLevels[i - 1] : dOpen;
        const sl = dOpen; // Always use daily open as SL for upper level shorts

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
 * LONG: price flipped if lastClose < vwap
 * SHORT: price flipped if lastClose > vwap
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

/**
 * If price flipped against VWAP, move SL to entry (breakeven). Otherwise keep original SL.
 */
export function applyBreakeven(
  side: 'LONG' | 'SHORT',
  entry: number,
  sl: number,
  lastClose: number,
  vwap: number
): number {
  return priceFlipAgainstVWAP(lastClose, vwap, side) ? entry : sl;
}

/**
 * Breakeven stop logic: if VWAP flips against open trade, move stop to entry
 * @deprecated Use applyBreakeven instead
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
