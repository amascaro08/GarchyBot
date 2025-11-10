import type { Candle } from './types';

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

/**
 * Calculate VWAP from OHLCV candles
 * VWAP = Σ((H+L+C)/3 * Volume) / Σ(Volume)
 * Uses typical price = (High + Low + Close) / 3
 */
export function vwapFromOHLCV(candles: Candle[]): number {
  if (candles.length === 0) {
    throw new Error('No candles provided');
  }

  let totalPriceVolume = 0;
  let totalVolume = 0;

  for (const candle of candles) {
    // FIX: use (H + L + C) / 3 — standard typical price
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    totalPriceVolume += typicalPrice * candle.volume;
    totalVolume += candle.volume;
  }

  if (totalVolume === 0) {
    // Fallback to last close if no volume
    return candles[candles.length - 1].close;
  }

  return totalPriceVolume / totalVolume;
}

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
}): {
  side: 'LONG' | 'SHORT' | null;
  entry: number | null;
  tp: number | null;
  sl: number | null;
  reason: string;
} {
  const { candles, vwap, dOpen, upLevels, dnLevels, noTradeBandPct } = params;

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
    // Check if bar touches any upper level
    for (let i = 0; i < upLevels.length; i++) {
      const level = upLevels[i];
      if (low <= level && level <= high) {
        // Entry at touched level
        const entry = level;
        // TP at next level (or extrapolate)
        const tp = i < upLevels.length - 1 ? upLevels[i + 1] : upLevels[i] + (upLevels[i] - (i > 0 ? upLevels[i - 1] : dOpen));
        // SL at previous level (or extrapolate)
        const sl = i > 0 ? upLevels[i - 1] : dOpen - (upLevels[0] - dOpen);

        return {
          side: 'LONG',
          entry,
          tp,
          sl,
          reason: `Long signal: touched U${i + 1} at ${level.toFixed(2)}`,
        };
      }
    }
    return { side: null, entry: null, tp: null, sl: null, reason: 'Long bias but no level touch' };
  } else {
    // Short bias: check lower levels
    for (let i = 0; i < dnLevels.length; i++) {
      const level = dnLevels[i];
      if (low <= level && level <= high) {
        // Entry at touched level
        const entry = level;
        // TP at next lower level (or extrapolate)
        const tp = i < dnLevels.length - 1 ? dnLevels[i + 1] : dnLevels[i] - (dnLevels[i] - (i > 0 ? dnLevels[i - 1] : dOpen));
        // SL at previous level (or extrapolate)
        const sl = i > 0 ? dnLevels[i - 1] : dOpen + (dOpen - dnLevels[0]);

        return {
          side: 'SHORT',
          entry,
          tp,
          sl,
          reason: `Short signal: touched D${i + 1} at ${level.toFixed(2)}`,
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
