/**
 * Orderflow / DOM Confirmation Layer
 * 
 * Analyzes order book and trade flow to determine market sentiment and confirmation signals.
 * Acts as a gatekeeper for trade entries from ORB, GARCH boundaries, and imbalance levels.
 */

import { getOrderBookSnapshot, type DepthSnapshot } from '../orderbook';
import type { Candle } from '../types';

export type OrderflowBias = 'long' | 'short' | 'neutral';

export interface OrderflowSignal {
  /** Market bias: buyers vs sellers in control */
  bias: OrderflowBias;
  /** Confidence level (0-1) */
  confidence: number;
  /** Flags indicating specific orderflow conditions */
  flags: {
    /** Absorbing bids (persistent buy pressure without price moving) */
    absorbingBids: boolean;
    /** Absorbing asks (persistent sell pressure without price moving) */
    absorbingAsks: boolean;
    /** High buy volume surge */
    buyVolumeSurge: boolean;
    /** High sell volume surge */
    sellVolumeSurge: boolean;
  };
}

export interface OrderflowConfig {
  /** Minimum notional value for significant wall detection (default: $50k) */
  minWallNotional: number;
  /** Proximity to level for wall detection in basis points (default: 5 = 0.05%) */
  wallProximityBps: number;
  /** Volume surge multiplier threshold (default: 2.0x average) */
  volumeSurgeMultiplier: number;
  /** Time window for volume surge detection in milliseconds (default: 5000 = 5s) */
  volumeSurgeWindowMs: number;
  /** Minimum confidence threshold (default: 0.3) */
  minConfidence: number;
}

const DEFAULT_CONFIG: OrderflowConfig = {
  minWallNotional: 50000,
  wallProximityBps: 5,
  volumeSurgeMultiplier: 2.0,
  volumeSurgeWindowMs: 5000,
  minConfidence: 0.3,
};

/**
 * Orderflow Analyzer
 */
export class OrderflowAnalyzer {
  private config: OrderflowConfig;
  private recentCandles: Candle[] = [];
  private volumeHistory: Array<{ timestamp: number; volume: number; side: 'buy' | 'sell' | 'unknown' }> = [];

