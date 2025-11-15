/**
 * Garchy 2.0 Strategy Engine
 * 
 * Main orchestration engine that integrates:
 * - ORB (Opening Range Breakout) - Rule 0
 * - GARCH Zone Engine
 * - Market Profile / Volume Profile validation
 * - Orderflow / DOM confirmation
 * - Imbalance detection
 * 
 * Emits structured trade signals with metadata for the risk/execution layer.
 */

import type { Candle } from '../types';
import { ORBModule, type ORBConfig, type ORBSignal } from './orb';
import { GARCHZoneEngine, type ZoneInfo, type ZoneQuadrant } from './garch-zones';
import { MarketProfileAnalyzer, type ProfileContext } from './market-profile';
import { OrderflowAnalyzer, type OrderflowSignal } from './orderflow';
import { ImbalanceDetector, type Imbalance } from './imbalance';

export type SetupType =
  | 'ORB'
  | 'GARCH_BREAKOUT'
  | 'GARCH_REJECTION'
  | 'IMBALANCE_RETEST'
  | 'IMBALANCE_CONTINUATION';

export type SessionBias = 'long' | 'short' | 'neutral';

export interface TradeSignal {
  /** Setup type */
  setupType: SetupType;
  /** Trade direction */
  side: 'LONG' | 'SHORT';
  /** Entry price/level */
  entry: number;
  /** Take profit level */
  tp: number;
  /** Stop loss level */
  sl: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Context metadata */
  context: {
    /** Session bias (from ORB or neutral) */
    sessionBias: SessionBias;
    /** MP/VP context at entry level */
    profileContext: ProfileContext;
    /** Orderflow confirmation */
    orderflow: OrderflowSignal;
    /** GARCH zone info */
    zoneInfo: ZoneInfo;
    /** Nearest imbalance (if any) */
    imbalance: Imbalance | null;
    /** Setup-specific reason */
    reason: string;
  };
}

export interface Garchy2Config {
  /** ORB configuration */
  orb?: Partial<ORBConfig>;
  /** Market Profile configuration */
  marketProfile?: {
    bucketSizePct?: number;
    proximityThresholdPct?: number;
    hvnPercentile?: number;
    lvnPercentile?: number;
  };
  /** Orderflow configuration */
  orderflow?: {
    minWallNotional?: number;
    wallProximityBps?: number;
    volumeSurgeMultiplier?: number;
    minConfidence?: number;
  };
  /** Imbalance configuration */
  imbalance?: {
    minGapSizePct?: number;
    maxGapSizePct?: number;
    detectFVG?: boolean;
    detectVolumeVoids?: boolean;
  };
  /** GARCH zone tolerance for boundary touches */
  zoneBoundaryTolerancePct?: number;
  /** Minimum confidence threshold for signals (default: 0.4) */
  minSignalConfidence?: number;
  /** Session start time (UTC 00:00) */
  sessionStart?: number;
}

const DEFAULT_CONFIG: Required<Pick<Garchy2Config, 'zoneBoundaryTolerancePct' | 'minSignalConfidence'>> = {
  zoneBoundaryTolerancePct: 0.0005, // 0.05%
  minSignalConfidence: 0.4,
};

/**
 * Garchy 2.0 Strategy Engine
 */
export class Garchy2StrategyEngine {
  private config: Garchy2Config & typeof DEFAULT_CONFIG;
  private orb: ORBModule;
  private garchZones: GARCHZoneEngine;
  private marketProfile: MarketProfileAnalyzer;
  private orderflow: OrderflowAnalyzer;
  private imbalanceDetector: ImbalanceDetector;
  private sessionBias: SessionBias = 'neutral';
  private lastSignal: TradeSignal | null = null;

  constructor(config: Garchy2Config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.orb = new ORBModule(config.orb);
    this.garchZones = new GARCHZoneEngine();
    this.marketProfile = new MarketProfileAnalyzer(config.marketProfile);
    this.orderflow = new OrderflowAnalyzer(config.orderflow);
    this.imbalanceDetector = new ImbalanceDetector(config.imbalance);
  }

