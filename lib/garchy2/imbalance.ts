/**
 * Imbalance / Inefficiency Detection Module
 * 
 * Detects volume/participation gaps and Fair Value Gap (FVG) style inefficiencies in price structure.
 * These levels act as secondary intraday reaction zones within GARCH zones.
 */

import type { Candle } from '../types';

export type ImbalanceDirection = 'bullish' | 'bearish';

export interface Imbalance {
  /** Upper boundary of imbalance */
  upper: number;
  /** Lower boundary of imbalance */
  lower: number;
  /** Midpoint price */
  midpoint: number;
  /** Direction (bullish = gap up, bearish = gap down) */
  direction: ImbalanceDirection;
  /** Strength/confidence (0-1) */
  strength: number;
  /** Timestamp when imbalance was created */
  createdAt: number;
  /** Zone membership (which GARCH quadrant) */
  zoneQuadrant?: string;
}

export interface ImbalanceConfig {
  /** Minimum gap size as percentage of price (default: 0.001 = 0.1%) */
  minGapSizePct: number;
  /** Maximum gap size as percentage of price (default: 0.01 = 1%) */
  maxGapSizePct: number;
  /** Minimum candle count for imbalance detection (default: 3) */
  minCandleCount: number;
  /** Whether to detect Fair Value Gaps (FVG) (default: true) */
  detectFVG: boolean;
  /** Whether to detect volume voids (default: true) */
  detectVolumeVoids: boolean;
}

const DEFAULT_CONFIG: ImbalanceConfig = {
  minGapSizePct: 0.001, // 0.1%
  maxGapSizePct: 0.01, // 1%
  minCandleCount: 3,
  detectFVG: true,
  detectVolumeVoids: true,
};

/**
 * Imbalance Detector
 */
export class ImbalanceDetector {
  private config: ImbalanceConfig;
  private imbalances: Imbalance[] = [];

