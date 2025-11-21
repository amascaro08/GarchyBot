/**
 * TradingView-accurate VWAP implementation
 * 
 * Equivalent to Pine Script v5: ta.vwap(src)
 * - Resets each daily session (UTC midnight by default for crypto)
 * - Supports source selection: close | hl2 | hlc3 | ohlc4
 *   - 'hl2' uses (high + low) / 2 (typical midpoint)
 *   - 'hlc3' uses (high + low + close) / 3 (typical price)
 *   - 'ohlc4' uses (open + high + low + close) / 4 (average price)
 */

import type { Candle } from './types';

export type VwapSource = 'close' | 'hl2' | 'hlc3' | 'ohlc4';

export interface VwapOptions {
  /** Session anchor: 'utc-midnight' or timezone string (e.g., 'America/New_York') */
  sessionAnchor?: 'utc-midnight' | { tz: string };
  /** Price source: 'close', 'hl2' (high+low)/2, 'hlc3' (high+low+close)/3, or 'ohlc4' (open+high+low+close)/4 */
  source?: VwapSource;
  /** If provided, use fixed lookback period (number of candles) instead of session anchor. 
   * This matches TradingView VWAP AA with fixed anchor period. */
  lookbackPeriod?: number;
  /** If true, use all available candles instead of session-anchored (matches TradingView VWAP AA with Auto anchor) */
  useAllCandles?: boolean;
}

/**
 * Get the typical price based on source selection
 */
function getTypicalPrice(candle: Candle, source: VwapSource): number {
  switch (source) {
    case 'close':
      return candle.close;
    case 'hl2':
      return (candle.high + candle.low) / 2;
    case 'hlc3':
      return (candle.high + candle.low + candle.close) / 3;
    case 'ohlc4':
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    default:
      return candle.close;
  }
}

/**
 * Get UTC midnight timestamp for a given timestamp
 */
function getUTCMidnightTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0, 0, 0, 0
  );
}

/**
 * Get session start timestamp based on anchor type
 */
function getSessionStartTimestamp(timestamp: number, anchor: VwapOptions['sessionAnchor']): number {
  if (!anchor || anchor === 'utc-midnight') {
    return getUTCMidnightTimestamp(timestamp);
  }
  
  // For timezone-based anchors, we'd need a timezone library
  // For now, fallback to UTC midnight (can be enhanced with date-fns-tz or similar)
  // This is a placeholder - in production, you'd use:
  // import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
  // const zonedDate = utcToZonedTime(new Date(timestamp), anchor.tz);
  // const sessionStart = new Date(zonedDate.setHours(0, 0, 0, 0));
  // return zonedTimeToUtc(sessionStart, anchor.tz).getTime();
  
  console.warn('Timezone-based session anchors require date-fns-tz. Using UTC midnight.');
  return getUTCMidnightTimestamp(timestamp);
}

/**
 * Compute session-anchored VWAP (TradingView style)
 * 
 * VWAP = Σ(typicalPrice * volume) / Σ(volume)
 * 
 * Where typicalPrice depends on source:
 * - 'close': close price
 * - 'hl2': (high + low) / 2 (midpoint)
 * - 'hlc3': (high + low + close) / 3 (typical price)
 * - 'ohlc4': (open + high + low + close) / 4 (average price)
 * 
 * Only includes candles from the current session (resets at session anchor)
 */
export function computeSessionAnchoredVWAP(
  ohlcv: Candle[],
  opts: VwapOptions = {}
): number {
  if (ohlcv.length === 0) {
    throw new Error('No candles provided');
  }

  const { sessionAnchor = 'utc-midnight', source = 'hl2', lookbackPeriod, useAllCandles = false } = opts;

  // If useAllCandles is true, use all available candles (matches TradingView VWAP AA with Auto anchor)
  if (useAllCandles) {
    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;

    for (const candle of ohlcv) {
      const typicalPrice = getTypicalPrice(candle, source);
      cumulativePriceVolume += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }

    if (cumulativeVolume === 0) {
      return ohlcv[ohlcv.length - 1].close;
    }

    return cumulativePriceVolume / cumulativeVolume;
  }

  // If lookback period is specified, use fixed lookback (matches TradingView VWAP AA with fixed period)
  if (lookbackPeriod !== undefined && lookbackPeriod > 0) {
    const candlesToUse = ohlcv.slice(-lookbackPeriod);
    if (candlesToUse.length === 0) {
      return ohlcv[ohlcv.length - 1].close;
    }

    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;

    for (const candle of candlesToUse) {
      const typicalPrice = getTypicalPrice(candle, source);
      cumulativePriceVolume += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;
    }

    if (cumulativeVolume === 0) {
      return candlesToUse[candlesToUse.length - 1].close;
    }

    return cumulativePriceVolume / cumulativeVolume;
  }

  // Otherwise use session-anchored VWAP
  const lastCandle = ohlcv[ohlcv.length - 1];
  const sessionStartTs = getSessionStartTimestamp(lastCandle.ts, sessionAnchor);

  // Filter candles to only include those from the current session
  const sessionCandles = ohlcv.filter(candle => candle.ts >= sessionStartTs);

  if (sessionCandles.length === 0) {
    // Fallback: use last candle's close if no session candles
    return lastCandle.close;
  }

  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of sessionCandles) {
    const typicalPrice = getTypicalPrice(candle, source);
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }

  if (cumulativeVolume === 0) {
    // Fallback to last close if no volume
    return lastCandle.close;
  }

  return cumulativePriceVolume / cumulativeVolume;
}