  /**
   * Initialize strategy for a new session
   */
  initialize(params: {
    dailyOpen: number;
    garchPct: number;
    sessionStart: number;
    candles: Candle[];
  }): void {
    const { dailyOpen, garchPct, sessionStart, candles } = params;

    // Initialize GARCH zones
    this.garchZones.initialize(dailyOpen, garchPct);

    // Initialize ORB
    this.orb.initialize(sessionStart, candles);

    // Build Market Profile
    const zoneLevels = this.garchZones.getLevels();
    if (zoneLevels) {
      this.marketProfile.buildProfile(candles, {
        min: zoneLevels.lowerRange,
        max: zoneLevels.upperRange,
      });
    } else {
      this.marketProfile.buildProfile(candles);
    }

    // Detect imbalances
    const zoneQuadrantFn = (price: number) => this.garchZones.getCurrentZone(price).quadrant;
    this.imbalanceDetector.detectImbalances(candles, zoneQuadrantFn);

    // Update orderflow with candles
    this.orderflow.updateCandles(candles);

    // Reset session bias
    this.sessionBias = 'neutral';
  }

  /**
   * Evaluate strategy and generate signals
   */
  async evaluate(params: {
    currentPrice: number;
    timestamp: number;
    candles: Candle[];
    symbol: string;
  }): Promise<TradeSignal | null> {
    const { currentPrice, timestamp, candles, symbol } = params;

    // Update all modules with latest data
    this.orderflow.updateCandles(candles);

    // Update ORB
    const orbSignal = this.orb.update(currentPrice, timestamp, candles);
    if (orbSignal.sessionBias !== 'neutral') {
      this.sessionBias = orbSignal.sessionBias;
    }

    // Update imbalances (detect new ones)
    const zoneQuadrantFn = (price: number) => this.garchZones.getCurrentZone(price).quadrant;
    this.imbalanceDetector.detectImbalances(candles, zoneQuadrantFn);

    // Decision hierarchy: Check ORB first (Rule 0)
    if (orbSignal.confirmed && orbSignal.side) {
      const signal = await this.evaluateORBSignal(
        orbSignal,
        currentPrice,
        symbol
      );
      if (signal) {
        this.lastSignal = signal;
        return signal;
      }
    }

    // Post-ORB: Check GARCH zones and imbalances
    const garchSignal = await this.evaluateGARCHZones(
      currentPrice,
      candles,
      symbol
    );
    if (garchSignal) {
      this.lastSignal = garchSignal;
      return garchSignal;
    }

    const imbalanceSignal = await this.evaluateImbalances(
      currentPrice,
      candles,
      symbol
    );
    if (imbalanceSignal) {
      this.lastSignal = imbalanceSignal;
      return imbalanceSignal;
    }

    return null;
  }

  /**
   * Evaluate ORB signal (Rule 0)
   */
  private async evaluateORBSignal(
    orbSignal: ORBSignal,
    currentPrice: number,
    symbol: string
  ): Promise<TradeSignal | null> {
    if (!orbSignal.side || !orbSignal.level) {
      return null;
    }

    // Get MP/VP context
    const profileContext = this.marketProfile.getProfileContext(orbSignal.level);

    // Get orderflow confirmation
    const orderflow = await this.orderflow.analyzeOrderflow(
      symbol,
      orbSignal.level,
      currentPrice,
      orbSignal.side
    );

    // Check orderflow confirmation
    if (!this.orderflow.confirmsTrade(orderflow, orbSignal.side)) {
      return null; // Orderflow doesn't confirm
    }

    // Calculate TP/SL from GARCH zones
    const zoneLevels = this.garchZones.getLevels();
    if (!zoneLevels) {
      return null;
    }

    const { tp, sl } = this.calculateTPSL(
      orbSignal.level,
      orbSignal.side,
      zoneLevels
    );

    // Calculate confidence
    const confidence = this.calculateConfidence({
      orderflow,
      profileContext,
      sessionBias: orbSignal.sessionBias,
      setupType: 'ORB',
    });

    if (confidence < this.config.minSignalConfidence) {
      return null;
    }

    return {
      setupType: 'ORB',
      side: orbSignal.side,
      entry: orbSignal.level,
      tp,
      sl,
      confidence,
      context: {
        sessionBias: orbSignal.sessionBias,
        profileContext,
        orderflow,
        zoneInfo: this.garchZones.getCurrentZone(orbSignal.level),
        imbalance: this.imbalanceDetector.isAtImbalance(orbSignal.level),
        reason: `ORB breakout ${orbSignal.side} at ${orbSignal.level.toFixed(2)}`,
      },
    };
  }

