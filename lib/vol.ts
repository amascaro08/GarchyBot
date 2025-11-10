/**
 * GARCH(1,1) volatility estimator with optional calibration
 * 
 * Implements textbook GARCH(1,1) model:
 * sigma2_t = alpha0 + alpha1 * r_{t-1}^2 + beta1 * sigma2_{t-1}
 * 
 * Where r_t = ln(P_t / P_{t-1}) are log returns
 */

export interface Garch11Options {
  /** Long-term variance (alpha0) */
  alpha0?: number;
  /** ARCH coefficient (alpha1) */
  alpha1?: number;
  /** GARCH coefficient (beta1) */
  beta1?: number;
  /** Clamp kPct to [min, max] as percentages (default: [1, 10]) */
  clampPct?: [number, number];
}

export interface Garch11Result {
  /** Volatility (standard deviation) in return units */
  vol: number;
  /** Variance in return units squared */
  var: number;
  /** kPct: volatility as percentage, clamped */
  kPct: number;
}

/**
 * Simple LRU cache for calibration results
 */
class CalibrationCache {
  private cache: Map<string, { params: { alpha0: number; alpha1: number; beta1: number }; timestamp: number }>;
  private maxSize: number;
  private ttl: number; // Time to live in milliseconds (default: 24 hours)

  constructor(maxSize: number = 100, ttl: number = 24 * 60 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: string): { alpha0: number; alpha1: number; beta1: number } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.params;
  }

  set(key: string, params: { alpha0: number; alpha1: number; beta1: number }): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    
    this.cache.set(key, { params, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const calibrationCache = new CalibrationCache();

/**
 * Calculate log returns from price series
 * Validates inputs and filters out invalid values
 */
function logReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1];
    const currPrice = prices[i];
    
    // Validate prices: must be positive and finite
    if (prevPrice > 0 && currPrice > 0 && isFinite(prevPrice) && isFinite(currPrice)) {
      const logReturn = Math.log(currPrice / prevPrice);
      
      // Filter out extreme returns (>50% or <-50% daily move is suspicious)
      // This prevents outliers from skewing the volatility calculation
      if (isFinite(logReturn) && Math.abs(logReturn) < 0.693) { // ln(2) ≈ 0.693 for 100% move
        returns.push(logReturn);
      }
    }
  }
  return returns;
}

/**
 * Initialize variance using sample variance of first N returns
 */
function initializeVariance(returns: number[], initWindow: number = 30): number {
  const n = Math.min(initWindow, returns.length);
  if (n < 2) {
    // Fallback: use squared return
    return returns.length > 0 ? returns[0] ** 2 : 0.0001;
  }
  
  const sample = returns.slice(0, n);
  const mean = sample.reduce((a, b) => a + b, 0) / n;
  const variance = sample.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (n - 1);
  
  return Math.max(variance, 1e-8); // Ensure positive
}

/**
 * EWMA volatility fallback for insufficient data
 */
function ewmaVolatility(returns: number[], lambda: number = 0.94): number {
  if (returns.length < 2) {
    return Math.sqrt(0.0004); // Default 2% volatility
  }
  
  let ewmaVar = returns[0] ** 2;
  for (let i = 1; i < returns.length; i++) {
    ewmaVar = lambda * ewmaVar + (1 - lambda) * returns[i] ** 2;
  }
  
  return Math.sqrt(Math.max(ewmaVar, 1e-8));
}

/**
 * GARCH(1,1) volatility calculation
 * 
 * @param returns - Log returns array
 * @param opts - GARCH parameters and options
 * @returns Volatility metrics
 */
