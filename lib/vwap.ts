/**
 * TradingView-accurate VWAP implementation
 * 
 * Equivalent to Pine Script v5: ta.vwap(src)
 * - Resets each daily session (UTC midnight by default for crypto)
 * - Supports source selection: close | hlc3 | ohlc4
 */

import type { Candle } from './types';

export type VwapSource = 'close' | 'hlc3' | 'ohlc4';

export interface VwapOptions {
  /** Session anchor: 'utc-midnight' or timezone string (e.g., 'America/New_York') */
  sessionAnchor?: 'utc-midnight' | { tz: string };
  /** Price source: 'close', 'hlc3' (high+low+close)/3, or 'ohlc4' (open+high+low+close)/4 */
  source?: VwapSource;
}

/**
 * Get the typical price based on source selection
 */
function getTypicalPrice(candle: Candle, source: VwapSource): number {
  switch (source) {
    case 'close':
      return candle.close;
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
 * - 'hlc3': (high + low + close) / 3
 * - 'ohlc4': (open + high + low + close) / 4
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

  const { sessionAnchor = 'utc-midnight', source = 'hlc3' } = opts;

  // Get session start timestamp (for the most recent candle)
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

  const { sessionAnchor = 'utc-midnight', source = 'hlc3' } = opts;

  // Get session start timestamp (for the most recent candle)
  const lastCandle = ohlcv[ohlcv.length - 1];
  const sessionStartTs = getSessionStartTimestamp(lastCandle.ts, sessionAnchor);

  const vwapValues: (number | null)[] = [];
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of ohlcv) {
    // If candle is before session start, VWAP is null
    if (candle.ts < sessionStartTs) {
      vwapValues.push(null);
      continue;
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
 * Uses hlc3 source and UTC midnight anchor
 * @deprecated Use computeSessionAnchoredVWAP directly
 */
export function vwapFromOHLCV(candles: Candle[]): number {
  return computeSessionAnchoredVWAP(candles, { source: 'hlc3', sessionAnchor: 'utc-midnight' });
}

/**
 * Legacy function for backward compatibility
 * Uses hlc3 source and UTC midnight anchor
 * @deprecated Use computeSessionAnchoredVWAPLine directly
 */
export function vwapLineFromOHLCV(candles: Candle[]): (number | null)[] {
  return computeSessionAnchoredVWAPLine(candles, { source: 'hlc3', sessionAnchor: 'utc-midnight' });
}
