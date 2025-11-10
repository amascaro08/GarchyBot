import { describe, it, expect } from 'vitest';
import { computeSessionAnchoredVWAP, computeSessionAnchoredVWAPLine, VwapSource } from '../lib/vwap';
import type { Candle } from '../lib/types';

describe('TradingView-accurate VWAP', () => {
  /**
   * TradingView Pine Script v5 reference:
   * ```pinescript
   * //@version=5
   * indicator("VWAP Test")
   * vwap_close = ta.vwap(close)
   * vwap_hlc3 = ta.vwap(hlc3)
   * vwap_ohlc4 = ta.vwap(ohlc4)
   * ```
   * 
   * VWAP resets at daily session start (UTC midnight for crypto)
   */

  // Create test candles for a single UTC day
  const createCandles = (baseTime: number, count: number): Candle[] => {
    const candles: Candle[] = [];
    let price = 100;
    
    for (let i = 0; i < count; i++) {
      const time = baseTime + i * 5 * 60 * 1000; // 5-minute candles
      const change = (Math.random() - 0.5) * 0.02; // ±1% random change
      const open = price;
      const close = price * (1 + change);
      const high = Math.max(open, close) * (1 + Math.abs(change) * 0.5);
      const low = Math.min(open, close) * (1 - Math.abs(change) * 0.5);
      const volume = 1000 + Math.random() * 500;
      
      candles.push({
        ts: time,
        open,
        high,
        low,
        close,
        volume,
      });
      
      price = close;
    }
    
    return candles;
  };

  // Get UTC midnight timestamp
  const getUTCMidnight = (timestamp: number): number => {
    const date = new Date(timestamp);
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0, 0, 0, 0
    );
  };

  it('should calculate VWAP with hlc3 source (default)', () => {
    const midnight = getUTCMidnight(Date.now());
    const candles = createCandles(midnight, 10);
    
    const vwap = computeSessionAnchoredVWAP(candles, { source: 'hlc3' });
    
    // Manual calculation for verification
    let totalPriceVolume = 0;
    let totalVolume = 0;
    
    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      totalPriceVolume += typicalPrice * candle.volume;
      totalVolume += candle.volume;
    }
    
    const expectedVWAP = totalPriceVolume / totalVolume;
    
    expect(vwap).toBeCloseTo(expectedVWAP, 6);
    expect(vwap).toBeGreaterThan(0);
  });

  it('should calculate VWAP with close source', () => {
    const midnight = getUTCMidnight(Date.now());
    const candles = createCandles(midnight, 10);
    
    const vwap = computeSessionAnchoredVWAP(candles, { source: 'close' });
    
    // Manual calculation
    let totalPriceVolume = 0;
    let totalVolume = 0;
    
    for (const candle of candles) {
      totalPriceVolume += candle.close * candle.volume;
      totalVolume += candle.volume;
    }
    
    const expectedVWAP = totalPriceVolume / totalVolume;
    
    expect(vwap).toBeCloseTo(expectedVWAP, 6);
  });

  it('should calculate VWAP with ohlc4 source', () => {
    const midnight = getUTCMidnight(Date.now());
    const candles = createCandles(midnight, 10);
    
    const vwap = computeSessionAnchoredVWAP(candles, { source: 'ohlc4' });
    
    // Manual calculation
    let totalPriceVolume = 0;
    let totalVolume = 0;
    
    for (const candle of candles) {
      const typicalPrice = (candle.open + candle.high + candle.low + candle.close) / 4;
      totalPriceVolume += typicalPrice * candle.volume;
      totalVolume += candle.volume;
    }
    
    const expectedVWAP = totalPriceVolume / totalVolume;
    
    expect(vwap).toBeCloseTo(expectedVWAP, 6);
  });

  it('should reset VWAP at UTC midnight', () => {
    // Create candles spanning two UTC days
    const day1Midnight = getUTCMidnight(Date.now());
    const day2Midnight = day1Midnight + 24 * 60 * 60 * 1000;
    
    const day1Candles = createCandles(day1Midnight + 60 * 60 * 1000, 5); // Start 1 hour after midnight
    const day2Candles = createCandles(day2Midnight + 60 * 60 * 1000, 5);
    
    const allCandles = [...day1Candles, ...day2Candles];
    
    // VWAP should only include day2 candles (most recent session)
    const vwap = computeSessionAnchoredVWAP(allCandles);
    
    // Calculate expected VWAP from day2 only
    let totalPriceVolume = 0;
    let totalVolume = 0;
    
    for (const candle of day2Candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      totalPriceVolume += typicalPrice * candle.volume;
      totalVolume += candle.volume;
    }
    
    const expectedVWAP = totalPriceVolume / totalVolume;
    
    expect(vwap).toBeCloseTo(expectedVWAP, 6);
  });

  it('should return progressive VWAP line', () => {
    const midnight = getUTCMidnight(Date.now());
    const candles = createCandles(midnight, 5);
    
    const vwapLine = computeSessionAnchoredVWAPLine(candles, { source: 'hlc3' });
    
    expect(vwapLine.length).toBe(candles.length);
    
    // All values should be numbers (not null) since all candles are in same session
    for (const vwap of vwapLine) {
      expect(vwap).not.toBeNull();
      expect(typeof vwap).toBe('number');
      expect(vwap!).toBeGreaterThan(0);
    }
    
    // Last VWAP should match single VWAP calculation
    const singleVWAP = computeSessionAnchoredVWAP(candles, { source: 'hlc3' });
    expect(vwapLine[vwapLine.length - 1]).toBeCloseTo(singleVWAP, 6);
  });

  it('should return null for candles before session start', () => {
    const midnight = getUTCMidnight(Date.now());
    const beforeMidnight = midnight - 2 * 60 * 60 * 1000; // 2 hours before
    const afterMidnight = midnight + 2 * 60 * 60 * 1000; // 2 hours after
    
    const beforeCandles = createCandles(beforeMidnight, 3);
    const afterCandles = createCandles(afterMidnight, 3);
    const allCandles = [...beforeCandles, ...afterCandles];
    
    const vwapLine = computeSessionAnchoredVWAPLine(allCandles);
    
    // First 3 should be null (before session)
    for (let i = 0; i < 3; i++) {
      expect(vwapLine[i]).toBeNull();
    }
    
    // Last 3 should be numbers (after session start)
    for (let i = 3; i < 6; i++) {
      expect(vwapLine[i]).not.toBeNull();
      expect(typeof vwapLine[i]).toBe('number');
    }
  });

  it('should handle empty candle array', () => {
    expect(() => {
      computeSessionAnchoredVWAP([]);
    }).toThrow('No candles provided');
    
    const emptyLine = computeSessionAnchoredVWAPLine([]);
    expect(emptyLine).toEqual([]);
  });

  it('should handle zero volume candles', () => {
    const midnight = getUTCMidnight(Date.now());
    const candles: Candle[] = [
      {
        ts: midnight + 60 * 60 * 1000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 0,
      },
      {
        ts: midnight + 2 * 60 * 60 * 1000,
        open: 100.5,
        high: 101.5,
        low: 99.5,
        close: 101,
        volume: 1000,
      },
    ];
    
    // Should fallback to last close if all volumes are zero
    // Or use the candle with volume
    const vwap = computeSessionAnchoredVWAP(candles);
    
    // Should use the candle with volume (second candle)
    // VWAP = hlc3 of second candle since first has zero volume
    // hlc3 = (101.5 + 99.5 + 101) / 3 = 100.6667
    expect(vwap).toBeGreaterThan(0);
    expect(vwap).toBeCloseTo(100.6667, 1); // hlc3 of second candle
  });

  /**
   * TradingView reference test
   * Using known OHLCV data that matches TradingView output
   */
  it('should match TradingView Pine Script ta.vwap(hlc3) output', () => {
    // Known test data that produces predictable VWAP
    const midnight = getUTCMidnight(Date.now());
    const candles: Candle[] = [
      { ts: midnight + 60 * 60 * 1000, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
      { ts: midnight + 2 * 60 * 60 * 1000, open: 100.5, high: 102, low: 100, close: 101.5, volume: 2000 },
      { ts: midnight + 3 * 60 * 60 * 1000, open: 101.5, high: 102.5, low: 101, close: 102, volume: 1500 },
    ];
    
    // TradingView calculation: hlc3 = (high + low + close) / 3
    // VWAP = Σ(hlc3 * volume) / Σ(volume)
    const hlc3_1 = (101 + 99 + 100.5) / 3; // 100.1667
    const hlc3_2 = (102 + 100 + 101.5) / 3; // 101.1667
    const hlc3_3 = (102.5 + 101 + 102) / 3; // 101.8333
    
    const totalPriceVolume = hlc3_1 * 1000 + hlc3_2 * 2000 + hlc3_3 * 1500;
    const totalVolume = 1000 + 2000 + 1500;
    const expectedVWAP = totalPriceVolume / totalVolume; // ≈ 101.1667
    
    const vwap = computeSessionAnchoredVWAP(candles, { source: 'hlc3' });
    
    expect(vwap).toBeCloseTo(expectedVWAP, 4);
  });

  it('should handle different source types correctly', () => {
    const midnight = getUTCMidnight(Date.now());
    const candles: Candle[] = [
      { ts: midnight + 60 * 60 * 1000, open: 100, high: 102, low: 98, close: 101, volume: 1000 },
      { ts: midnight + 2 * 60 * 60 * 1000, open: 101, high: 103, low: 99, close: 102, volume: 1000 },
    ];
    
    const vwapClose = computeSessionAnchoredVWAP(candles, { source: 'close' });
    const vwapHlc3 = computeSessionAnchoredVWAP(candles, { source: 'hlc3' });
    const vwapOhlc4 = computeSessionAnchoredVWAP(candles, { source: 'ohlc4' });
    
    // All should be different (unless coincidentally equal)
    expect(vwapClose).toBeGreaterThan(0);
    expect(vwapHlc3).toBeGreaterThan(0);
    expect(vwapOhlc4).toBeGreaterThan(0);
    
    // Verify calculations
    // Close: (101*1000 + 102*1000) / 2000 = 101.5
    expect(vwapClose).toBeCloseTo(101.5, 4);
    
    // HLC3: ((102+98+101)/3*1000 + (103+99+102)/3*1000) / 2000 ≈ 100.333
    const hlc3_1 = (102 + 98 + 101) / 3;
    const hlc3_2 = (103 + 99 + 102) / 3;
    const expectedHlc3 = (hlc3_1 * 1000 + hlc3_2 * 1000) / 2000;
    expect(vwapHlc3).toBeCloseTo(expectedHlc3, 4);
    
    // OHLC4: ((100+102+98+101)/4*1000 + (101+103+99+102)/4*1000) / 2000
    const ohlc4_1 = (100 + 102 + 98 + 101) / 4;
    const ohlc4_2 = (101 + 103 + 99 + 102) / 4;
    const expectedOhlc4 = (ohlc4_1 * 1000 + ohlc4_2 * 1000) / 2000;
    expect(vwapOhlc4).toBeCloseTo(expectedOhlc4, 4);
  });
});