/**
 * Compute progressive VWAP line (one value per candle)
 * 
 * Returns an array where each element is:
 * - null if candle is before session start
 * - VWAP value calculated from session start up to that candle
 */
export function computeSessionAnchoredVWAPLine(
  ohlcv: Candle[],
  opts: VwapOptions = {}
): (number | null)[] {
  if (ohlcv.length === 0) {
    return [];
  }

  const { sessionAnchor = 'utc-midnight', source = 'hl2', lookbackPeriod, useAllCandles = false } = opts;

  const vwapValues: (number | null)[] = [];

  // If useAllCandles is true, use cumulative VWAP from start (matches TradingView VWAP AA with Auto anchor)
  if (useAllCandles) {
    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;

    for (const candle of ohlcv) {
      const typicalPrice = getTypicalPrice(candle, source);
      cumulativePriceVolume += typicalPrice * candle.volume;
      cumulativeVolume += candle.volume;

      if (cumulativeVolume === 0) {
        vwapValues.push(candle.close);
      } else {
        vwapValues.push(cumulativePriceVolume / cumulativeVolume);
      }
    }

    return vwapValues;
  }

  // If lookback period is specified, use rolling window VWAP
  if (lookbackPeriod !== undefined && lookbackPeriod > 0) {
    for (let i = 0; i < ohlcv.length; i++) {
      const startIdx = Math.max(0, i - lookbackPeriod + 1);
      const windowCandles = ohlcv.slice(startIdx, i + 1);

      let cumulativePriceVolume = 0;
      let cumulativeVolume = 0;

      for (const candle of windowCandles) {
        const typicalPrice = getTypicalPrice(candle, source);
        cumulativePriceVolume += typicalPrice * candle.volume;
        cumulativeVolume += candle.volume;
      }

      if (cumulativeVolume === 0) {
        vwapValues.push(ohlcv[i].close);
      } else {
        vwapValues.push(cumulativePriceVolume / cumulativeVolume);
      }
    }

    return vwapValues;
  }

  // Otherwise use session-anchored VWAP
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  let currentSessionTs: number | null = null;

  for (const candle of ohlcv) {
    const candleSessionTs = getSessionStartTimestamp(candle.ts, sessionAnchor);

    if (currentSessionTs === null || candleSessionTs !== currentSessionTs) {
      currentSessionTs = candleSessionTs;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }

    // Add this candle's contribution
    const typicalPrice = getTypicalPrice(candle, source);
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    // Calculate VWAP up to this point
    if (cumulativeVolume === 0) {
      vwapValues.push(candle.close);
    } else {
      vwapValues.push(cumulativePriceVolume / cumulativeVolume);
    }
  }

  return vwapValues;
}

/**
 * Legacy function for backward compatibility
 * Uses hl2 source ((high+low)/2) and UTC midnight anchor
 * @deprecated Use computeSessionAnchoredVWAP directly
 */
export function vwapFromOHLCV(candles: Candle[]): number {
  return computeSessionAnchoredVWAP(candles, { source: 'hl2', sessionAnchor: 'utc-midnight' });
}

/**
 * Legacy function for backward compatibility
 * Uses hl2 source ((high+low)/2) and UTC midnight anchor
 * @deprecated Use computeSessionAnchoredVWAPLine directly
 */
export function vwapLineFromOHLCV(candles: Candle[]): (number | null)[] {
  return computeSessionAnchoredVWAPLine(candles, { source: 'hl2', sessionAnchor: 'utc-midnight' });
}
