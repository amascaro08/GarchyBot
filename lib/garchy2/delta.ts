/**
 * Delta Analysis Module
 * 
 * Analyzes cumulative volume delta (CVD) to confirm trending momentum.
 * Delta = Buy Volume - Sell Volume (estimated from candle closes)
 * 
 * Key concepts:
 * - Positive delta → buying pressure (bullish)
 * - Negative delta → selling pressure (bearish)
 * - Divergence detection → price vs delta mismatch
 */

import type { Candle } from '../types';

export interface DeltaSignal {
  /** Current cumulative delta */
  cumulativeDelta: number;
  /** Delta trend (positive = bullish, negative = bearish) */
  trend: 'bullish' | 'bearish' | 'neutral';
  /** Delta divergence detected (price up but delta down = bearish div) */
  divergence: 'bullish' | 'bearish' | null;
  /** Confidence level (0-1) */
  confidence: number;
  /** Additional context */
  context: {
    /** Recent delta values */
    recentDeltas: number[];
    /** Delta momentum (rate of change) */
    momentum: number;
    /** Volume-weighted delta */
    volumeWeightedDelta: number;
  };
}

export interface DeltaConfig {
  /** Window size for delta calculation (default: 20 candles) */
  windowSize: number;
  /** Divergence lookback period (default: 10 candles) */
  divergenceLookback: number;
  /** Minimum confidence threshold (default: 0.4) */
  minConfidence: number;
}

const DEFAULT_CONFIG: DeltaConfig = {
  windowSize: 20,
  divergenceLookback: 10,
  minConfidence: 0.4,
};

/**
 * Delta Analyzer
 */
export class DeltaAnalyzer {
  private config: DeltaConfig;
  private deltaHistory: number[] = [];
  private cumulativeDelta: number = 0;

  constructor(config: Partial<DeltaConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate delta from candles
   * Delta = estimated buy volume - estimated sell volume
   * 
   * Estimation method:
   * - Bullish candle (close > open): buy volume = volume * ((close - low) / (high - low))
   * - Bearish candle (close < open): sell volume = volume * ((high - close) / (high - low))
   */
  analyzeDelta(candles: Candle[]): DeltaSignal {
    if (candles.length < this.config.windowSize) {
      return this.getNeutralSignal();
    }

    // Get recent candles for analysis
    const recentCandles = candles.slice(-this.config.windowSize);

    // Calculate delta for each candle
    const deltas: number[] = [];
    let cumulativeDelta = 0;
    let volumeWeightedDelta = 0;
    let totalVolume = 0;

    for (const candle of recentCandles) {
      const { open, high, low, close, volume } = candle;
      
      // Skip invalid candles
      if (high === low || volume === 0) {
        deltas.push(0);
        continue;
      }

      // Calculate delta using candle structure
      let delta = 0;
      const range = high - low;
      
      if (close > open) {
        // Bullish candle - more buying
        const buyPressure = (close - low) / range;
        delta = volume * buyPressure;
      } else if (close < open) {
        // Bearish candle - more selling
        const sellPressure = (high - close) / range;
        delta = -volume * sellPressure;
      } else {
        // Doji - neutral (use body position in range)
        const position = (close - low) / range;
        delta = volume * (position - 0.5) * 2; // Scale to -1 to 1
      }

      deltas.push(delta);
      cumulativeDelta += delta;
      volumeWeightedDelta += delta * volume;
      totalVolume += volume;
    }

    // Normalize volume-weighted delta
    volumeWeightedDelta = totalVolume > 0 ? volumeWeightedDelta / totalVolume : 0;

    // Update internal state
    this.deltaHistory = deltas;
    this.cumulativeDelta = cumulativeDelta;

    // Determine trend
    const trend = this.calculateDeltaTrend(deltas, cumulativeDelta);

    // Check for divergence
    const divergence = this.detectDivergence(
      candles.slice(-this.config.divergenceLookback),
      deltas.slice(-this.config.divergenceLookback)
    );

    // Calculate momentum (rate of change in delta)
    const momentum = this.calculateMomentum(deltas);

    // Calculate confidence
    const confidence = this.calculateConfidence(cumulativeDelta, momentum, divergence);

    return {
      cumulativeDelta,
      trend,
      divergence,
      confidence,
      context: {
        recentDeltas: deltas,
        momentum,
        volumeWeightedDelta,
      },
    };
  }

  /**
   * Determine delta trend
   */
  private calculateDeltaTrend(
    deltas: number[],
    cumulativeDelta: number
  ): 'bullish' | 'bearish' | 'neutral' {
    if (deltas.length < 5) {
      return 'neutral';
    }

    // Check recent trend (last 5 candles)
    const recentDeltas = deltas.slice(-5);
    const recentSum = recentDeltas.reduce((sum, d) => sum + d, 0);
    const avgRecentDelta = recentSum / recentDeltas.length;

    // Require both cumulative and recent trend alignment
    const cumulativeTrend = cumulativeDelta > 0 ? 'bullish' : cumulativeDelta < 0 ? 'bearish' : 'neutral';
    const recentTrend = avgRecentDelta > 0 ? 'bullish' : avgRecentDelta < 0 ? 'bearish' : 'neutral';

    // Strong signal: both align
    if (cumulativeTrend === recentTrend && cumulativeTrend !== 'neutral') {
      return cumulativeTrend;
    }

    // Recent trend takes precedence (more current)
    if (Math.abs(avgRecentDelta) > Math.abs(cumulativeDelta) * 0.2) {
      return recentTrend;
    }

    return 'neutral';
  }

  /**
   * Detect divergence between price and delta
   * Bullish divergence: price makes lower low, but delta makes higher low
   * Bearish divergence: price makes higher high, but delta makes lower high
   */
  private detectDivergence(
    candles: Candle[],
    deltas: number[]
  ): 'bullish' | 'bearish' | null {
    if (candles.length < 5 || deltas.length < 5) {
      return null;
    }

    // Find price extremes
    const prices = candles.map(c => c.close);
    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));