  /**
   * Evaluate GARCH zone signals
   */
  private async evaluateGARCHZones(
    currentPrice: number,
    candles: Candle[],
    symbol: string
  ): Promise<TradeSignal | null> {
    const zoneLevels = this.garchZones.getLevels();
    if (!zoneLevels) {
      return null;
    }

    const zoneInfo = this.garchZones.getCurrentZone(currentPrice);
    const boundaries = this.garchZones.getAllBoundaries();

    // Check for boundary touches
    for (const boundary of boundaries) {
      const touched = this.garchZones.hasTouchedBoundary(
        currentPrice,
        boundary,
        this.config.zoneBoundaryTolerancePct
      );

      if (touched) {
        // Determine setup type and direction based on session bias and zone context
        const profileContext = this.marketProfile.getProfileContext(boundary);

        // Check if this is a rejection (HVN) or breakout (LVN)
        let setupType: SetupType;
        let side: 'LONG' | 'SHORT' | null = null;

        if (profileContext.nodeType === 'HVN') {
          // HVN = more likely rejection
          setupType = 'GARCH_REJECTION';
          // Determine direction based on session bias and price position
          if (this.sessionBias === 'long' && currentPrice >= boundary) {
            side = 'SHORT'; // Reject at resistance
          } else if (this.sessionBias === 'short' && currentPrice <= boundary) {
            side = 'LONG'; // Reject at support
          } else if (currentPrice > boundary) {
            side = 'SHORT'; // Price above HVN = resistance
          } else {
            side = 'LONG'; // Price below HVN = support
          }
        } else if (profileContext.nodeType === 'LVN') {
          // LVN = more likely breakout
          setupType = 'GARCH_BREAKOUT';
          // Breakout in direction of session bias
          if (this.sessionBias === 'long' && currentPrice > boundary) {
            side = 'LONG';
          } else if (this.sessionBias === 'short' && currentPrice < boundary) {
            side = 'SHORT';
          } else {
            // No clear bias, skip
            continue;
          }
        } else {
          // Neutral - lower confidence, skip for now
          continue;
        }

        if (!side) {
          continue;
        }

        // Get orderflow confirmation
        const orderflow = await this.orderflow.analyzeOrderflow(
          symbol,
          boundary,
          currentPrice,
          side
        );

        if (!this.orderflow.confirmsTrade(orderflow, side)) {
          continue;
        }

        const { tp, sl } = this.calculateTPSL(side, boundary, zoneLevels);

        const confidence = this.calculateConfidence({
          orderflow,
          profileContext,
          sessionBias: this.sessionBias,
          setupType,
        });

        if (confidence < this.config.minSignalConfidence) {
          continue;
        }

        return {
          setupType,
          side,
          entry: boundary,
          tp,
          sl,
          confidence,
          context: {
            sessionBias: this.sessionBias,
            profileContext,
            orderflow,
            zoneInfo,
            imbalance: this.imbalanceDetector.isAtImbalance(boundary),
            reason: `${setupType} ${side} at GARCH boundary ${boundary.toFixed(2)} (${zoneInfo.quadrant})`,
          },
        };
      }
    }

    return null;
  }

  /**
   * Evaluate imbalance signals
   */
  private async evaluateImbalances(
    currentPrice: number,
    candles: Candle[],
    symbol: string
  ): Promise<TradeSignal | null> {
    const imbalance = this.imbalanceDetector.isAtImbalance(
      currentPrice,
      this.config.zoneBoundaryTolerancePct
    );

    if (!imbalance) {
      return null;
    }

    // Determine if this is a retest or continuation
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles.length > 1 ? candles[candles.length - 2] : null;

    let setupType: SetupType;
    let side: 'LONG' | 'SHORT' | null = null;

    // Check if price is retesting the imbalance
    const isRetest = prevCandle && (
      (imbalance.direction === 'bullish' && prevCandle.close < imbalance.lower && currentPrice >= imbalance.lower) ||
      (imbalance.direction === 'bearish' && prevCandle.close > imbalance.upper && currentPrice <= imbalance.upper)
    );

    if (isRetest) {
      setupType = 'IMBALANCE_RETEST';
      // Retest: trade in direction of imbalance
      side = imbalance.direction === 'bullish' ? 'LONG' : 'SHORT';
    } else {
      setupType = 'IMBALANCE_CONTINUATION';
      // Continuation: trade in direction of session bias if it matches imbalance direction
      if (
        (this.sessionBias === 'long' && imbalance.direction === 'bullish') ||
        (this.sessionBias === 'short' && imbalance.direction === 'bearish')
      ) {
        side = imbalance.direction === 'bullish' ? 'LONG' : 'SHORT';
      }
    }

    if (!side) {
      return null;
    }

    const profileContext = this.marketProfile.getProfileContext(imbalance.midpoint);
    const orderflow = await this.orderflow.analyzeOrderflow(
      symbol,
      imbalance.midpoint,
      currentPrice,
      side
    );

    if (!this.orderflow.confirmsTrade(orderflow, side)) {
      return null;
    }

    // Calculate TP/SL from GARCH zones or imbalance boundaries
    const zoneLevels = this.garchZones.getLevels();
    const { tp, sl } = zoneLevels
      ? this.calculateTPSL(imbalance.midpoint, side, zoneLevels)
      : this.calculateTPSLFromImbalance(imbalance, side);

    const confidence = this.calculateConfidence({
      orderflow,
      profileContext,
      sessionBias: this.sessionBias,
      setupType,
    });

    if (confidence < this.config.minSignalConfidence) {
      return null;
    }

    return {
      setupType,
      side,
      entry: imbalance.midpoint,
      tp,
      sl,
      confidence,
      context: {
        sessionBias: this.sessionBias,
        profileContext,
        orderflow,
        zoneInfo: this.garchZones.getCurrentZone(imbalance.midpoint),
        imbalance,
        reason: `${setupType} ${side} at imbalance ${imbalance.midpoint.toFixed(2)} (${imbalance.direction})`,
      },
    };
  }

