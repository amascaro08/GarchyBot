/**
 * Limit Order Positioning Analysis
 * 
 * Analyzes the distribution and strength of limit orders at different price levels.
 * This provides insight into where smart money is positioning for support/resistance.
 * 
 * Key concepts:
 * - Bid clusters (buy walls) → support levels
 * - Ask clusters (sell walls) → resistance levels
 * - Order book imbalance → directional bias
 * - Absorption zones → areas where orders are being filled without price movement
 */

import type { DepthSnapshot, DepthEntry } from '../orderbook';

// Re-export types for convenience
export type { DepthSnapshot, DepthEntry } from '../orderbook';

export interface LimitOrderCluster {
  /** Price level of cluster */
  price: number;
  /** Side of the order book */
  side: 'bid' | 'ask';
  /** Total size (in base asset) */
  size: number;
  /** Total notional value (in quote currency, e.g., USDT) */
  notional: number;
  /** Number of orders in cluster */
  orderCount: number;
  /** Strength score (0-1) */
  strength: number;
  /** Distance from current price (percentage) */
  distanceFromPrice: number;
}

export interface OrderBookImbalance {
  /** Imbalance ratio (bid/ask) */
  ratio: number;
  /** Bias direction */
  bias: 'bid' | 'ask' | 'neutral';
  /** Strength of imbalance (0-1) */
  strength: number;
  /** Total bid notional */
  bidNotional: number;
  /** Total ask notional */
  askNotional: number;
}

export interface LimitOrderAnalysis {
  /** Top bid clusters (support zones) */
  bidClusters: LimitOrderCluster[];
  /** Top ask clusters (resistance zones) */
  askClusters: LimitOrderCluster[];
  /** Order book imbalance */
  imbalance: OrderBookImbalance;
  /** Strongest support level */
  strongestSupport: number | null;
  /** Strongest resistance level */
  strongestResistance: number | null;
  /** Absorption detected (large orders without price movement) */
  absorption: {
    detected: boolean;
    side: 'bid' | 'ask' | null;
    level: number | null;
  };
}

export interface LimitOrderConfig {
  /** Cluster detection threshold (minimum notional, default: $20k) */
  minClusterNotional: number;
  /** Price grouping tolerance (percentage, default: 0.001 = 0.1%) */
  priceGroupingPct: number;
  /** Maximum depth to analyze (number of levels, default: 50) */
  maxDepth: number;
  /** Imbalance threshold for bias detection (default: 1.5x) */
  imbalanceThreshold: number;
}

const DEFAULT_CONFIG: LimitOrderConfig = {
  minClusterNotional: 20000,
  priceGroupingPct: 0.001,
  maxDepth: 50,
  imbalanceThreshold: 1.5,
};

/**
 * Limit Order Analyzer
 */
export class LimitOrderAnalyzer {
  private config: LimitOrderConfig;
  private previousSnapshot: DepthSnapshot | null = null;