  constructor(config: Partial<ImbalanceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Detect imbalances from candle data
   */
  detectImbalances(candles: Candle[], garchZoneQuadrant?: (price: number) => string): Imbalance[] {
    this.imbalances = [];

    if (candles.length < this.config.minCandleCount + 1) {
      return [];
    }

    if (this.config.detectFVG) {
      const fvgImbalances = this.detectFairValueGaps(candles, garchZoneQuadrant);
      this.imbalances.push(...fvgImbalances);
    }

    if (this.config.detectVolumeVoids) {
      const volumeImbalances = this.detectVolumeVoids(candles, garchZoneQuadrant);
      this.imbalances.push(...volumeImbalances);
    }

    // Remove duplicates and merge overlapping imbalances
    this.mergeOverlappingImbalances();

    return this.imbalances;
  }

  /**
   * Detect Fair Value Gaps (FVG) - 3-candle pattern with gap
   */
  private detectFairValueGaps(
    candles: Candle[],
    garchZoneQuadrant?: (price: number) => string
  ): Imbalance[] {
    const imbalances: Imbalance[] = [];

    for (let i = 2; i < candles.length; i++) {
      const candle1 = candles[i - 2];
      const candle2 = candles[i - 1];
      const candle3 = candles[i];

      // Bullish FVG: candle 1 high < candle 3 low (gap between 1 and 3)
      if (candle1.high < candle3.low) {
        const gapSize = ((candle3.low - candle1.high) / candle1.high) * 100;
        const gapSizePct = gapSize / 100;

        if (
          gapSizePct >= this.config.minGapSizePct &&
          gapSizePct <= this.config.maxGapSizePct
        ) {
          const imbalance: Imbalance = {
            upper: candle3.low,
            lower: candle1.high,
            midpoint: (candle1.high + candle3.low) / 2,
            direction: 'bullish',
            strength: Math.min(1, gapSizePct / this.config.maxGapSizePct),
            createdAt: candle3.ts,
            zoneQuadrant: garchZoneQuadrant ? garchZoneQuadrant((candle1.high + candle3.low) / 2) : undefined,
          };

          imbalances.push(imbalance);
        }
      }

      // Bearish FVG: candle 1 low > candle 3 high (gap between 1 and 3)
      if (candle1.low > candle3.high) {
        const gapSize = ((candle1.low - candle3.high) / candle1.low) * 100;
        const gapSizePct = gapSize / 100;

        if (
          gapSizePct >= this.config.minGapSizePct &&
          gapSizePct <= this.config.maxGapSizePct
        ) {
          const imbalance: Imbalance = {
            upper: candle1.low,
            lower: candle3.high,
            midpoint: (candle1.low + candle3.high) / 2,
            direction: 'bearish',
            strength: Math.min(1, gapSizePct / this.config.maxGapSizePct),
            createdAt: candle3.ts,
            zoneQuadrant: garchZoneQuadrant ? garchZoneQuadrant((candle1.low + candle3.high) / 2) : undefined,
          };

          imbalances.push(imbalance);
        }
      }
    }

    return imbalances;
  }

  /**
   * Detect volume voids - areas with significantly lower volume
   */
  private detectVolumeVoids(
    candles: Candle[],
    garchZoneQuadrant?: (price: number) => string
  ): Imbalance[] {
    const imbalances: Imbalance[] = [];

    if (candles.length < this.config.minCandleCount * 2) {
      return [];
    }

    // Calculate average volume
    const volumes = candles.map(c => c.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const volumeThreshold = avgVolume * 0.5; // 50% of average volume

    // Find consecutive low-volume candles
    for (let i = this.config.minCandleCount - 1; i < candles.length; i++) {
      const window = candles.slice(i - (this.config.minCandleCount - 1), i + 1);
      const windowAvgVolume = window.reduce((sum, c) => sum + c.volume, 0) / window.length;

      if (windowAvgVolume < volumeThreshold) {
        // Found a volume void
        const windowHigh = Math.max(...window.map(c => c.high));
        const windowLow = Math.min(...window.map(c => c.low));

        const gapSize = ((windowHigh - windowLow) / windowLow) * 100;
        const gapSizePct = gapSize / 100;

        if (gapSizePct >= this.config.minGapSizePct) {
          // Determine direction based on price action
          const firstClose = window[0].close;
          const lastClose = window[window.length - 1].close;
          const direction: ImbalanceDirection = lastClose > firstClose ? 'bullish' : 'bearish';

          const imbalance: Imbalance = {
            upper: windowHigh,
            lower: windowLow,
            midpoint: (windowHigh + windowLow) / 2,
            direction,
            strength: Math.min(1, (volumeThreshold - windowAvgVolume) / volumeThreshold),
            createdAt: window[window.length - 1].ts,
            zoneQuadrant: garchZoneQuadrant ? garchZoneQuadrant((windowHigh + windowLow) / 2) : undefined,
          };

          imbalances.push(imbalance);
        }
      }
    }

    return imbalances;
  }

  /**
   * Merge overlapping imbalances
   */
  private mergeOverlappingImbalances(): void {
    if (this.imbalances.length <= 1) return;

    // Sort by midpoint
    this.imbalances.sort((a, b) => a.midpoint - b.midpoint);

    const merged: Imbalance[] = [];
    let current = this.imbalances[0];

    for (let i = 1; i < this.imbalances.length; i++) {
      const next = this.imbalances[i];

      // Check if overlapping (within 50% of each other's range)
      const overlap = this.areOverlapping(current, next);

      if (overlap && current.direction === next.direction) {
        // Merge
        current = {
          upper: Math.max(current.upper, next.upper),
          lower: Math.min(current.lower, next.lower),
          midpoint: (Math.max(current.upper, next.upper) + Math.min(current.lower, next.lower)) / 2,
          direction: current.direction,
          strength: Math.max(current.strength, next.strength),
          createdAt: Math.min(current.createdAt, next.createdAt),
          zoneQuadrant: current.zoneQuadrant || next.zoneQuadrant,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    this.imbalances = merged;
  }

  /**
   * Check if two imbalances overlap
   */
  private areOverlapping(a: Imbalance, b: Imbalance): boolean {
    const aRange = a.upper - a.lower;
    const bRange = b.upper - b.lower;
    const distance = Math.abs(a.midpoint - b.midpoint);
    const maxRange = Math.max(aRange, bRange);

    // Overlap if distance is less than 50% of the larger range
    return distance < maxRange * 0.5;
  }

  /**
   * Get imbalances near a price level
   */
  getImbalancesNearLevel(level: number, proximityPct: number = 0.002): Imbalance[] {
    const proximity = level * proximityPct;
    return this.imbalances.filter(
      (imb) =>
        (imb.lower <= level + proximity && imb.lower >= level - proximity) ||
        (imb.upper <= level + proximity && imb.upper >= level - proximity) ||
        (imb.midpoint <= level + proximity && imb.midpoint >= level - proximity) ||
        (level >= imb.lower && level <= imb.upper)
    );
  }

  /**
   * Get all active imbalances
   */
  getActiveImbalances(): Imbalance[] {
    return [...this.imbalances];
  }

  /**
   * Check if price is at an imbalance level
   */
  isAtImbalance(price: number, tolerancePct: number = 0.0005): Imbalance | null {
    const tolerance = price * tolerancePct;

    for (const imbalance of this.imbalances) {
      if (
        Math.abs(price - imbalance.lower) <= tolerance ||
        Math.abs(price - imbalance.upper) <= tolerance ||
        Math.abs(price - imbalance.midpoint) <= tolerance ||
        (price >= imbalance.lower && price <= imbalance.upper)
      ) {
        return imbalance;
      }
    }

    return null;
  }

  /**
   * Clear old imbalances (older than specified milliseconds)
   */
  clearOldImbalances(maxAgeMs: number): void {
    const now = Date.now();
    this.imbalances = this.imbalances.filter((imb) => now - imb.createdAt <= maxAgeMs);
  }
}