    const firstHalfLow = Math.min(...firstHalf);
    const secondHalfLow = Math.min(...secondHalf);
    const firstHalfHigh = Math.max(...firstHalf);
    const secondHalfHigh = Math.max(...secondHalf);

    // Find delta extremes
    const firstHalfDeltas = deltas.slice(0, Math.floor(deltas.length / 2));
    const secondHalfDeltas = deltas.slice(Math.floor(deltas.length / 2));

    const firstDeltaLow = Math.min(...firstHalfDeltas);
    const secondDeltaLow = Math.min(...secondHalfDeltas);
    const firstDeltaHigh = Math.max(...firstHalfDeltas);
    const secondDeltaHigh = Math.max(...secondHalfDeltas);

    // Bullish divergence: lower price low, but higher delta low
    if (secondHalfLow < firstHalfLow && secondDeltaLow > firstDeltaLow) {
      return 'bullish';
    }

    // Bearish divergence: higher price high, but lower delta high
    if (secondHalfHigh > firstHalfHigh && secondDeltaHigh < firstDeltaHigh) {
      return 'bearish';
    }

    return null;
  }

  /**
   * Calculate delta momentum (rate of change)
   */
  private calculateMomentum(deltas: number[]): number {
    if (deltas.length < 2) {
      return 0;
    }

    // Calculate simple momentum: difference between recent and older averages
    const recentWindow = Math.min(5, Math.floor(deltas.length / 2));
    const recent = deltas.slice(-recentWindow);
    const older = deltas.slice(-recentWindow * 2, -recentWindow);

    const recentAvg = recent.reduce((sum, d) => sum + d, 0) / recent.length;
    const olderAvg = older.length > 0 
      ? older.reduce((sum, d) => sum + d, 0) / older.length 
      : 0;

    return recentAvg - olderAvg;
  }

  /**
   * Calculate confidence in delta signal
   */
  private calculateConfidence(
    cumulativeDelta: number,
    momentum: number,
    divergence: 'bullish' | 'bearish' | null
  ): number {
    let confidence = 0.5; // Base confidence

    // Delta magnitude contribution (0-0.3)
    const deltaMagnitude = Math.abs(cumulativeDelta);
    const normalizedDelta = Math.min(1, deltaMagnitude / 10000); // Normalize to 0-1
    confidence += normalizedDelta * 0.3;

    // Momentum contribution (0-0.3)
    const momentumMagnitude = Math.abs(momentum);
    const normalizedMomentum = Math.min(1, momentumMagnitude / 5000);
    confidence += normalizedMomentum * 0.3;

    // Divergence penalty/bonus (±0.2)
    if (divergence !== null) {
      // Divergence detected - this is actually a useful signal
      confidence += 0.2;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Check if delta confirms a trade direction
   */
  confirmsTrade(deltaSignal: DeltaSignal, tradeSide: 'LONG' | 'SHORT'): boolean {
    if (deltaSignal.confidence < this.config.minConfidence) {
      return false;
    }

    // For LONG: want bullish delta or bullish divergence
    if (tradeSide === 'LONG') {
      return deltaSignal.trend === 'bullish' || 
             deltaSignal.divergence === 'bullish' ||
             (deltaSignal.trend === 'neutral' && deltaSignal.cumulativeDelta > 0);
    }

    // For SHORT: want bearish delta or bearish divergence
    if (tradeSide === 'SHORT') {
      return deltaSignal.trend === 'bearish' || 
             deltaSignal.divergence === 'bearish' ||
             (deltaSignal.trend === 'neutral' && deltaSignal.cumulativeDelta < 0);
    }

    return false;
  }

  /**
   * Get neutral signal (no data)
   */
  private getNeutralSignal(): DeltaSignal {
    return {
      cumulativeDelta: 0,
      trend: 'neutral',
      divergence: null,
      confidence: 0,
      context: {
        recentDeltas: [],
        momentum: 0,
        volumeWeightedDelta: 0,
      },
    };
  }

  /**
   * Get current cumulative delta
   */
  getCumulativeDelta(): number {
    return this.cumulativeDelta;
  }

  /**
   * Get delta history
   */
  getDeltaHistory(): number[] {
    return this.deltaHistory;
  }
}
