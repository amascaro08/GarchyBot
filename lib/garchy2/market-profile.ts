/**
 * Market Profile / Volume Profile Validation Module
 * 
 * Analyzes volume-by-price data to identify High Volume Nodes (HVNs) and Low Volume Nodes (LVNs).
 * Used to contextualize GARCH zones and boundaries for better trade decisions.
 */

import type { Candle } from '../types';

export interface VolumeProfileNode {
  /** Price level */
  price: number;
  /** Total volume at this price level */
  volume: number;
  /** Number of touches at this level */
  touches: number;
}

export type NodeType = 'HVN' | 'LVN' | 'neutral';

export interface ProfileContext {
  /** Type of node near the level */
  nodeType: NodeType;
  /** Distance to nearest node in price terms */
  distance: number;
  /** Distance as percentage of price */
  distancePct: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Nearest node price */
  nearestNodePrice: number | null;
}

export interface MarketProfileConfig {
  /** Price bucket size (default: 0.1% of price) */
  bucketSizePct: number;
  /** Proximity threshold for "near" a node (default: 0.2% of price) */
  proximityThresholdPct: number;
  /** Minimum volume percentile to be considered HVN (default: 75th percentile) */
  hvnPercentile: number;
  /** Maximum volume percentile to be considered LVN (default: 25th percentile) */
  lvnPercentile: number;
}

const DEFAULT_CONFIG: MarketProfileConfig = {
  bucketSizePct: 0.001, // 0.1%
  proximityThresholdPct: 0.002, // 0.2%
  hvnPercentile: 75,
  lvnPercentile: 25,
};

/**
 * Market Profile Analyzer
 */
export class MarketProfileAnalyzer {
  private config: MarketProfileConfig;
  private volumeProfile: Map<number, VolumeProfileNode> = new Map();
  private priceBuckets: number[] = [];
  private hvnLevels: number[] = [];
  private lvnLevels: number[] = [];

  constructor(config: Partial<MarketProfileConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Build volume profile from candles
   */
  buildProfile(candles: Candle[], priceRange?: { min: number; max: number }): void {
    this.volumeProfile.clear();
    this.priceBuckets = [];
    this.hvnLevels = [];
    this.lvnLevels = [];

    if (candles.length === 0) return;

    // Determine price range
    let minPrice = candles[0].low;
    let maxPrice = candles[0].high;

    if (priceRange) {
      minPrice = priceRange.min;
      maxPrice = priceRange.max;
    } else {
      for (const candle of candles) {
        minPrice = Math.min(minPrice, candle.low);
        maxPrice = Math.max(maxPrice, candle.high);
      }
    }

    // Create price buckets
    const bucketSize = ((maxPrice - minPrice) * this.config.bucketSizePct) || (minPrice * this.config.bucketSizePct);
    let currentPrice = minPrice;

    while (currentPrice <= maxPrice) {
      this.priceBuckets.push(currentPrice);
      this.volumeProfile.set(currentPrice, {
        price: currentPrice,
        volume: 0,
        touches: 0,
      });
      currentPrice += bucketSize;
    }

    // Distribute volume across buckets
    for (const candle of candles) {
      const { high, low, volume } = candle;
      const candleRange = high - low;

      if (candleRange === 0) {
        // Single price candle
        const bucket = this.findNearestBucket(high);
        if (bucket !== null) {
          const node = this.volumeProfile.get(bucket)!;
          node.volume += volume;
          node.touches += 1;
        }
      } else {
        // Distribute volume evenly across price range
        const volumePerTick = volume / candleRange;
        for (const bucket of this.priceBuckets) {
          if (bucket >= low && bucket <= high) {
            const node = this.volumeProfile.get(bucket)!;
            node.volume += volumePerTick * (Math.min(high, bucket + bucketSize / 2) - Math.max(low, bucket - bucketSize / 2));
            node.touches += 1;
          }
        }
      }
    }

    // Calculate HVN and LVN levels
    this.identifyNodes();
  }

  /**
   * Find nearest bucket to a price
   */
  private findNearestBucket(price: number): number | null {
    if (this.priceBuckets.length === 0) return null;

    let nearest = this.priceBuckets[0];
    let minDistance = Math.abs(price - nearest);

    for (const bucket of this.priceBuckets) {
      const distance = Math.abs(price - bucket);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = bucket;
      }
    }

    return nearest;
  }

