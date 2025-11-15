/**
 * GARCH Zone Engine
 * 
 * Computes and manages GARCH-based volatility zones around the daily open.
 * Divides the expected daily range into 4 quadrants (2 above, 2 below open).
 */

export interface GARCHZoneLevels {
  /** Daily open price */
  dailyOpen: number;
  /** Upper range boundary */
  upperRange: number;
  /** Lower range boundary */
  lowerRange: number;
  /** Zone boundaries above daily open */
  zones: {
    /** Q1: First quadrant above open */
    q1: number;
    /** Q2: Second quadrant above open (upper range) */
    q2: number;
  };
  /** Zone boundaries below daily open */
  negativeZones: {
    /** Q-1: First quadrant below open */
    qMinus1: number;
    /** Q-2: Second quadrant below open (lower range) */
    qMinus2: number;
  };
  /** GARCH% used for calculation */
  garchPct: number;
}

export type ZoneQuadrant = 'Q2' | 'Q1' | 'Q0' | 'Q-1' | 'Q-2';

export interface ZoneInfo {
  /** Current quadrant */
  quadrant: ZoneQuadrant;
  /** Nearest zone boundary */
  nearestBoundary: number;
  /** Distance to nearest boundary as percentage */
  distanceToBoundaryPct: number;
}

/**
 * GARCH Zone Engine class
 */
export class GARCHZoneEngine {
  private levels: GARCHZoneLevels | null = null;

  /**
   * Initialize zones from daily open and GARCH%
   */
  initialize(dailyOpen: number, garchPct: number): void {
    const upperRange = dailyOpen * (1 + garchPct);
    const lowerRange = dailyOpen * (1 - garchPct);

    // Divide range into 2 zones above and 2 below
    // Q1: midpoint between open and upper range
    const q1 = dailyOpen + (upperRange - dailyOpen) / 2;
    // Q2: upper range
    const q2 = upperRange;

    // Q-1: midpoint between lower range and open
    const qMinus1 = dailyOpen - (dailyOpen - lowerRange) / 2;
    // Q-2: lower range
    const qMinus2 = lowerRange;

    this.levels = {
      dailyOpen,
      upperRange,
      lowerRange,
      zones: { q1, q2 },
      negativeZones: { qMinus1, qMinus2 },
      garchPct,
    };
  }

  /**
   * Get all zone levels
   */
  getLevels(): GARCHZoneLevels | null {
    return this.levels;
  }

  /**
   * Get current zone for a given price
   */
  getCurrentZone(price: number): ZoneInfo {
    if (!this.levels) {
      throw new Error('GARCH zones not initialized');
    }

    const { dailyOpen, zones, negativeZones } = this.levels;

    let quadrant: ZoneQuadrant;
    let nearestBoundary: number;

    if (price >= zones.q2) {
      quadrant = 'Q2';
      nearestBoundary = zones.q2;
    } else if (price >= zones.q1) {
      quadrant = 'Q1';
      nearestBoundary = price >= (zones.q1 + zones.q2) / 2 ? zones.q2 : zones.q1;
    } else if (price >= dailyOpen) {
      quadrant = 'Q0';
      nearestBoundary = price >= (dailyOpen + zones.q1) / 2 ? zones.q1 : dailyOpen;
    } else if (price >= negativeZones.qMinus1) {
      quadrant = 'Q-1';
      nearestBoundary = price >= (negativeZones.qMinus1 + dailyOpen) / 2 ? dailyOpen : negativeZones.qMinus1;
    } else if (price >= negativeZones.qMinus2) {
      quadrant = 'Q-2';
      nearestBoundary = price >= (negativeZones.qMinus2 + negativeZones.qMinus1) / 2 ? negativeZones.qMinus1 : negativeZones.qMinus2;
    } else {
      quadrant = 'Q-2';
      nearestBoundary = negativeZones.qMinus2;
    }

    const distanceToBoundary = Math.abs(price - nearestBoundary);
    const distanceToBoundaryPct = (distanceToBoundary / dailyOpen) * 100;

    return {
      quadrant,
      nearestBoundary,
      distanceToBoundaryPct,
    };
  }

  /**
   * Get nearest zone boundary to a price
   */
  getNearestBoundary(price: number): number {
    if (!this.levels) {
      throw new Error('GARCH zones not initialized');
    }

    const { dailyOpen, zones, negativeZones } = this.levels;
    const boundaries = [
      negativeZones.qMinus2,
      negativeZones.qMinus1,
      dailyOpen,
      zones.q1,
      zones.q2,
    ];

    let nearest = boundaries[0];
    let minDistance = Math.abs(price - nearest);

    for (const boundary of boundaries) {
      const distance = Math.abs(price - boundary);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = boundary;
      }
    }

    return nearest;
  }

  /**
   * Check if price has touched a boundary (within tolerance)
   */
  hasTouchedBoundary(price: number, boundary: number, tolerancePct: number = 0.0005): boolean {
    const tolerance = boundary * tolerancePct;
    return Math.abs(price - boundary) <= tolerance;
  }

  /**
   * Check if price has broken and held above/below a boundary
   */
  hasBrokenAndHeld(
    price: number,
    boundary: number,
    direction: 'above' | 'below',
    holdThresholdPct: number = 0.001
  ): boolean {
    const holdThreshold = boundary * holdThresholdPct;

    if (direction === 'above') {
      return price >= boundary + holdThreshold;
    } else {
      return price <= boundary - holdThreshold;
    }
  }

  /**
   * Get all zone boundaries (sorted)
   */
  getAllBoundaries(): number[] {
    if (!this.levels) {
      throw new Error('GARCH zones not initialized');
    }

    const { dailyOpen, zones, negativeZones } = this.levels;
    return [
      negativeZones.qMinus2,
      negativeZones.qMinus1,
      dailyOpen,
      zones.q1,
      zones.q2,
    ].sort((a, b) => a - b);
  }

  /**
   * Get zone boundaries for a specific quadrant
   */
  getQuadrantBoundaries(quadrant: ZoneQuadrant): { lower: number; upper: number } | null {
    if (!this.levels) {
      return null;
    }

    const { dailyOpen, zones, negativeZones } = this.levels;

    switch (quadrant) {
      case 'Q2':
        return { lower: zones.q1, upper: zones.q2 };
      case 'Q1':
        return { lower: dailyOpen, upper: zones.q1 };
      case 'Q0':
        return { lower: negativeZones.qMinus1, upper: dailyOpen };
      case 'Q-1':
        return { lower: negativeZones.qMinus2, upper: negativeZones.qMinus1 };
      case 'Q-2':
        return { lower: negativeZones.qMinus2, upper: negativeZones.qMinus1 };
      default:
        return null;
    }
  }
}