  constructor(config: Partial<LimitOrderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze limit orders in order book snapshot
   */
  analyzeLimitOrders(
    snapshot: DepthSnapshot,
    currentPrice: number
  ): LimitOrderAnalysis {
    // Group orders into clusters
    const bidClusters = this.detectClusters(snapshot.bids, 'bid', currentPrice);
    const askClusters = this.detectClusters(snapshot.asks, 'ask', currentPrice);

    // Sort clusters by strength
    bidClusters.sort((a, b) => b.strength - a.strength);
    askClusters.sort((a, b) => b.strength - a.strength);

    // Calculate order book imbalance
    const imbalance = this.calculateImbalance(snapshot);

    // Find strongest levels
    const strongestSupport = bidClusters.length > 0 ? bidClusters[0].price : null;
    const strongestResistance = askClusters.length > 0 ? askClusters[0].price : null;

    // Detect absorption
    const absorption = this.detectAbsorption(snapshot, currentPrice);

    // Store snapshot for next analysis
    this.previousSnapshot = snapshot;

    return {
      bidClusters: bidClusters.slice(0, 10), // Top 10 bid clusters
      askClusters: askClusters.slice(0, 10), // Top 10 ask clusters
      imbalance,
      strongestSupport,
      strongestResistance,
      absorption,
    };
  }

  /**
   * Detect clusters of limit orders at similar price levels
   */
  private detectClusters(
    orders: DepthEntry[],
    side: 'bid' | 'ask',
    currentPrice: number
  ): LimitOrderCluster[] {
    if (orders.length === 0) {
      return [];
    }

    const clusters: LimitOrderCluster[] = [];
    const groupingTolerance = currentPrice * this.config.priceGroupingPct;

    // Group orders by price proximity
    let currentCluster: {
      prices: number[];
      sizes: number[];
      notionals: number[];
    } = {
      prices: [],
      sizes: [],
      notionals: [],
    };

    // Sort orders by price (ascending for bids, descending for asks)
    const sortedOrders = [...orders].sort((a, b) => 
      side === 'bid' ? b.price - a.price : a.price - b.price
    );

    // Take top N levels
    const relevantOrders = sortedOrders.slice(0, this.config.maxDepth);

    for (let i = 0; i < relevantOrders.length; i++) {
      const order = relevantOrders[i];
      const notional = order.price * order.size;

      if (currentCluster.prices.length === 0) {
        // Start new cluster
        currentCluster.prices.push(order.price);
        currentCluster.sizes.push(order.size);
        currentCluster.notionals.push(notional);
      } else {
        // Check if order is within grouping tolerance of current cluster
        const clusterAvgPrice = 
          currentCluster.prices.reduce((sum, p) => sum + p, 0) / currentCluster.prices.length;
        
        if (Math.abs(order.price - clusterAvgPrice) <= groupingTolerance) {
          // Add to current cluster
          currentCluster.prices.push(order.price);
          currentCluster.sizes.push(order.size);
          currentCluster.notionals.push(notional);
        } else {
          // Finalize current cluster and start new one
          const clusterInfo = this.finalizeCluster(currentCluster, side, currentPrice);
          if (clusterInfo && clusterInfo.notional >= this.config.minClusterNotional) {
            clusters.push(clusterInfo);
          }

          // Start new cluster
          currentCluster = {
            prices: [order.price],
            sizes: [order.size],
            notionals: [notional],
          };
        }
      }
    }

    // Finalize last cluster
    if (currentCluster.prices.length > 0) {
      const clusterInfo = this.finalizeCluster(currentCluster, side, currentPrice);
      if (clusterInfo && clusterInfo.notional >= this.config.minClusterNotional) {
        clusters.push(clusterInfo);
      }
    }

    return clusters;
  }

  /**
   * Finalize cluster by calculating average price and total size
   */
  private finalizeCluster(
    cluster: { prices: number[]; sizes: number[]; notionals: number[] },
    side: 'bid' | 'ask',
    currentPrice: number
  ): LimitOrderCluster | null {
    if (cluster.prices.length === 0) {
      return null;
    }

    // Calculate weighted average price
    const totalNotional = cluster.notionals.reduce((sum, n) => sum + n, 0);
    const avgPrice = cluster.prices.reduce((sum, p, i) => 
      sum + (p * cluster.notionals[i] / totalNotional), 0
    );

    const totalSize = cluster.sizes.reduce((sum, s) => sum + s, 0);
    const orderCount = cluster.prices.length;

    // Calculate strength score (0-1)
    // Based on: notional size, order count, and proximity to price
    const distanceFromPrice = Math.abs(avgPrice - currentPrice) / currentPrice;
    const proximityScore = Math.max(0, 1 - (distanceFromPrice / 0.05)); // Max score at 0%, min at 5%
    const sizeScore = Math.min(1, totalNotional / 100000); // Max score at $100k+
    const densityScore = Math.min(1, orderCount / 10); // Max score at 10+ orders
    
    const strength = (proximityScore * 0.4 + sizeScore * 0.4 + densityScore * 0.2);

    return {
      price: avgPrice,
      side,
      size: totalSize,
      notional: totalNotional,
      orderCount,
      strength,
      distanceFromPrice: distanceFromPrice * 100, // As percentage
    };
  }

  /**
   * Calculate order book imbalance
   */
  private calculateImbalance(snapshot: DepthSnapshot): OrderBookImbalance {
    // Calculate total notional on each side (top 20 levels)
    const topBids = snapshot.bids.slice(0, 20);
    const topAsks = snapshot.asks.slice(0, 20);

    const bidNotional = topBids.reduce((sum, b) => sum + (b.price * b.size), 0);
    const askNotional = topAsks.reduce((sum, a) => sum + (a.price * a.size), 0);

    // Calculate ratio
    const ratio = askNotional > 0 ? bidNotional / askNotional : bidNotional > 0 ? 999 : 1;

    // Determine bias
    let bias: 'bid' | 'ask' | 'neutral' = 'neutral';
    if (ratio > this.config.imbalanceThreshold) {
      bias = 'bid'; // More bids than asks → bullish
    } else if (ratio < (1 / this.config.imbalanceThreshold)) {
      bias = 'ask'; // More asks than bids → bearish
    }

    // Calculate strength of imbalance
    const imbalanceMagnitude = Math.abs(Math.log(ratio)); // Log scale
    const strength = Math.min(1, imbalanceMagnitude / 2); // Normalize to 0-1

    return {
      ratio,
      bias,
      strength,
      bidNotional,
      askNotional,
    };
  }

  /**
   * Detect absorption (large orders being filled without significant price movement)
   */
  private detectAbsorption(
    snapshot: DepthSnapshot,
    currentPrice: number
  ): { detected: boolean; side: 'bid' | 'ask' | null; level: number | null } {
    if (!this.previousSnapshot) {
      return { detected: false, side: null, level: null };
    }

    // Compare current snapshot with previous to detect order changes
    // Absorption: large orders disappear (filled) but price doesn't move much

    const priceChangePct = Math.abs(currentPrice - (this.previousSnapshot.bids[0]?.price || currentPrice)) / currentPrice;
    
    // If price moved significantly, not absorption
    if (priceChangePct > 0.001) { // 0.1% threshold
      return { detected: false, side: null, level: null };
    }

    // Check for large bid orders that disappeared (absorption on buy side)
    const bidAbsorption = this.checkSideAbsorption(
      this.previousSnapshot.bids,
      snapshot.bids,
      'bid',
      currentPrice
    );

    if (bidAbsorption.detected) {
      return bidAbsorption;
    }

    // Check for large ask orders that disappeared (absorption on sell side)
    const askAbsorption = this.checkSideAbsorption(
      this.previousSnapshot.asks,
      snapshot.asks,
      'ask',
      currentPrice
    );

    return askAbsorption;
  }

  /**
   * Check one side of order book for absorption
   */
  private checkSideAbsorption(
    previousOrders: DepthEntry[],
    currentOrders: DepthEntry[],
    side: 'bid' | 'ask',
    currentPrice: number
  ): { detected: boolean; side: 'bid' | 'ask' | null; level: number | null } {
    const proximity = currentPrice * 0.002; // 0.2% proximity

    // Find orders that were near price and disappeared
    for (const prevOrder of previousOrders) {
      if (Math.abs(prevOrder.price - currentPrice) > proximity) {
        continue;
      }

      const notional = prevOrder.price * prevOrder.size;
      if (notional < this.config.minClusterNotional) {
        continue;
      }

      // Check if this order still exists
      const stillExists = currentOrders.some(o => 
        Math.abs(o.price - prevOrder.price) < (currentPrice * 0.0001) &&
        o.size >= prevOrder.size * 0.5 // At least 50% of size remains
      );

      if (!stillExists) {
        // Large order disappeared without price movement → absorption
        return { detected: true, side, level: prevOrder.price };
      }
    }

    return { detected: false, side: null, level: null };
  }

  /**
   * Find nearest significant support level below price
   */
  findNearestSupport(analysis: LimitOrderAnalysis, currentPrice: number): number | null {
    const supportLevels = analysis.bidClusters
      .filter(c => c.price < currentPrice)
      .sort((a, b) => b.price - a.price); // Closest first

    return supportLevels.length > 0 ? supportLevels[0].price : null;
  }

  /**
   * Find nearest significant resistance level above price
   */
  findNearestResistance(analysis: LimitOrderAnalysis, currentPrice: number): number | null {
    const resistanceLevels = analysis.askClusters
      .filter(c => c.price > currentPrice)
      .sort((a, b) => a.price - b.price); // Closest first

    return resistanceLevels.length > 0 ? resistanceLevels[0].price : null;
  }

  /**
   * Check if trade is confirmed by limit order positioning
   */
  confirmsTrade(
    analysis: LimitOrderAnalysis,
    tradeSide: 'LONG' | 'SHORT',
    entryPrice: number
  ): boolean {
    // For LONG: want strong bid support below entry
    if (tradeSide === 'LONG') {
      const supportBelow = analysis.bidClusters.filter(c => c.price < entryPrice);
      const hasStrongSupport = supportBelow.some(c => c.strength > 0.6);
      
      // Also check order book imbalance favors longs
      const favorableBias = analysis.imbalance.bias === 'bid' || analysis.imbalance.bias === 'neutral';
      
      return hasStrongSupport || (favorableBias && analysis.imbalance.strength > 0.5);
    }

    // For SHORT: want strong ask resistance above entry
    if (tradeSide === 'SHORT') {
      const resistanceAbove = analysis.askClusters.filter(c => c.price > entryPrice);
      const hasStrongResistance = resistanceAbove.some(c => c.strength > 0.6);
      
      // Also check order book imbalance favors shorts
      const favorableBias = analysis.imbalance.bias === 'ask' || analysis.imbalance.bias === 'neutral';
      
      return hasStrongResistance || (favorableBias && analysis.imbalance.strength > 0.5);
    }

    return false;
  }
}