export function garch11FromReturns(
  returns: number[],
  opts: Garch11Options = {}
): Garch11Result {
  const {
    alpha0 = 1e-6,
    alpha1 = 0.10,
    beta1 = 0.85,
    clampPct = [1, 10],
  } = opts;

  // Validate parameters
  if (alpha0 <= 0 || alpha1 < 0 || beta1 < 0 || alpha1 + beta1 >= 0.999) {
    throw new Error('Invalid GARCH parameters: alpha0>0, alpha1>=0, beta1>=0, alpha1+beta1<0.999');
  }

  if (returns.length < 2) {
    const vol = ewmaVolatility(returns);
    const kPct = Math.max(clampPct[0], Math.min(clampPct[1], vol * 100));
    return { vol, var: vol ** 2, kPct };
  }

  // Initialize variance
  let sigma2 = initializeVariance(returns);

  // GARCH(1,1) recurrence: use PREVIOUS return squared
  for (let i = 1; i < returns.length; i++) {
    const rPrevSquared = returns[i - 1] ** 2;
    sigma2 = alpha0 + alpha1 * rPrevSquared + beta1 * sigma2;
    sigma2 = Math.max(sigma2, 1e-8); // Ensure positive
  }

  const vol = Math.sqrt(sigma2);
  
  // Convert to percentage and clamp
  // Add additional safeguard: if vol is extremely large, cap it before conversion
  const volCapped = Math.min(vol, 0.1); // Cap at 10% daily volatility (100% annualized)
  const kPct = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));

  return { vol, var: sigma2, kPct };
}

/**
 * Bounded Nelder-Mead optimization for GARCH calibration
 * Minimizes 1-step-ahead squared errors of variance
 */
function nelderMeadCalibration(
  returns: number[],
  bounds: { alpha0: [number, number]; alpha1: [number, number]; beta1: [number, number] },
  maxIters: number = 100
): { alpha0: number; alpha1: number; beta1: number } {
  // Initial guess (center of bounds)
  const alpha0Init = (bounds.alpha0[0] + bounds.alpha0[1]) / 2;
  const alpha1Init = (bounds.alpha1[0] + bounds.alpha1[1]) / 2;
  const beta1Init = (bounds.beta1[0] + bounds.beta1[1]) / 2;

  // Objective function: minimize 1-step-ahead squared errors
  const objective = (params: { alpha0: number; alpha1: number; beta1: number }): number => {
    const { alpha0, alpha1, beta1 } = params;
    
    // Constraint check
    if (alpha0 <= 0 || alpha1 < 0 || beta1 < 0 || alpha1 + beta1 >= 0.999) {
      return Infinity;
    }

    // Initialize variance
    let sigma2 = initializeVariance(returns);
    let sumSquaredErrors = 0;

    // Compute 1-step-ahead prediction errors
    for (let i = 1; i < returns.length; i++) {
      const rPrevSquared = returns[i - 1] ** 2;
      const predictedVar = alpha0 + alpha1 * rPrevSquared + beta1 * sigma2;
      const actualVar = returns[i] ** 2;
      const error = predictedVar - actualVar;
      sumSquaredErrors += error ** 2;
      sigma2 = predictedVar;
    }

    return sumSquaredErrors;
  };

  // Simple grid search (faster and more reliable than Nelder-Mead for bounded problems)
  const gridSize = 10;
  let bestParams = { alpha0: alpha0Init, alpha1: alpha1Init, beta1: beta1Init };
  let bestError = objective(bestParams);

  // Grid search over parameter space
  const alpha0Step = (bounds.alpha0[1] - bounds.alpha0[0]) / gridSize;
  const alpha1Step = (bounds.alpha1[1] - bounds.alpha1[0]) / gridSize;
  const beta1Step = (bounds.beta1[1] - bounds.beta1[0]) / gridSize;

  for (let i0 = 0; i0 <= gridSize; i0++) {
    const alpha0 = bounds.alpha0[0] + i0 * alpha0Step;
    for (let i1 = 0; i1 <= gridSize; i1++) {
      const alpha1 = bounds.alpha1[0] + i1 * alpha1Step;
      for (let i2 = 0; i2 <= gridSize; i2++) {
        const beta1 = bounds.beta1[0] + i2 * beta1Step;
        
        // Check constraint: alpha1 + beta1 < 0.999
        if (alpha1 + beta1 >= 0.999) continue;
        
        const params = { alpha0, alpha1, beta1 };
        const error = objective(params);
        
        if (error < bestError && isFinite(error)) {
          bestError = error;
          bestParams = params;
        }
      }
    }
  }

  return bestParams;
}

/**
 * Calibrate GARCH(1,1) parameters from returns
 */