  constructor(config: Partial<OrderflowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update with new candles for volume analysis
   */
  updateCandles(candles: Candle[]): void {
    this.recentCandles = candles.slice(-20); // Keep last 20 candles
  }

  /**
   * Analyze orderflow at a specific level
   */
  async analyzeOrderflow(
    symbol: string,
    level: number,
    currentPrice: number,
    side: 'LONG' | 'SHORT'
  ): Promise<OrderflowSignal> {
    // Get current order book snapshot
    const snapshot = getOrderBookSnapshot(symbol);

    if (!snapshot) {
      // No order book data - return neutral signal
      return this.getNeutralSignal();
    }

    // Analyze order book structure
    const { bias, confidence, flags } = this.analyzeOrderBook(
      snapshot,
      level,
      currentPrice,
      side
    );

    // Analyze volume flow
    const volumeFlags = this.analyzeVolumeFlow(side);

    return {
      bias,
      confidence,
      flags: {
        absorbingBids: flags.absorbingBids,
        absorbingAsks: flags.absorbingAsks,
        buyVolumeSurge: volumeFlags.buyVolumeSurge,
        sellVolumeSurge: volumeFlags.sellVolumeSurge,
      },
    };
  }

  /**
   * Analyze order book structure for bias and walls
   */
  private analyzeOrderBook(
    snapshot: DepthSnapshot,
    level: number,
    currentPrice: number,
    side: 'LONG' | 'SHORT'
  ): { bias: OrderflowBias; confidence: number; flags: OrderflowSignal['flags'] } {
    const { bids, asks } = snapshot;
    const proximity = (level * this.config.wallProximityBps) / 10000;

    // Aggregate notional near level
    let bidNotional = 0;
    let askNotional = 0;

    for (const bid of bids) {
      if (Math.abs(bid.price - level) <= proximity && bid.price <= level) {
        bidNotional += bid.price * bid.size;
      }
    }

    for (const ask of asks) {
      if (Math.abs(ask.price - level) <= proximity && ask.price >= level) {
        askNotional += ask.price * ask.size;
      }
    }

    // Calculate bias based on order book imbalance
    const totalNotional = bidNotional + askNotional;
    const bidRatio = totalNotional > 0 ? bidNotional / totalNotional : 0.5;
    const askRatio = 1 - bidRatio;

    let bias: OrderflowBias = 'neutral';
    let confidence = 0;
    const flags: OrderflowSignal['flags'] = {
      absorbingBids: false,
      absorbingAsks: false,
      buyVolumeSurge: false,
      sellVolumeSurge: false,
    };

    // For LONG entries: want buying pressure (bid walls)
    if (side === 'LONG') {
      if (bidNotional >= this.config.minWallNotional) {
        bias = 'long';
        confidence = Math.min(1, bidNotional / (this.config.minWallNotional * 2));
        flags.absorbingBids = bidRatio > 0.7; // Strong bid wall
      } else if (askNotional >= this.config.minWallNotional && currentPrice < level) {
        // Sell wall above price - potential resistance
        bias = 'short';
        confidence = Math.min(0.5, askNotional / (this.config.minWallNotional * 2));
        flags.absorbingAsks = true;
      }
    }

    // For SHORT entries: want selling pressure (ask walls)
    if (side === 'SHORT') {
      if (askNotional >= this.config.minWallNotional) {
        bias = 'short';
        confidence = Math.min(1, askNotional / (this.config.minWallNotional * 2));
        flags.absorbingAsks = askRatio > 0.7; // Strong ask wall
      } else if (bidNotional >= this.config.minWallNotional && currentPrice > level) {
        // Buy wall below price - potential support
        bias = 'long';
        confidence = Math.min(0.5, bidNotional / (this.config.minWallNotional * 2));
        flags.absorbingBids = true;
      }
    }

    // Adjust confidence based on price proximity to level
    const priceDistance = Math.abs(currentPrice - level);
    const priceDistancePct = (priceDistance / level) * 100;
    if (priceDistancePct > 0.5) {
      confidence *= 0.5; // Reduce confidence if price is far from level
    }

    return { bias, confidence: Math.max(0, Math.min(1, confidence)), flags };
  }

  /**
   * Analyze volume flow for surges
   */
  private analyzeVolumeFlow(side: 'LONG' | 'SHORT'): {
    buyVolumeSurge: boolean;
    sellVolumeSurge: boolean;
  } {
    if (this.recentCandles.length < 5) {
      return { buyVolumeSurge: false, sellVolumeSurge: false };
    }

    // Calculate average volume
    const volumes = this.recentCandles.map(c => c.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // Check most recent candles for volume surge
    const recentVolume = this.recentCandles.slice(-3).reduce((sum, c) => sum + c.volume, 0) / 3;

    const volumeSurgeThreshold = avgVolume * this.config.volumeSurgeMultiplier;
    const hasVolumeSurge = recentVolume >= volumeSurgeThreshold;

    // Estimate buy/sell volume from price action
    // This is simplified - in a real implementation, you'd track actual buy/sell volume
    let buyVolumeSurge = false;
    let sellVolumeSurge = false;

    if (hasVolumeSurge && this.recentCandles.length >= 3) {
      const recentCandles = this.recentCandles.slice(-3);
      const bullishCandles = recentCandles.filter(c => c.close > c.open).length;
      const bearishCandles = recentCandles.filter(c => c.close < c.open).length;

      if (side === 'LONG') {
        buyVolumeSurge = bullishCandles >= 2 && hasVolumeSurge;
      } else {
        sellVolumeSurge = bearishCandles >= 2 && hasVolumeSurge;
      }
    }

    return { buyVolumeSurge, sellVolumeSurge };
  }

  /**
   * Check if orderflow confirms a trade direction
   */
  confirmsTrade(orderflow: OrderflowSignal, tradeSide: 'LONG' | 'SHORT'): boolean {
    if (orderflow.confidence < this.config.minConfidence) {
      return false;
    }

    if (tradeSide === 'LONG' && orderflow.bias === 'long') {
      return true;
    }

    if (tradeSide === 'SHORT' && orderflow.bias === 'short') {
      return true;
    }

    return false;
  }

  /**
   * Get neutral signal
   */
  private getNeutralSignal(): OrderflowSignal {
    return {
      bias: 'neutral',
      confidence: 0,
      flags: {
        absorbingBids: false,
        absorbingAsks: false,
        buyVolumeSurge: false,
        sellVolumeSurge: false,
      },
    };
  }
}

