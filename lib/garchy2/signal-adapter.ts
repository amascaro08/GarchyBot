/**
 * Signal Adapter for Garchy 2.0
 * 
 * Adapter layer that integrates Garchy 2.0 strategy engine with the existing signal API.
 * Provides backward compatibility while adding new strategy features.
 */

import type { Candle } from '../types';
import { Garchy2StrategyEngine, type TradeSignal } from './strategy-engine';
import { dailyOpenUTC } from '../strategy';

export interface SignalAdapterConfig {
  /** Enable Garchy 2.0 features (default: true) */
  enableGarchy2: boolean;
  /** ORB window duration in minutes (default: 5) */
  orbWindowMinutes?: number;
  /** Minimum signal confidence (default: 0.4) */
  minSignalConfidence?: number;
}

export interface SignalAdapterResult {
  /** Signal direction */
  side: 'LONG' | 'SHORT' | null;
  /** Entry price */
  entry: number | null;
  /** Take profit */
  tp: number | null;
  /** Stop loss */
  sl: number | null;
  /** Reason */
  reason: string;
  /** Garchy 2.0 metadata (if enabled) */
  garchy2Meta?: {
    setupType: string;
    confidence: number;
    sessionBias: string;
    profileContext: {
      nodeType: string;
      confidence: number;
    };
  };
}

/**
 * Signal Adapter
 */
export class SignalAdapter {
  private engine: Garchy2StrategyEngine | null = null;
  private config: SignalAdapterConfig;
  private initialized = false;
  private lastEvaluation: TradeSignal | null = null;

  constructor(config: SignalAdapterConfig = { enableGarchy2: true }) {
    this.config = {
      ...config,
      enableGarchy2: config.enableGarchy2 ?? true, // Default to true if not explicitly set
    };

    if (this.config.enableGarchy2) {
      this.engine = new Garchy2StrategyEngine({
        orb: {
          windowMinutes: config.orbWindowMinutes || 5,
        },
        minSignalConfidence: config.minSignalConfidence || 0.4,
      });
    }
  }

  /**
   * Initialize strategy for a session
   */
  initialize(params: {
    dailyOpen: number;
    garchPct: number;
    sessionStart?: number;
    candles: Candle[];
  }): void {
    if (!this.engine) {
      return;
    }

    const sessionStart = params.sessionStart || this.getSessionStart(params.candles);
    this.engine.initialize({
      dailyOpen: params.dailyOpen,
      garchPct: params.garchPct,
      sessionStart,
      candles: params.candles,
    });

    this.initialized = true;
  }

  /**
   * Evaluate and generate signal
   */
  async evaluate(params: {
    candles: Candle[];
    vwap: number;
    dOpen: number;
    upLevels: number[];
    dnLevels: number[];
    symbol: string;
    currentPrice?: number;
    timestamp?: number;
  }): Promise<SignalAdapterResult> {
    // Use Garchy 2.0 if enabled and initialized
    if (this.config.enableGarchy2 && this.engine && this.initialized) {
      try {
      const currentPrice = params.currentPrice || params.candles[params.candles.length - 1]?.close || params.dOpen;
      const timestamp = params.timestamp || Date.now();

      // Ensure engine is initialized with latest data
      const sessionStart = this.getSessionStart(params.candles);
      const garchPct = this.estimateGarchPct(params.dOpen, params.upLevels, params.dnLevels);

      // Re-initialize if needed (daily reset)
      if (!this.initialized || this.hasSessionReset(sessionStart)) {
        this.initialize({
          dailyOpen: params.dOpen,
          garchPct,
          sessionStart,
          candles: params.candles,
        });
      }

      // Evaluate strategy (pass VWAP for fallback bias calculation)
      const signal = await this.engine.evaluate({
        currentPrice,
        timestamp,
        candles: params.candles,
        symbol: params.symbol,
        vwap: params.vwap, // Pass VWAP for fallback session bias
      });

      if (signal) {
        this.lastEvaluation = signal;
        return {
          side: signal.side,
          entry: signal.entry,
          tp: signal.tp,
          sl: signal.sl,
          reason: signal.context.reason,
          garchy2Meta: {
            setupType: signal.setupType,
            confidence: signal.confidence,
            sessionBias: signal.context.sessionBias,
            profileContext: {
              nodeType: signal.context.profileContext.nodeType,
              confidence: signal.context.profileContext.confidence,
            },
          },
        };
      }

        // No signal from Garchy 2.0
        return {
          side: null,
          entry: null,
          tp: null,
          sl: null,
          reason: 'No signal from Garchy 2.0 strategy',
        };
      } catch (error) {
        // If Garchy 2.0 fails, fall back to v1
        console.error('[SIGNAL-ADAPTER] Error in Garchy 2.0 evaluation, falling back to v1:', error);
        return this.fallbackToV1(params);
      }
    }

    // Fallback to v1 logic (for backward compatibility)
    return this.fallbackToV1(params);
  }

  /**
   * Fallback to v1 signal logic
   */
  private fallbackToV1(params: {
    candles: Candle[];
    vwap: number;
    dOpen: number;
    upLevels: number[];
    dnLevels: number[];
  }): SignalAdapterResult {
    // Import v1 logic
    const { strictSignalWithDailyOpen } = require('../strategy');

    const signal = strictSignalWithDailyOpen({
      candles: params.candles,
      vwap: params.vwap,
      dOpen: params.dOpen,
      upLevels: params.upLevels,
      dnLevels: params.dnLevels,
      noTradeBandPct: 0.001,
      useDailyOpenEntry: true,
      realtimePrice: params.candles[params.candles.length - 1]?.close,
    });

    return {
      side: signal.side,
      entry: signal.entry,
      tp: signal.tp,
      sl: signal.sl,
      reason: signal.reason,
    };
  }

  /**
   * Get session start timestamp
   */
  private getSessionStart(candles: Candle[]): number {
    if (candles.length === 0) {
      return dailyOpenUTC([]);
    }

    const lastCandle = candles[candles.length - 1];
    const date = new Date(lastCandle.ts);
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0, 0, 0, 0
    )).getTime();
  }

  /**
   * Estimate GARCH% from zone levels
   */
  private estimateGarchPct(dailyOpen: number, upLevels: number[], dnLevels: number[]): number {
    if (upLevels.length === 0 || dnLevels.length === 0) {
      return 0.025; // Default 2.5%
    }

    // Estimate from upper range
    const upperRange = upLevels[upLevels.length - 1] || dailyOpen;
    const garchPctUp = (upperRange - dailyOpen) / dailyOpen;

    // Estimate from lower range
    const lowerRange = dnLevels[dnLevels.length - 1] || dailyOpen;
    const garchPctDown = (dailyOpen - lowerRange) / dailyOpen;

    // Use average
    return (garchPctUp + garchPctDown) / 2;
  }

  /**
   * Check if session has reset (new day)
   */
  private lastSessionStart: number | null = null;
  
  private hasSessionReset(sessionStart: number): boolean {
    // Check if session start is different from last known
    if (this.lastSessionStart === null) {
      this.lastSessionStart = sessionStart;
      return true; // First initialization
    }
    
    const hasReset = this.lastSessionStart !== sessionStart;
    if (hasReset) {
      this.lastSessionStart = sessionStart;
    }
    return hasReset;
  }

  /**
   * Get last evaluation signal
   */
  getLastEvaluation(): TradeSignal | null {
    return this.lastEvaluation;
  }

  /**
   * Check if Garchy 2.0 is enabled
   */
  isGarchy2Enabled(): boolean {
    return this.config.enableGarchy2 && this.engine !== null;
  }
}