export function calibrateGarch11(
  returns: number[],
  bounds: {
    alpha0?: [number, number];
    alpha1?: [number, number];
    beta1?: [number, number];
  } = {},
  maxIters: number = 100
): { alpha0: number; alpha1: number; beta1: number } {
  const defaultBounds = {
    alpha0: [1e-8, 1e-4] as [number, number],
    alpha1: [0.01, 0.3] as [number, number],
    beta1: [0.5, 0.95] as [number, number],
  };

  const finalBounds = {
    alpha0: bounds.alpha0 ?? defaultBounds.alpha0,
    alpha1: bounds.alpha1 ?? defaultBounds.alpha1,
    beta1: bounds.beta1 ?? defaultBounds.beta1,
  };

  return nelderMeadCalibration(returns, finalBounds, maxIters);
}

/**
 * Estimate kPct from price series with optional calibration
 */
export function estimateKPercent(
  prices: number[],
  opts: {
    useCalibration?: boolean;
    clampPct?: [number, number];
    symbol?: string;
    timeframe?: string;
    day?: string; // YYYY-MM-DD format for caching
  } = {}
): number {
  const { useCalibration = false, clampPct = [1, 10], symbol, timeframe, day } = opts;

  // Validate input
  if (!Array.isArray(prices) || prices.length < 2) {
    return clampPct[0];
  }

  // Filter out invalid prices (non-positive, NaN, Infinity)
  const validPrices = prices.filter(p => p > 0 && isFinite(p));
  
  if (validPrices.length < 2) {
    return clampPct[0];
  }

  const returns = logReturns(validPrices);
  
  // If no valid returns after filtering, return minimum
  if (returns.length === 0) {
    return clampPct[0];
  }

  // Use EWMA fallback if insufficient data
  if (returns.length < 30) {
    const vol = ewmaVolatility(returns);
    // Add safeguard: cap volatility before conversion
    const volCapped = Math.min(vol, 0.1); // Cap at 10% daily volatility
    return Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
  }

  let params: { alpha0: number; alpha1: number; beta1: number } | undefined;

  // Try cache if calibration is requested
  if (useCalibration && symbol && timeframe && day) {
    const cacheKey = `${symbol}-${timeframe}-${day}`;
    const cachedParams = calibrationCache.get(cacheKey);
    
    if (cachedParams) {
      params = cachedParams;
    } else {
      params = calibrateGarch11(returns);
      calibrationCache.set(cacheKey, params);
    }
  }

  const result = garch11FromReturns(returns, {
    ...params,
    clampPct,
  });

  return result.kPct;
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use estimateKPercent or garch11FromReturns directly
 */
export function garch11Legacy(closes: number[], multiplier: number = 1.0): number {
  const returns = logReturns(closes);
  const result = garch11FromReturns(returns, { clampPct: [1, 10] });
  
  // Validate multiplier and apply with final clamp
  const safeMultiplier = Math.max(0.1, Math.min(10, multiplier));
  const finalResult = result.kPct * safeMultiplier;
  
  return Math.max(1, Math.min(20, finalResult));
}

/**
 * Legacy function name for backward compatibility
 * @deprecated Use estimateKPercent or garch11FromReturns directly
 */
export function garch11Old(closes: number[], multiplier: number = 1.0): number {
  return garch11Legacy(closes, multiplier);
}

/**
 * Legacy function name - maps to estimateKPercent for API compatibility
 * Takes price array (closes) and returns kPct percentage
 * @deprecated Use estimateKPercent instead
 */
export function garch11(closes: number[], multiplier: number = 1.0): number {
  // Validate multiplier to prevent extreme values
  const safeMultiplier = Math.max(0.1, Math.min(10, multiplier)); // Clamp multiplier between 0.1 and 10
  
  const kPct = estimateKPercent(closes, { clampPct: [1, 10] });
  
  // Apply multiplier but ensure result stays within reasonable bounds
  const result = kPct * safeMultiplier;
  
  // Final clamp to prevent values > 10% (or allow up to 20% if multiplier is used, but cap at 20%)
  return Math.max(1, Math.min(20, result));
}