  /**
   * Calculate TP/SL from GARCH zones
   */
  private calculateTPSL(
    entry: number,
    side: 'LONG' | 'SHORT',
    zoneLevels: ReturnType<typeof this.garchZones.getLevels>
  ): { tp: number; sl: number } {
    const boundaries = this.garchZones!.getAllBoundaries();
    const tolerance = entry * 0.001;

    if (side === 'LONG') {
      // Find next boundary above entry for TP
      const nextBoundary = boundaries.find((b) => b > entry + tolerance);
      // Find previous boundary below entry for SL
      const prevBoundary = [...boundaries].reverse().find((b) => b < entry - tolerance);

      return {
        tp: nextBoundary || boundaries[boundaries.length - 1] || entry * 1.01,
        sl: prevBoundary || boundaries[0] || entry * 0.99,
      };
    } else {
      // Find next boundary below entry for TP
      const prevBoundary = [...boundaries].reverse().find((b) => b < entry - tolerance);
      // Find previous boundary above entry for SL
      const nextBoundary = boundaries.find((b) => b > entry + tolerance);

      return {
        tp: prevBoundary || boundaries[0] || entry * 0.99,
        sl: nextBoundary || boundaries[boundaries.length - 1] || entry * 1.01,
      };
    }
  }

  /**
   * Calculate TP/SL from imbalance boundaries
   */
  private calculateTPSLFromImbalance(
    imbalance: Imbalance,
    side: 'LONG' | 'SHORT'
  ): { tp: number; sl: number } {
    if (side === 'LONG') {
      return {
        tp: imbalance.upper,
        sl: imbalance.lower,
      };
    } else {
      return {
        tp: imbalance.lower,
        sl: imbalance.upper,
      };
    }
  }

  /**
   * Calculate overall signal confidence
   */
  private calculateConfidence(params: {
    orderflow: OrderflowSignal;
    profileContext: ProfileContext;
    sessionBias: SessionBias;
    setupType: SetupType;
  }): number {
    const { orderflow, profileContext, sessionBias, setupType } = params;

    let confidence = 0.5; // Base confidence

    // Orderflow contribution (0-0.4)
    confidence += orderflow.confidence * 0.4;

    // MP/VP contribution (0-0.3)
    if (profileContext.nodeType === 'HVN' || profileContext.nodeType === 'LVN') {
      confidence += profileContext.confidence * 0.3;
    }

    // Session bias alignment (0-0.2)
    if (
      (setupType === 'ORB' && sessionBias !== 'neutral') ||
      (sessionBias === 'long' && setupType.includes('LONG')) ||
      (sessionBias === 'short' && setupType.includes('SHORT'))
    ) {
      confidence += 0.2;
    }

    // Setup type bonus (0-0.1)
    if (setupType === 'ORB') {
      confidence += 0.1; // ORB is highest priority
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Get current session bias
   */
  getSessionBias(): SessionBias {
    return this.sessionBias;
  }

  /**
   * Get last generated signal
   */
  getLastSignal(): TradeSignal | null {
    return this.lastSignal;
  }

  /**
   * Get GARCH zone engine instance
   */
  getGARCHZones(): GARCHZoneEngine {
    return this.garchZones;
  }

  /**
   * Get ORB module instance
   */
  getORB(): ORBModule {
    return this.orb;
  }
}

