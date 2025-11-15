/**
 * Opening Range Breakout (ORB) Module - "Rule 0"
 * 
 * Tracks the opening range at the start of each session and detects breakouts.
 * Configurable opening range window (default: first 5 minutes after session start).
 */

import type { Candle } from '../types';

export interface ORBConfig {
  /** Opening range window duration in minutes (default: 5) */
  windowMinutes: number;
  /** Minimum time price must hold above/below breakout level in milliseconds (default: 30000 = 30s) */
  holdDurationMs: number;
  /** Minimum ticks/percentage price must move beyond breakout level for confirmation (default: 0.001 = 0.1%) */
  breakoutConfirmationPct: number;
}

export interface ORBLevels {
  /** Opening Range High */
  orh: number;
  /** Opening Range Low */
  orl: number;
  /** Session start timestamp */
  sessionStart: number;
  /** Window end timestamp */
  windowEnd: number;
}

export type ORBState = 'tracking' | 'closed' | 'broken_up' | 'broken_down';

export interface ORBSignal {
  /** Signal direction: 'LONG' for breakout above ORH, 'SHORT' for breakout below ORL */
  side: 'LONG' | 'SHORT' | null;
  /** Breakout level (ORH for long, ORL for short) */
  level: number | null;
  /** Current ORB state */
  state: ORBState;
  /** Session bias based on ORB outcome */
  sessionBias: 'long' | 'short' | 'neutral';
  /** Confirmation status */
  confirmed: boolean;
}

const DEFAULT_CONFIG: ORBConfig = {
  windowMinutes: 5,
  holdDurationMs: 30000, // 30 seconds
  breakoutConfirmationPct: 0.001, // 0.1%
};

/**
 * ORB Module class
 */
export class ORBModule {
  private config: ORBConfig;
  private levels: ORBLevels | null = null;
  private state: ORBState = 'tracking';
  private sessionStart: number;
  private sessionBias: 'long' | 'short' | 'neutral' = 'neutral';
  private breakoutConfirmation: {
    direction: 'long' | 'short' | null;
    level: number;
    timestamp: number;
  } | null = null;

  constructor(config: Partial<ORBConfig> = {}, sessionStart: number = Date.now()) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionStart = sessionStart;
  }

  /**
   * Initialize ORB for a new session
   */
  initialize(sessionStart: number, initialCandles: Candle[]): void {
    this.sessionStart = sessionStart;
    this.state = 'tracking';
    this.sessionBias = 'neutral';
    this.breakoutConfirmation = null;

    // Calculate ORH/ORL from initial candles
    const windowEnd = sessionStart + this.config.windowMinutes * 60 * 1000;
    const candlesInWindow = initialCandles.filter(
      (c) => c.ts >= sessionStart && c.ts <= windowEnd
    );

    if (candlesInWindow.length === 0) {
      // No candles yet, will be updated incrementally
      this.levels = {
        orh: 0,
        orl: 0,
        sessionStart,
        windowEnd,
      };
      return;
    }

    let orh = candlesInWindow[0].high;
    let orl = candlesInWindow[0].low;

    for (const candle of candlesInWindow) {
      orh = Math.max(orh, candle.high);
      orl = Math.min(orl, candle.low);
    }

    this.levels = {
      orh,
      orl,
      sessionStart,
      windowEnd,
    };
  }

  /**
   * Update ORB with new candle/tick data
   */
  update(currentPrice: number, timestamp: number, candles: Candle[]): ORBSignal {
    if (!this.levels) {
      // Initialize if not done yet
      const sessionStart = this.getSessionStart(timestamp);
      this.initialize(sessionStart, candles);
    }

    if (!this.levels) {
      return this.getSignal();
    }

    const now = timestamp || Date.now();
    const windowEnd = this.levels.windowEnd;

    // Update ORH/ORL during tracking phase
    if (this.state === 'tracking' && now <= windowEnd) {
      const candlesInWindow = candles.filter(
        (c) => c.ts >= this.levels!.sessionStart && c.ts <= windowEnd
      );

      if (candlesInWindow.length > 0) {
        let orh = candlesInWindow[0].high;
        let orl = candlesInWindow[0].low;

        for (const candle of candlesInWindow) {
          orh = Math.max(orh, candle.high);
          orl = Math.min(orl, candle.low);
        }

        this.levels.orh = orh;
        this.levels.orl = orl;
      }

      // Check for potential breakouts (but don't confirm until window closes)
      if (currentPrice > this.levels.orh) {
        // Price above ORH during tracking - potential long breakout
      } else if (currentPrice < this.levels.orl) {
        // Price below ORL during tracking - potential short breakout
      }
    }

    // Window closed - check for confirmed breakouts
    if (this.state === 'tracking' && now > windowEnd) {
      this.state = 'closed';
      
      // Check for immediate breakouts at window close
      if (currentPrice > this.levels.orh) {
        this.state = 'broken_up';
        this.breakoutConfirmation = {
          direction: 'long',
          level: this.levels.orh,
          timestamp: now,
        };
        this.sessionBias = 'long';
      } else if (currentPrice < this.levels.orl) {
        this.state = 'broken_down';
        this.breakoutConfirmation = {
          direction: 'short',
          level: this.levels.orl,
          timestamp: now,
        };
        this.sessionBias = 'short';
      }
    }

    // Confirm breakout after hold duration
    if (this.breakoutConfirmation && now >= this.breakoutConfirmation.timestamp + this.config.holdDurationMs) {
      const { direction, level } = this.breakoutConfirmation;
      const confirmationThreshold = level * this.config.breakoutConfirmationPct;

      if (direction === 'long' && currentPrice >= level + confirmationThreshold) {
        // Confirmed long breakout
        this.state = 'broken_up';
        this.sessionBias = 'long';
      } else if (direction === 'short' && currentPrice <= level - confirmationThreshold) {
        // Confirmed short breakout
        this.state = 'broken_down';
        this.sessionBias = 'short';
      }
    }

    return this.getSignal();
  }

  /**
   * Get current ORB levels
   */
  getLevels(): ORBLevels | null {
    return this.levels;
  }

  /**
   * Get current ORB signal
   */
  getSignal(): ORBSignal {
    const confirmed = this.state === 'broken_up' || this.state === 'broken_down';
    
    if (this.state === 'broken_up' && this.breakoutConfirmation) {
      return {
        side: 'LONG',
        level: this.breakoutConfirmation.level,
        state: this.state,
        sessionBias: 'long',
        confirmed,
      };
    }

    if (this.state === 'broken_down' && this.breakoutConfirmation) {
      return {
        side: 'SHORT',
        level: this.breakoutConfirmation.level,
        state: this.state,
        sessionBias: 'short',
        confirmed,
      };
    }

    return {
      side: null,
      level: null,
      state: this.state,
      sessionBias: this.sessionBias,
      confirmed: false,
    };
  }

  /**
   * Get session start timestamp for a given timestamp
   * Uses UTC 00:00 as session start
   */
  private getSessionStart(timestamp: number): number {
    const date = new Date(timestamp);
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0, 0, 0, 0
    )).getTime();
  }

  /**
   * Check if ORB window is currently active
   */
  isWindowActive(timestamp: number = Date.now()): boolean {
    if (!this.levels) return false;
    return timestamp >= this.levels.sessionStart && timestamp <= this.levels.windowEnd;
  }

  /**
   * Get session bias (from ORB outcome or neutral)
   */
  getSessionBias(): 'long' | 'short' | 'neutral' {
    return this.sessionBias;
  }
}