  /**
   * Identify HVN and LVN levels based on volume percentiles
   */
  private identifyNodes(): void {
    const volumes: number[] = [];
    for (const node of this.volumeProfile.values()) {
      if (node.volume > 0) {
        volumes.push(node.volume);
      }
    }

    if (volumes.length === 0) return;

    volumes.sort((a, b) => a - b);

    const hvnThreshold = this.getPercentile(volumes, this.config.hvnPercentile);
    const lvnThreshold = this.getPercentile(volumes, this.config.lvnPercentile);

    for (const [price, node] of this.volumeProfile.entries()) {
      if (node.volume >= hvnThreshold) {
        this.hvnLevels.push(price);
      } else if (node.volume <= lvnThreshold) {
        this.lvnLevels.push(price);
      }
    }
  }

  /**
   * Calculate percentile value
   */
  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * Get profile context for a given price level
   */
  getProfileContext(level: number): ProfileContext {
    const proximity = level * this.config.proximityThresholdPct;

    // Find nearest HVN
    let nearestHVN: number | null = null;
    let nearestHVNDistance = Infinity;

    for (const hvn of this.hvnLevels) {
      const distance = Math.abs(level - hvn);
      if (distance < proximity && distance < nearestHVNDistance) {
        nearestHVNDistance = distance;
        nearestHVN = hvn;
      }
    }

    // Find nearest LVN
    let nearestLVN: number | null = null;
    let nearestLVNDistance = Infinity;

    for (const lvn of this.lvnLevels) {
      const distance = Math.abs(level - lvn);
      if (distance < proximity && distance < nearestLVNDistance) {
        nearestLVNDistance = distance;
        nearestLVN = lvn;
      }
    }

    // Determine node type and confidence
    if (nearestHVN !== null && (nearestLVN === null || nearestHVNDistance < nearestLVNDistance)) {
      const distancePct = (nearestHVNDistance / level) * 100;
      const confidence = Math.max(0, 1 - distancePct / (this.config.proximityThresholdPct * 100));
      
      return {
        nodeType: 'HVN',
        distance: nearestHVNDistance,
        distancePct,
        confidence,
        nearestNodePrice: nearestHVN,
      };
    } else if (nearestLVN !== null) {
      const distancePct = (nearestLVNDistance / level) * 100;
      const confidence = Math.max(0, 1 - distancePct / (this.config.proximityThresholdPct * 100));
      
      return {
        nodeType: 'LVN',
        distance: nearestLVNDistance,
        distancePct,
        confidence,
        nearestNodePrice: nearestLVN,
      };
    }

    // No clear node nearby
    return {
      nodeType: 'neutral',
      distance: Math.min(nearestHVNDistance, nearestLVNDistance),
      distancePct: (Math.min(nearestHVNDistance, nearestLVNDistance) / level) * 100,
      confidence: 0,
      nearestNodePrice: null,
    };
  }

  /**
   * Get all HVN levels
   */
  getHVNLevels(): number[] {
    return [...this.hvnLevels].sort((a, b) => a - b);
  }

  /**
   * Get all LVN levels
   */
  getLVNLevels(): number[] {
    return [...this.lvnLevels].sort((a, b) => a - b);
  }

  /**
   * Get volume profile data for visualization/debugging
   */
  getProfileData(): VolumeProfileNode[] {
    return Array.from(this.volumeProfile.values()).sort((a, b) => a.price - b.price);
  }
}

