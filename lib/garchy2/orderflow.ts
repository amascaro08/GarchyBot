/**
 * Orderflow / DOM Confirmation Layer
 * 
 * Analyzes order book and trade flow to determine market sentiment and confirmation signals.
 * Acts as a gatekeeper for trade entries from ORB, GARCH boundaries, and imbalance levels.
 */

import { getOrderBookSnapshot, startOrderBook, type DepthSnapshot } from '../orderbook';
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
    // Detect if we're in a serverless environment (Vercel cron, etc.)
    // WebSocket works in browser and long-running servers, but not in serverless functions
    const isServerless = !!process.env.VERCEL;
    
    // Get current order book snapshot (from WebSocket if available)
    let snapshot = getOrderBookSnapshot(symbol);

    // If no snapshot, try to get one
    if (!snapshot || snapshot.bids.length === 0 || snapshot.asks.length === 0) {
      // In serverless, WebSocket won't work, so try REST API first
      // In browser/server, try WebSocket first (better for real-time)
      if (isServerless) {
        console.log(`[ORDERFLOW] Serverless environment detected, fetching orderbook via REST API for ${symbol}...`);
        const { fetchOrderBookSnapshot } = await import('../orderbook');
        snapshot = await fetchOrderBookSnapshot(symbol, 50);
        
        if (snapshot && snapshot.bids.length > 0 && snapshot.asks.length > 0) {
          console.log(`[ORDERFLOW] ✓ Orderbook data fetched via REST API for ${symbol} (${snapshot.bids.length} bids, ${snapshot.asks.length} asks)`);
        }
      } else {
        // Not serverless - try WebSocket first (better for real-time updates)
        console.log(`[ORDERFLOW] No orderbook snapshot in buffer for ${symbol}, starting WebSocket...`);
        startOrderBook(symbol);
        
        // Wait for WebSocket to connect and receive data
        // Give it up to 500ms to get initial data
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          snapshot = getOrderBookSnapshot(symbol);
          if (snapshot && snapshot.bids.length > 0 && snapshot.asks.length > 0) {
            console.log(`[ORDERFLOW] ✓ Orderbook data received via WebSocket for ${symbol} after ${(i + 1) * 50}ms`);
            break;
          }
        }
        
        // If WebSocket failed, fallback to REST API
        if (!snapshot || snapshot.bids.length === 0 || snapshot.asks.length === 0) {
          console.log(`[ORDERFLOW] WebSocket failed, falling back to REST API for ${symbol}...`);
          const { fetchOrderBookSnapshot } = await import('../orderbook');
          snapshot = await fetchOrderBookSnapshot(symbol, 50);
          
          if (snapshot && snapshot.bids.length > 0 && snapshot.asks.length > 0) {
            console.log(`[ORDERFLOW] ✓ Orderbook data fetched via REST API fallback for ${symbol} (${snapshot.bids.length} bids, ${snapshot.asks.length} asks)`);
          }
        }
      }
      
      // If still no snapshot after all attempts, use fallback
      if (!snapshot || snapshot.bids.length === 0 || snapshot.asks.length === 0) {
        console.log(`[ORDERFLOW] No orderbook snapshot available for ${symbol} (all methods failed), using price action fallback`);
        const fallbackSignal = this.getFallbackSignal(side, currentPrice, level);
        console.log(`[ORDERFLOW] Fallback signal: bias=${fallbackSignal.bias}, confidence=${fallbackSignal.confidence.toFixed(2)}`);
        return fallbackSignal;
      }
    } else {
      console.log(`[ORDERFLOW] Using cached WebSocket orderbook snapshot for ${symbol} (${snapshot.bids.length} bids, ${snapshot.asks.length} asks)`);
    }

    // Log orderbook snapshot details
    console.log(`[ORDERFLOW] Orderbook snapshot details:`);
    console.log(`  Total bids: ${snapshot.bids.length}, Total asks: ${snapshot.asks.length}`);
    if (snapshot.bids.length > 0) {
      console.log(`  Best bid: $${snapshot.bids[0].price.toFixed(2)} (size: ${snapshot.bids[0].size.toFixed(4)})`);
    }
    if (snapshot.asks.length > 0) {
      console.log(`  Best ask: $${snapshot.asks[0].price.toFixed(2)} (size: ${snapshot.asks[0].size.toFixed(4)})`);
    }
    console.log(`  Target level: $${level.toFixed(2)}, Current price: $${currentPrice.toFixed(2)}`);

    // Analyze order book structure
    const { bias, confidence, flags } = this.analyzeOrderBook(
      snapshot,
      level,
      currentPrice,
      side
    );

    // Calculate notional values for logging
    const proximity = (level * this.config.wallProximityBps) / 10000;
    console.log(`[ORDERFLOW] Proximity check: ±$${proximity.toFixed(2)} (${this.config.wallProximityBps} bps) from level $${level.toFixed(2)}`);
    console.log(`[ORDERFLOW]   Level range: $${(level - proximity).toFixed(2)} to $${(level + proximity).toFixed(2)}`);
    
    let bidNotional = 0;
    let askNotional = 0;
    let bidsNearLevel = 0;
    let asksNearLevel = 0;
    
    // Log a few sample prices to verify data
    if (snapshot.bids.length > 0) {
      console.log(`[ORDERFLOW] Sample bid prices: ${snapshot.bids.slice(0, 5).map(b => `$${b.price.toFixed(2)}`).join(', ')}`);
    }
    if (snapshot.asks.length > 0) {
      console.log(`[ORDERFLOW] Sample ask prices: ${snapshot.asks.slice(0, 5).map(a => `$${a.price.toFixed(2)}`).join(', ')}`);
    }
    
    for (const bid of snapshot.bids) {
      const distance = Math.abs(bid.price - level);
      const withinProximity = distance <= proximity;
      const belowOrAtLevel = bid.price <= level;
      if (withinProximity && belowOrAtLevel) {
        bidNotional += bid.price * bid.size;
        bidsNearLevel++;
      }
    }
    for (const ask of snapshot.asks) {
      const distance = Math.abs(ask.price - level);
      const withinProximity = distance <= proximity;
      const aboveOrAtLevel = ask.price >= level;
      if (withinProximity && aboveOrAtLevel) {
        askNotional += ask.price * ask.size;
        asksNearLevel++;
      }
    }

    console.log(`[ORDERFLOW] Orderbook analysis: bias=${bias}, confidence=${confidence.toFixed(2)}`);
    console.log(`[ORDERFLOW]   Bids near level: ${bidsNearLevel}, Notional: $${bidNotional.toFixed(0)}`);
    console.log(`[ORDERFLOW]   Asks near level: ${asksNearLevel}, Notional: $${askNotional.toFixed(0)}`);
    console.log(`[ORDERFLOW]   Min required: $${this.config.minWallNotional}`);

    // If orderbook confidence is very low (< 0.2), use fallback logic (price action + volume)
    // This handles cases where orderbook data exists but doesn't show clear walls
    if (confidence < 0.2) {
      console.log(`[ORDERFLOW] Orderbook confidence too low (${confidence.toFixed(2)}), using enhanced fallback`);
      const fallbackSignal = this.getFallbackSignal(side, currentPrice, level);
      
      // Combine orderbook bias (if any) with fallback
      let combinedBias = fallbackSignal.bias;
      let combinedConfidence = fallbackSignal.confidence;
      
      // If orderbook shows some bias (even if low confidence), use it
      if (bias !== 'neutral' && confidence > 0) {
        combinedBias = bias;
        // Boost confidence slightly if orderbook and fallback agree
        if (bias === fallbackSignal.bias) {
          combinedConfidence = Math.min(0.5, fallbackSignal.confidence + confidence * 0.2);
        }
      }
      
      // Analyze volume flow
      const volumeFlags = this.analyzeVolumeFlow(side);
      console.log(`[ORDERFLOW] Volume flow: buySurge=${volumeFlags.buyVolumeSurge}, sellSurge=${volumeFlags.sellVolumeSurge}`);
      
      // Enhance with volume flow
      if ((side === 'LONG' && volumeFlags.buyVolumeSurge) || 
          (side === 'SHORT' && volumeFlags.sellVolumeSurge)) {
        if (combinedBias === (side === 'LONG' ? 'long' : 'short')) {
          combinedConfidence = Math.max(combinedConfidence, 0.4);
          console.log(`[ORDERFLOW] Volume surge confirms bias, boosting confidence to ${combinedConfidence.toFixed(2)}`);
        }
      }
      
      const result = {
        bias: combinedBias,
        confidence: combinedConfidence,
        flags: {
          absorbingBids: flags.absorbingBids,
          absorbingAsks: flags.absorbingAsks,
          buyVolumeSurge: volumeFlags.buyVolumeSurge,
          sellVolumeSurge: volumeFlags.sellVolumeSurge,
        },
      };
      
      console.log(`[ORDERFLOW] Final signal (enhanced fallback): bias=${result.bias}, confidence=${result.confidence.toFixed(2)}`);
      return result;
    }

    // Analyze volume flow for high-confidence orderbook signals
    const volumeFlags = this.analyzeVolumeFlow(side);
    console.log(`[ORDERFLOW] Volume flow: buySurge=${volumeFlags.buyVolumeSurge}, sellSurge=${volumeFlags.sellVolumeSurge}`);
    
    // Enhance high-confidence signals with volume
    let finalConfidence = confidence;
    if ((side === 'LONG' && volumeFlags.buyVolumeSurge) || 
        (side === 'SHORT' && volumeFlags.sellVolumeSurge)) {
      finalConfidence = Math.min(1, confidence * 1.1); // Slight boost
      console.log(`[ORDERFLOW] Volume surge detected, boosting confidence from ${confidence.toFixed(2)} to ${finalConfidence.toFixed(2)}`);
    }

    const result = {
      bias,
      confidence: finalConfidence,
      flags: {
        absorbingBids: flags.absorbingBids,
        absorbingAsks: flags.absorbingAsks,
        buyVolumeSurge: volumeFlags.buyVolumeSurge,
        sellVolumeSurge: volumeFlags.sellVolumeSurge,
      },
    };
    
    console.log(`[ORDERFLOW] Final signal: bias=${result.bias}, confidence=${result.confidence.toFixed(2)}`);
    return result;
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
    // If confidence is very low (< 0.2), use a lower threshold for fallback signals
    // This allows signals when orderbook isn't available but we have price/volume confirmation
    const minConf = orderflow.confidence < 0.2 ? 0.2 : this.config.minConfidence;
    
    if (orderflow.confidence < minConf) {
      console.log(`[ORDERFLOW] Trade not confirmed - Confidence: ${orderflow.confidence.toFixed(2)}, Required: ${minConf}, Bias: ${orderflow.bias}, Trade side: ${tradeSide}`);
      return false;
    }

    if (tradeSide === 'LONG' && orderflow.bias === 'long') {
      return true;
    }

    if (tradeSide === 'SHORT' && orderflow.bias === 'short') {
      return true;
    }

    // If bias is neutral but confidence is high enough, allow it (fallback mode)
    if (orderflow.bias === 'neutral' && orderflow.confidence >= 0.3) {
      console.log(`[ORDERFLOW] Allowing trade with neutral bias due to sufficient confidence (${orderflow.confidence.toFixed(2)})`);
      return true;
    }

    console.log(`[ORDERFLOW] Trade not confirmed - Bias mismatch: ${orderflow.bias} vs ${tradeSide}`);
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

  /**
   * Get fallback signal when orderbook isn't available
   * Uses price action and volume analysis instead
   */
  private getFallbackSignal(
    side: 'LONG' | 'SHORT',
    currentPrice: number,
    level: number
  ): OrderflowSignal {
    // Check volume flow for basic bias
    const volumeFlags = this.analyzeVolumeFlow(side);
    
    // Simple price-action based bias
    // If price is above level and we want long, or below level and we want short, slight bias
    const priceDistancePct = ((currentPrice - level) / level) * 100;
    
    let bias: OrderflowBias = 'neutral';
    let confidence = 0.3; // Low confidence when orderbook unavailable
    
    if (side === 'LONG') {
      // For long, want price at or near level (support)
      if (currentPrice >= level && currentPrice <= level * 1.001) {
        bias = 'long';
        confidence = 0.4; // Slightly higher if price is at level
      } else if (volumeFlags.buyVolumeSurge) {
        bias = 'long';
        confidence = 0.35;
      }
    } else {
      // For short, want price at or near level (resistance)
      if (currentPrice <= level && currentPrice >= level * 0.999) {
        bias = 'short';
        confidence = 0.4; // Slightly higher if price is at level
      } else if (volumeFlags.sellVolumeSurge) {
        bias = 'short';
        confidence = 0.35;
      }
    }
    
    return {
      bias,
      confidence,
      flags: {
        absorbingBids: false,
        absorbingAsks: false,
        buyVolumeSurge: volumeFlags.buyVolumeSurge,
        sellVolumeSurge: volumeFlags.sellVolumeSurge,
      },
    };
  }
}

