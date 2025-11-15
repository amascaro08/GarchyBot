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
    vwap?: number; // Optional VWAP for fallback bias calculation
  }): Promise<TradeSignal | null> {
    const { currentPrice, timestamp, candles, symbol, vwap } = params;

    // Update all modules with latest data
    this.orderflow.updateCandles(candles);

    // Update ORB
    const orbSignal = this.orb.update(currentPrice, timestamp, candles);
    if (orbSignal.sessionBias !== 'neutral') {
      // ORB has priority - if it sets a bias, use it
      this.sessionBias = orbSignal.sessionBias;
      console.log(`[GARCHY2] ORB set session bias: ${this.sessionBias}`);
    } else {
      // ORB didn't set a bias (no breakout detected) - use VWAP fallback
      // VWAP logic: price < VWAP → short bias (bearish), price > VWAP → long bias (bullish)
      if (vwap && vwap > 0) {
        if (currentPrice < vwap) {
          this.sessionBias = 'short';
          console.log(`[GARCHY2] Fallback bias: SHORT (price ${currentPrice.toFixed(2)} < VWAP ${vwap.toFixed(2)})`);
        } else if (currentPrice > vwap) {
          this.sessionBias = 'long';
          console.log(`[GARCHY2] Fallback bias: LONG (price ${currentPrice.toFixed(2)} > VWAP ${vwap.toFixed(2)})`);
        } else {
          // Price equals VWAP - keep neutral or reset to neutral
          this.sessionBias = 'neutral';
          console.log(`[GARCHY2] Price equals VWAP (${vwap.toFixed(2)}) - bias remains neutral`);
        }
      } else {
        // No VWAP available - keep current bias or set to neutral
        if (this.sessionBias === 'neutral') {
          console.log(`[GARCHY2] No VWAP available and no ORB bias - keeping neutral`);
        }
      }
    }

    // Update imbalances (detect new ones)
    const zoneQuadrantFn = (price: number) => this.garchZones.getCurrentZone(price).quadrant;
    this.imbalanceDetector.detectImbalances(candles, zoneQuadrantFn);

    // Decision hierarchy: Check ORB first (Rule 0)
    if (orbSignal.confirmed && orbSignal.side) {
      console.log(`[GARCHY2] ORB signal detected - ${orbSignal.side} @ ${orbSignal.level?.toFixed(2)}, validating against 5 rules...`);
      const signal = await this.evaluateORBSignal(
        orbSignal,
        currentPrice,
        candles,
        symbol
      );
      if (signal) {
        console.log(`[GARCHY2] ✓ ORB signal PASSED all 5 rules - ${signal.side} @ ${signal.entry?.toFixed(2)}, Confidence: ${signal.confidence.toFixed(2)}`);
        this.lastSignal = signal;
        return signal;
      } else {
        console.log(`[GARCHY2] ✗ ORB signal FAILED one or more of the 5 validation rules`);
      }
    } else {
      const orbState = this.orb.getSignal();
      if (orbState.state === 'tracking') {
        console.log(`[GARCHY2] ORB window still active (tracking) - waiting for breakout`);
      } else if (orbState.state === 'closed' && !orbState.confirmed) {
        console.log(`[GARCHY2] ORB window closed, no breakout detected`);
      } else {
        console.log(`[GARCHY2] ORB state: ${orbState.state}, confirmed: ${orbState.confirmed}, side: ${orbState.side || 'none'}`);
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
    } else {
      const zoneInfo = this.garchZones.getCurrentZone(currentPrice);
      const boundaries = this.garchZones.getAllBoundaries();
      const nearestBoundary = this.garchZones.getNearestBoundary(currentPrice);
      const distancePct = ((Math.abs(currentPrice - nearestBoundary) / currentPrice) * 100).toFixed(3);
      console.log(`[GARCHY2] No GARCH zone signal - Current zone: ${zoneInfo.quadrant}, Nearest boundary: ${nearestBoundary.toFixed(2)}, Distance: ${distancePct}%`);
    }

    const imbalanceSignal = await this.evaluateImbalances(
      currentPrice,
      candles,
      symbol
    );
    if (imbalanceSignal) {
      this.lastSignal = imbalanceSignal;
      return imbalanceSignal;
    } else {
      const imbalances = this.imbalanceDetector.getActiveImbalances();
      const imbalancesNear = this.imbalanceDetector.getImbalancesNearLevel(currentPrice, 0.002);
      console.log(`[GARCHY2] No imbalance signal - Active imbalances: ${imbalances.length}, Near current price: ${imbalancesNear.length}`);
    }

    console.log(`[GARCHY2] No signal found - Price: ${currentPrice.toFixed(2)}, Session bias: ${this.sessionBias}, Zone: ${this.garchZones.getCurrentZone(currentPrice).quadrant}`);
    return null;
  }

  /**
   * Validate trade against 5 strict rules
   */
  private async validateTrade(
    level: number,
    side: 'LONG' | 'SHORT',
    currentPrice: number,
    candles: Candle[],
    symbol: string,
    levelType: 'ORB' | 'GARCH' | 'IMBALANCE'
  ): Promise<{ valid: boolean; reason: string }> {
    // Rule 1: Level Validation - Price must be at GARCH boundary, ORB level, or imbalance
    const isAtLevel = this.isPriceAtLevel(currentPrice, level, levelType);
    const distancePct = ((Math.abs(currentPrice - level) / level) * 100).toFixed(3);
    if (!isAtLevel) {
      return { valid: false, reason: `Rule 1 FAILED - Price ${distancePct}% away from level (tolerance: ${levelType === 'ORB' ? '0.1%' : '0.2%'})` };
    }
    console.log(`[GARCHY2]   ✓ Rule 1 PASSED - Price at level (distance: ${distancePct}%)`);

    // Rule 2: Bias Alignment - Trade direction matches session bias
    const biasAligned = this.isBiasAligned(side);
    if (!biasAligned) {
      return { valid: false, reason: `Rule 2 FAILED - Trade direction (${side}) does not match session bias (${this.sessionBias})` };
    }
    console.log(`[GARCHY2]   ✓ Rule 2 PASSED - Bias aligned (${side} matches ${this.sessionBias} bias)`);

    // Rule 3: Profile Context - HVN/LVN context makes sense
    const profileContext = this.marketProfile.getProfileContext(level);
    const profileValid = this.isProfileContextValid(profileContext, side, currentPrice, level);
    if (!profileValid.valid) {
      return { valid: false, reason: `Rule 3 FAILED - ${profileValid.reason} (Node type: ${profileContext.nodeType})` };
    }
    console.log(`[GARCHY2]   ✓ Rule 3 PASSED - Profile context valid (${profileContext.nodeType})`);

    // Rule 4: Orderflow Confirmation - Tape agrees with trade
    const orderflow = await this.orderflow.analyzeOrderflow(symbol, level, currentPrice, side);
    if (!this.orderflow.confirmsTrade(orderflow, side)) {
      return { 
        valid: false, 
        reason: `Rule 4 FAILED - Orderflow bias (${orderflow.bias}) doesn't confirm ${side}, confidence: ${orderflow.confidence.toFixed(2)}` 
      };
    }
    console.log(`[GARCHY2]   ✓ Rule 4 PASSED - Orderflow confirms (bias: ${orderflow.bias}, confidence: ${orderflow.confidence.toFixed(2)})`);

    // Rule 5: Clean Trigger - Price gives clean trigger
    const triggerValid = this.hasCleanTrigger(candles, level, side, currentPrice, levelType);
    if (!triggerValid.valid) {
      return { valid: false, reason: `Rule 5 FAILED - ${triggerValid.reason}` };
    }
    console.log(`[GARCHY2]   ✓ Rule 5 PASSED - ${triggerValid.reason}`);

    return { valid: true, reason: 'All 5 rules validated ✓' };
  }

  /**
   * Rule 1: Check if price is at a valid level
   */
  private isPriceAtLevel(currentPrice: number, level: number, levelType: 'ORB' | 'GARCH' | 'IMBALANCE'): boolean {
    const tolerance = levelType === 'ORB' ? 0.001 : 0.002; // 0.1% for ORB, 0.2% for others
    const distance = Math.abs(currentPrice - level) / level;
    return distance <= tolerance;
  }

  /**
   * Rule 2: Check if trade direction matches session bias
   */
  private isBiasAligned(side: 'LONG' | 'SHORT'): boolean {
    if (this.sessionBias === 'neutral') {
      return false; // No bias = no trade
    }
    return (side === 'LONG' && this.sessionBias === 'long') || 
           (side === 'SHORT' && this.sessionBias === 'short');
  }

  /**
   * Rule 3: Check if profile context makes sense
   */
  private isProfileContextValid(
    profileContext: ProfileContext,
    side: 'LONG' | 'SHORT',
    currentPrice: number,
    level: number
  ): { valid: boolean; reason?: string } {
    if (profileContext.nodeType === 'HVN') {
      // HVN = fade/reversal setups
      if (side === 'LONG' && currentPrice < level) {
        // Long below HVN = support bounce (reversal)
        return { valid: true };
      } else if (side === 'SHORT' && currentPrice > level) {
        // Short above HVN = resistance rejection (reversal)
        return { valid: true };
      }
      return { valid: false, reason: 'HVN context mismatch - expecting reversal setup' };
    } else if (profileContext.nodeType === 'LVN') {
      // LVN = breakout/continuation setups
      if (side === 'LONG' && currentPrice > level) {
        // Long above LVN = breakout continuation
        return { valid: true };
      } else if (side === 'SHORT' && currentPrice < level) {
        // Short below LVN = breakdown continuation
        return { valid: true };
      }
      return { valid: false, reason: 'LVN context mismatch - expecting breakout setup' };
    }
    // Neutral - lower confidence but allow if other rules pass
    return { valid: true };
  }

  /**
   * Rule 5: Check for clean price trigger
   */
  private hasCleanTrigger(
    candles: Candle[],
    level: number,
    side: 'LONG' | 'SHORT',
    currentPrice: number,
    levelType: 'ORB' | 'GARCH' | 'IMBALANCE'
  ): { valid: boolean; reason?: string } {
    if (candles.length < 3) {
      return { valid: false, reason: 'Not enough candles for trigger validation' };
    }

    const last3 = candles.slice(-3);
    const lastCandle = last3[last3.length - 1];
    const prevCandle = last3[last3.length - 2];
    const prevPrevCandle = last3[last3.length - 3];

    // Check for break + hold (for breakouts)
    if (levelType === 'ORB') {
      // ORB breakout: check direction based on side
      if (side === 'LONG') {
        // Long breakout above level
        const brokeAbove = lastCandle.close > level && prevCandle.close <= level;
        const holdingAbove = lastCandle.close > level && lastCandle.low > level * 0.999;
        if (brokeAbove && holdingAbove) {
          return { valid: true, reason: 'ORB break + hold confirmed' };
        }
      } else {
        // Short breakdown below level
        const brokeBelow = lastCandle.close < level && prevCandle.close >= level;
        const holdingBelow = lastCandle.close < level && lastCandle.high < level * 1.001;
        if (brokeBelow && holdingBelow) {
          return { valid: true, reason: 'ORB break + hold confirmed' };
        }
      }
    } else if (levelType === 'GARCH') {
      // GARCH breakout: check direction based on side and price position
      if (side === 'LONG' && currentPrice > level) {
        // Long breakout above GARCH boundary
        const brokeAbove = lastCandle.close > level && prevCandle.close <= level;
        const holdingAbove = lastCandle.close > level && lastCandle.low > level * 0.999;
        if (brokeAbove && holdingAbove) {
          return { valid: true, reason: 'GARCH break + hold confirmed' };
        }
      } else if (side === 'SHORT' && currentPrice < level) {
        // Short breakdown below GARCH boundary
        const brokeBelow = lastCandle.close < level && prevCandle.close >= level;
        const holdingBelow = lastCandle.close < level && lastCandle.high < level * 1.001;
        if (brokeBelow && holdingBelow) {
          return { valid: true, reason: 'GARCH break + hold confirmed' };
        }
      }
    }

    // Check for rejection wick with follow-through (for reversals)
    if (levelType === 'GARCH' || levelType === 'IMBALANCE') {
      if (side === 'LONG' && currentPrice < level) {
        // Long entry below level - check for rejection wick up and follow-through
        const hasRejectionWick = lastCandle.low < level * 0.999 && lastCandle.close > lastCandle.low * 1.001;
        const hasFollowThrough = lastCandle.close > prevCandle.close;
        if (hasRejectionWick && hasFollowThrough) {
          return { valid: true, reason: 'Rejection wick + follow-through confirmed' };
        }
      } else if (side === 'SHORT' && currentPrice > level) {
        // Short entry above level - check for rejection wick down and follow-through
        const hasRejectionWick = lastCandle.high > level * 1.001 && lastCandle.close < lastCandle.high * 0.999;
        const hasFollowThrough = lastCandle.close < prevCandle.close;
        if (hasRejectionWick && hasFollowThrough) {
          return { valid: true, reason: 'Rejection wick + follow-through confirmed' };
        }
      }
    }

    // Check for imbalance retest with clear intent
    if (levelType === 'IMBALANCE') {
      // Check if price is retesting imbalance with directional momentum
      const priceAtImbalance = Math.abs(currentPrice - level) / level < 0.002;
      const hasMomentum = side === 'LONG' 
        ? lastCandle.close > prevCandle.close && prevCandle.close > prevPrevCandle.close
        : lastCandle.close < prevCandle.close && prevCandle.close < prevPrevCandle.close;
      
      if (priceAtImbalance && hasMomentum) {
        return { valid: true, reason: 'Imbalance retest with momentum confirmed' };
      }
    }

    return { valid: false, reason: 'No clean trigger pattern detected' };
  }

  /**
   * Evaluate ORB signal (Rule 0)
   */
  private async evaluateORBSignal(
    orbSignal: ORBSignal,
    currentPrice: number,
    candles: Candle[],
    symbol: string
  ): Promise<TradeSignal | null> {
    if (!orbSignal.side || !orbSignal.level) {
      return null;
    }

    // Validate against all 5 rules
    console.log(`[GARCHY2] Validating ORB trade - Level: ${orbSignal.level.toFixed(2)}, Side: ${orbSignal.side}, Current Price: ${currentPrice.toFixed(2)}`);
    const validation = await this.validateTrade(
      orbSignal.level,
      orbSignal.side,
      currentPrice,
      candles,
      symbol,
      'ORB'
    );

    if (!validation.valid) {
      console.log(`[GARCHY2] ✗ ORB signal REJECTED - Rule failed: ${validation.reason}`);
      return null;
    }
    console.log(`[GARCHY2] ✓ ORB signal PASSED all 5 validation rules`);

    // Get MP/VP context (already validated in validateTrade)
    const profileContext = this.marketProfile.getProfileContext(orbSignal.level);

    // Get orderflow confirmation (already validated in validateTrade)
    const orderflow = await this.orderflow.analyzeOrderflow(
      symbol,
      orbSignal.level,
      currentPrice,
      orbSignal.side
    );

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

    console.log(`[GARCHY2] ORB confidence calculation - Orderflow: ${orderflow.confidence.toFixed(2)}, Profile: ${profileContext.nodeType}, Session bias: ${orbSignal.sessionBias}, Final: ${confidence.toFixed(2)}, Required: ${this.config.minSignalConfidence}`);

    if (confidence < this.config.minSignalConfidence) {
      console.log(`[GARCHY2] ORB signal rejected - Final confidence: ${confidence.toFixed(2)}, Required: ${this.config.minSignalConfidence}`);
      return null;
    }
    
    console.log(`[GARCHY2] ✓ ORB signal approved - ${orbSignal.side} @ ${orbSignal.level.toFixed(2)}, Confidence: ${confidence.toFixed(2)}`);

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

        // Validate against all 5 rules
        const validation = await this.validateTrade(
          boundary,
          side,
          currentPrice,
          candles,
          symbol,
          'GARCH'
        );

        if (!validation.valid) {
          console.log(`[GARCHY2] GARCH ${setupType} signal rejected at ${boundary.toFixed(2)} - ${validation.reason}`);
          continue;
        }

        // Get orderflow confirmation (already validated but need for confidence calc)
        const orderflow = await this.orderflow.analyzeOrderflow(
          symbol,
          boundary,
          currentPrice,
          side
        );

        const { tp, sl } = this.calculateTPSL(boundary, side, zoneLevels);

        const confidence = this.calculateConfidence({
          orderflow,
          profileContext,
          sessionBias: this.sessionBias,
          setupType,
        });

        if (confidence < this.config.minSignalConfidence) {
          console.log(`[GARCHY2] GARCH ${setupType} signal rejected at ${boundary.toFixed(2)} - Confidence: ${confidence.toFixed(2)}, Required: ${this.config.minSignalConfidence}`);
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

    // Validate against all 5 rules
    const validation = await this.validateTrade(
      imbalance.midpoint,
      side,
      currentPrice,
      candles,
      symbol,
      'IMBALANCE'
    );

    if (!validation.valid) {
      console.log(`[GARCHY2] Imbalance ${setupType} signal rejected at ${imbalance.midpoint.toFixed(2)} - ${validation.reason}`);
      return null;
    }

    const profileContext = this.marketProfile.getProfileContext(imbalance.midpoint);
    const orderflow = await this.orderflow.analyzeOrderflow(
      symbol,
      imbalance.midpoint,
      currentPrice,
      side
    );

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
      console.log(`[GARCHY2] Imbalance ${setupType} signal rejected at ${imbalance.midpoint.toFixed(2)} - Confidence: ${confidence.toFixed(2)}, Required: ${this.config.minSignalConfidence}`);
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

