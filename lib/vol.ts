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

export interface VolatilityModelsResult {
  /** GARCH(1,1) result */
  garch11: Garch11Result;
  /** EGARCH(1,1) result */
  egarch11: Garch11Result;
  /** GJR-GARCH(1,1) result */
  gjrgarch11: Garch11Result;
  /** Averaged volatility */
  averaged: Garch11Result;
  /** Debug information for troubleshooting */
  debugInfo?: {
    historicalStdDev?: number;
    garchForecasts?: number[];
    gjrForecasts?: number[];
    egarchForecasts?: number[];
    promGarch?: number;
    promGjr?: number;
    promEgarch?: number;
    promGlobal?: number;
  };
}

/**
 * Fitted model parameters and state for forecasting
 */
export interface FittedGarchModel {
  /** Model type: 'garch', 'gjr', 'egarch' */
  type: 'garch' | 'gjr' | 'egarch';
  /** Fitted parameters */
  params: {
    alpha0?: number;
    omega?: number;
    alpha1?: number;
    alpha?: number;
    gamma?: number;
    beta1?: number;
    beta?: number;
  };
  /** Final variance after fitting */
  finalVariance: number;
  /** Last return used for forecasting */
  lastReturn: number;
  /** Conditional volatility series (in percentage units) */
  conditionalVolatility: number[];
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
      // Filter out prices that look like outliers (e.g., 1999999.80 for BTC)
      // For BTC, reasonable range is ~1k to ~300k
      // Check if price change is suspiciously large (might be bad data)
      const priceChangeRatio = currPrice / prevPrice;
      if (priceChangeRatio > 10 || priceChangeRatio < 0.1) {
        // Price jumped more than 10x or dropped more than 90% - likely bad data
        continue;
      }
      
      const logReturn = Math.log(currPrice / prevPrice);
      
      // Filter out extreme returns (>50% or <-50% daily move is suspicious for daily data)
      // This prevents outliers from skewing the volatility calculation
      // For daily BTC, moves >30% are extremely rare, >50% is likely bad data
      if (isFinite(logReturn) && Math.abs(logReturn) < 0.405) { // ln(1.5) ≈ 0.405 for 50% move (stricter than before)
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
    // Cap volatility before conversion to prevent extreme values
    const volCapped = Math.min(vol, 0.1); // Cap at 10% daily volatility
    // Return kPct as decimal (0.01-0.10) not percentage (1-10)
    const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
    const kPct = kPctPercent / 100; // Convert to decimal form
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
  // Return kPct as decimal (0.01-0.10) not percentage (1-10)
  const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
  const kPct = kPctPercent / 100; // Convert to decimal form

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
    return clampPct[0] / 100; // Convert percentage to decimal
  }

  // Filter out invalid prices (non-positive, NaN, Infinity)
  const validPrices = prices.filter(p => p > 0 && isFinite(p));
  
  if (validPrices.length < 2) {
    return clampPct[0] / 100; // Convert percentage to decimal
  }

  const returns = logReturns(validPrices);
  
  // If no valid returns after filtering, return minimum
  if (returns.length === 0) {
    return clampPct[0] / 100; // Convert percentage to decimal
  }

  // Use EWMA fallback if insufficient data
  if (returns.length < 30) {
    const vol = ewmaVolatility(returns);
    // Add safeguard: cap volatility before conversion
    const volCapped = Math.min(vol, 0.1); // Cap at 10% daily volatility
    // Return kPct as decimal (0.01-0.10) not percentage (1-10)
    const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
    return kPctPercent / 100; // Convert to decimal form
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
  // kPct is now in decimal form (0.01-0.10), so multiply by 100 to get percentage, then apply multiplier
  const safeMultiplier = Math.max(0.1, Math.min(10, multiplier));
  const kPctPercent = result.kPct * 100; // Convert to percentage
  const finalResultPercent = kPctPercent * safeMultiplier;
  const finalResult = Math.max(1, Math.min(20, finalResultPercent)) / 100; // Convert back to decimal
  
  return finalResult;
}

/**
 * Legacy function name for backward compatibility
 * @deprecated Use estimateKPercent or garch11FromReturns directly
 */
export function garch11Old(closes: number[], multiplier: number = 1.0): number {
  return garch11Legacy(closes, multiplier);
}

/**
 * EGARCH(1,1) volatility calculation
 *
 * Model: ln(σ_t²) = ω + α * (ε_{t-1} / σ_{t-1}) + γ * (|ε_{t-1}| / σ_{t-1}) + β * ln(σ_{t-1}²)
 *
 * Where ε_t are standardized residuals: ε_t = r_t / σ_t
 *
 * @param returns - Log returns array
 * @param opts - EGARCH parameters and options
 * @returns Volatility metrics
 */
export function egarch11FromReturns(
  returns: number[],
  opts: {
    omega?: number;
    alpha?: number;
    gamma?: number;
    beta?: number;
    clampPct?: [number, number];
  } = {}
): Garch11Result {
  const {
    omega = -0.1,
    alpha = 0.1,
    gamma = 0.1,
    beta = 0.9,
    clampPct = [1, 10],
  } = opts;

  if (returns.length < 2) {
    const vol = ewmaVolatility(returns);
    const volCapped = Math.min(vol, 0.1);
    const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
    const kPct = kPctPercent / 100;
    return { vol, var: vol ** 2, kPct };
  }

  // Initialize log variance
  let lnSigma2 = Math.log(initializeVariance(returns));

  // EGARCH recurrence
  for (let i = 1; i < returns.length; i++) {
    const rPrev = returns[i - 1];
    const sigmaPrev = Math.exp(lnSigma2 / 2);
    const epsilonPrev = rPrev / sigmaPrev;
    const absEpsilonPrev = Math.abs(epsilonPrev);

    lnSigma2 = omega + alpha * epsilonPrev + gamma * (absEpsilonPrev - Math.sqrt(2 / Math.PI)) + beta * lnSigma2;
  }

  const sigma2 = Math.exp(lnSigma2);
  const vol = Math.sqrt(sigma2);

  const volCapped = Math.min(vol, 0.1);
  const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
  const kPct = kPctPercent / 100;

  return { vol, var: sigma2, kPct };
}

/**
 * GJR-GARCH(1,1) volatility calculation
 *
 * Model: σ_t² = ω + α * ε_{t-1}² + γ * ε_{t-1}² * I(ε_{t-1} < 0) + β * σ_{t-1}²
 *
 * Where I is the indicator function for negative returns (leverage effect)
 *
 * @param returns - Log returns array
 * @param opts - GJR-GARCH parameters and options
 * @returns Volatility metrics
 */
export function gjrgarch11FromReturns(
  returns: number[],
  opts: {
    omega?: number;
    alpha?: number;
    gamma?: number;
    beta?: number;
    clampPct?: [number, number];
  } = {}
): Garch11Result {
  const {
    omega = 1e-6,
    alpha = 0.05,
    gamma = 0.05,
    beta = 0.9,
    clampPct = [1, 10],
  } = opts;

  if (returns.length < 2) {
    const vol = ewmaVolatility(returns);
    const volCapped = Math.min(vol, 0.1);
    const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
    const kPct = kPctPercent / 100;
    return { vol, var: vol ** 2, kPct };
  }

  // Initialize variance
  let sigma2 = initializeVariance(returns);

  // GJR-GARCH recurrence
  for (let i = 1; i < returns.length; i++) {
    const rPrev = returns[i - 1];
    const rPrevSquared = rPrev ** 2;
    const leverageTerm = rPrev < 0 ? rPrevSquared : 0;

    sigma2 = omega + alpha * rPrevSquared + gamma * leverageTerm + beta * sigma2;
    sigma2 = Math.max(sigma2, 1e-8);
  }

  const vol = Math.sqrt(sigma2);

  const volCapped = Math.min(vol, 0.1);
  const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], volCapped * 100));
  const kPct = kPctPercent / 100;

  return { vol, var: sigma2, kPct };
}

/**
 * Fit GARCH model with explicit parameters (helper function)
 */
function fitGarchModelWithParams(
  returnsPct: number[],
  modelType: 'garch' | 'gjr' | 'egarch',
  params: {
    alpha0?: number;
    omega?: number;
    alpha1?: number;
    alpha?: number;
    gamma?: number;
    beta1?: number;
    beta?: number;
  }
): FittedGarchModel {
  let sigma2 = initializeVariance(returnsPct);
  const conditionalVol: number[] = [];

  if (modelType === 'garch') {
    const { alpha0 = 1e-4, alpha1 = 0.10, beta1 = 0.85 } = params;
    for (let i = 1; i < returnsPct.length; i++) {
      const rPrevSquared = returnsPct[i - 1] ** 2;
      sigma2 = alpha0 + alpha1 * rPrevSquared + beta1 * sigma2;
      sigma2 = Math.max(sigma2, 1e-8);
      conditionalVol.push(Math.sqrt(sigma2));
    }
    return {
      type: 'garch',
      params: { alpha0, alpha1, beta1 },
      finalVariance: sigma2,
      lastReturn: returnsPct[returnsPct.length - 1],
      conditionalVolatility: conditionalVol,
    };
  } else if (modelType === 'gjr') {
    const { omega = 1e-4, alpha = 0.05, gamma = 0.05, beta = 0.9 } = params;
    for (let i = 1; i < returnsPct.length; i++) {
      const rPrev = returnsPct[i - 1];
      const rPrevSquared = rPrev ** 2;
      const leverageTerm = rPrev < 0 ? rPrevSquared : 0;
      sigma2 = omega + alpha * rPrevSquared + gamma * leverageTerm + beta * sigma2;
      sigma2 = Math.max(sigma2, 1e-8);
      conditionalVol.push(Math.sqrt(sigma2));
    }
    return {
      type: 'gjr',
      params: { omega, alpha, gamma, beta },
      finalVariance: sigma2,
      lastReturn: returnsPct[returnsPct.length - 1],
      conditionalVolatility: conditionalVol,
    };
  } else { // egarch
    const { omega = -0.1, alpha = 0.1, gamma = 0.1, beta = 0.9 } = params;
    let lnSigma2 = Math.log(initializeVariance(returnsPct));
    for (let i = 1; i < returnsPct.length; i++) {
      const rPrev = returnsPct[i - 1];
      const sigmaPrev = Math.exp(lnSigma2 / 2);
      const epsilonPrev = rPrev / sigmaPrev;
      const absEpsilonPrev = Math.abs(epsilonPrev);
      lnSigma2 = omega + alpha * epsilonPrev + gamma * (absEpsilonPrev - Math.sqrt(2 / Math.PI)) + beta * lnSigma2;
      sigma2 = Math.exp(lnSigma2);
      conditionalVol.push(Math.sqrt(sigma2));
    }
    return {
      type: 'egarch',
      params: { omega, alpha, gamma, beta },
      finalVariance: sigma2,
      lastReturn: returnsPct[returnsPct.length - 1],
      conditionalVolatility: conditionalVol,
    };
  }
}

/**
 * Fit GARCH(1,1) model and return fitted model for forecasting
 * 
 * Returns model with fitted parameters and conditional volatility series
 * Works with returns in percentage units (multiplied by 100) like Python arch library
 */
function fitGarchModel(
  returnsPct: number[],
  modelType: 'garch' | 'gjr' | 'egarch',
  useCalibration: boolean = true
): FittedGarchModel {
  if (returnsPct.length < 120) {
    // Not enough data, use default parameters
    // Parameters are for percentage returns (returns * 100)
    let sigma2 = initializeVariance(returnsPct);
    const conditionalVol: number[] = [];
    
    // Run recurrence to get conditional volatility based on model type
    if (modelType === 'garch') {
      const params = { alpha0: 1e-4, alpha1: 0.10, beta1: 0.85 }; // alpha0 scaled for percentage returns
      for (let i = 1; i < returnsPct.length; i++) {
        const rPrevSquared = returnsPct[i - 1] ** 2;
        sigma2 = params.alpha0 + params.alpha1 * rPrevSquared + params.beta1 * sigma2;
        sigma2 = Math.max(sigma2, 1e-8);
        conditionalVol.push(Math.sqrt(sigma2));
      }
      return {
        type: 'garch',
        params: { alpha0: params.alpha0, alpha1: params.alpha1, beta1: params.beta1 },
        finalVariance: sigma2,
        lastReturn: returnsPct[returnsPct.length - 1],
        conditionalVolatility: conditionalVol,
      };
    } else if (modelType === 'gjr') {
      const params = { omega: 1e-4, alpha: 0.05, gamma: 0.05, beta: 0.9 }; // omega scaled for percentage returns
      for (let i = 1; i < returnsPct.length; i++) {
        const rPrev = returnsPct[i - 1];
        const rPrevSquared = rPrev ** 2;
        const leverageTerm = rPrev < 0 ? rPrevSquared : 0;
        sigma2 = params.omega + params.alpha * rPrevSquared + params.gamma * leverageTerm + params.beta * sigma2;
        sigma2 = Math.max(sigma2, 1e-8);
        conditionalVol.push(Math.sqrt(sigma2));
      }
      return {
        type: 'gjr',
        params: { omega: params.omega, alpha: params.alpha, gamma: params.gamma, beta: params.beta },
        finalVariance: sigma2,
        lastReturn: returnsPct[returnsPct.length - 1],
        conditionalVolatility: conditionalVol,
      };
    } else { // egarch
      const params = { omega: -0.1, alpha: 0.1, gamma: 0.1, beta: 0.9 }; // omega for EGARCH is in log space, no scaling needed
      let lnSigma2 = Math.log(initializeVariance(returnsPct));
      for (let i = 1; i < returnsPct.length; i++) {
        const rPrev = returnsPct[i - 1];
        const sigmaPrev = Math.exp(lnSigma2 / 2);
        const epsilonPrev = rPrev / sigmaPrev;
        const absEpsilonPrev = Math.abs(epsilonPrev);
        lnSigma2 = params.omega + params.alpha * epsilonPrev + params.gamma * (absEpsilonPrev - Math.sqrt(2 / Math.PI)) + params.beta * lnSigma2;
        sigma2 = Math.exp(lnSigma2);
        conditionalVol.push(Math.sqrt(sigma2));
      }
      return {
        type: 'egarch',
        params: { omega: params.omega, alpha: params.alpha, gamma: params.gamma, beta: params.beta },
        finalVariance: sigma2,
        lastReturn: returnsPct[returnsPct.length - 1],
        conditionalVolatility: conditionalVol,
      };
    }
  }
  
  // Fit model with calibration
  if (useCalibration && modelType === 'garch') {
    try {
      // Calibrate with bounds adjusted for percentage returns
      // When returns are in percentage (e.g., 1.0 for 1%), variance is squared, so alpha0 needs to be scaled
      // For percentage returns, typical alpha0 is 1e-4 to 1e0 (instead of 1e-8 to 1e-4 for decimal)
      const fittedParams = calibrateGarch11(returnsPct, {
        alpha0: [1e-4, 1e0] as [number, number], // Scaled by 10000 for percentage returns
        alpha1: [0.01, 0.3] as [number, number],
        beta1: [0.5, 0.95] as [number, number],
      });
      let sigma2 = initializeVariance(returnsPct);
      const conditionalVol: number[] = [];
      
      for (let i = 1; i < returnsPct.length; i++) {
        const rPrevSquared = returnsPct[i - 1] ** 2;
        sigma2 = fittedParams.alpha0 + fittedParams.alpha1 * rPrevSquared + fittedParams.beta1 * sigma2;
        sigma2 = Math.max(sigma2, 1e-8);
        conditionalVol.push(Math.sqrt(sigma2));
      }
      
      return {
        type: 'garch',
        params: fittedParams,
        finalVariance: sigma2,
        lastReturn: returnsPct[returnsPct.length - 1],
        conditionalVolatility: conditionalVol,
      };
    } catch (e) {
      // Fallback to default parameters
    }
  }
  
  // Default parameter fitting (can be enhanced with calibration for GJR and EGARCH)
  // Parameters are for percentage returns (returns * 100)
  // For percentage returns, alpha0/omega needs to be scaled by ~10000 compared to decimal returns
  let sigma2 = initializeVariance(returnsPct);
  const conditionalVol: number[] = [];
  
  if (modelType === 'garch') {
    const params = { alpha0: 1e-4, alpha1: 0.10, beta1: 0.85 }; // alpha0 scaled for percentage returns
    for (let i = 1; i < returnsPct.length; i++) {
      const rPrevSquared = returnsPct[i - 1] ** 2;
      sigma2 = params.alpha0 + params.alpha1 * rPrevSquared + params.beta1 * sigma2;
      sigma2 = Math.max(sigma2, 1e-8);
      conditionalVol.push(Math.sqrt(sigma2));
    }
    return {
      type: 'garch',
      params: { alpha0: params.alpha0, alpha1: params.alpha1, beta1: params.beta1 },
      finalVariance: sigma2,
      lastReturn: returnsPct[returnsPct.length - 1],
      conditionalVolatility: conditionalVol,
    };
  } else if (modelType === 'gjr') {
    const params = { omega: 1e-4, alpha: 0.05, gamma: 0.05, beta: 0.9 }; // omega scaled for percentage returns
    for (let i = 1; i < returnsPct.length; i++) {
      const rPrev = returnsPct[i - 1];
      const rPrevSquared = rPrev ** 2;
      const leverageTerm = rPrev < 0 ? rPrevSquared : 0;
      sigma2 = params.omega + params.alpha * rPrevSquared + params.gamma * leverageTerm + params.beta * sigma2;
      sigma2 = Math.max(sigma2, 1e-8);
      conditionalVol.push(Math.sqrt(sigma2));
    }
    return {
      type: 'gjr',
      params: { omega: params.omega, alpha: params.alpha, gamma: params.gamma, beta: params.beta },
      finalVariance: sigma2,
      lastReturn: returnsPct[returnsPct.length - 1],
      conditionalVolatility: conditionalVol,
    };
  } else { // egarch
    const params = { omega: -0.1, alpha: 0.1, gamma: 0.1, beta: 0.9 }; // omega for EGARCH is in log space, no scaling needed
    let lnSigma2 = Math.log(initializeVariance(returnsPct));
    for (let i = 1; i < returnsPct.length; i++) {
      const rPrev = returnsPct[i - 1];
      const sigmaPrev = Math.exp(lnSigma2 / 2);
      const epsilonPrev = rPrev / sigmaPrev;
      const absEpsilonPrev = Math.abs(epsilonPrev);
      lnSigma2 = params.omega + params.alpha * epsilonPrev + params.gamma * (absEpsilonPrev - Math.sqrt(2 / Math.PI)) + params.beta * lnSigma2;
      sigma2 = Math.exp(lnSigma2);
      conditionalVol.push(Math.sqrt(sigma2));
    }
    return {
      type: 'egarch',
      params: { omega: params.omega, alpha: params.alpha, gamma: params.gamma, beta: params.beta },
      finalVariance: sigma2,
      lastReturn: returnsPct[returnsPct.length - 1],
      conditionalVolatility: conditionalVol,
    };
  }
}

/**
 * Forecast volatility h days ahead for GARCH(1,1) model
 * 
 * Uses analytic forecast: sigma^2_{t+h} = alpha0/(1-alpha1-beta1) + (alpha1+beta1)^(h-1) * (sigma^2_{t+1} - alpha0/(1-alpha1-beta1))
 */
function forecastGarch(
  model: FittedGarchModel,
  horizon: number
): number[] {
  // Parameters should already be set from fitted model (for percentage returns)
  // Defaults here are fallbacks and should match percentage return defaults
  const { alpha0 = 1e-4, alpha1 = 0.10, beta1 = 0.85 } = model.params;
  const sigma2_t = model.finalVariance;
  const r_t = model.lastReturn;
  
  // One-step ahead forecast
  const sigma2_t1 = alpha0 + alpha1 * (r_t ** 2) + beta1 * sigma2_t;
  
  // Long-run variance
  const longRunVar = alpha0 / (1 - alpha1 - beta1);
  
  // Multi-step ahead forecast
  const forecasts: number[] = [];
  forecasts.push(Math.sqrt(sigma2_t1)); // h=1
  
  for (let h = 2; h <= horizon; h++) {
    // sigma^2_{t+h} = longRunVar + (alpha1+beta1)^(h-1) * (sigma^2_{t+1} - longRunVar)
    const sigma2_th = longRunVar + Math.pow(alpha1 + beta1, h - 1) * (sigma2_t1 - longRunVar);
    forecasts.push(Math.sqrt(Math.max(sigma2_th, 1e-8)));
  }
  
  return forecasts;
}

/**
 * Forecast volatility h days ahead for GJR-GARCH(1,1) model
 * 
 * Uses similar approach to GARCH but accounts for leverage effect
 */
function forecastGjr(
  model: FittedGarchModel,
  horizon: number
): number[] {
  // Parameters should already be set from fitted model (for percentage returns)
  // Defaults here are fallbacks and should match percentage return defaults
  const { omega = 1e-4, alpha = 0.05, gamma = 0.05, beta = 0.9 } = model.params;
  const sigma2_t = model.finalVariance;
  const r_t = model.lastReturn;
  
  // One-step ahead forecast (assume no leverage for forecast)
  const r_t_squared = r_t ** 2;
  const leverageTerm = r_t < 0 ? r_t_squared : 0;
  const sigma2_t1 = omega + alpha * r_t_squared + gamma * leverageTerm + beta * sigma2_t;
  
  // Long-run variance approximation (using average leverage)
  // For forecasting, we approximate with (alpha + gamma/2 + beta) term
  const avgLeverage = 0.5; // Approximate 50% negative returns
  const effectiveAlpha = alpha + gamma * avgLeverage;
  const persistence = effectiveAlpha + beta;
  const longRunVar = omega / (1 - persistence);
  
  // Multi-step ahead forecast
  const forecasts: number[] = [];
  forecasts.push(Math.sqrt(sigma2_t1)); // h=1
  
  for (let h = 2; h <= horizon; h++) {
    const sigma2_th = longRunVar + Math.pow(persistence, h - 1) * (sigma2_t1 - longRunVar);
    forecasts.push(Math.sqrt(Math.max(sigma2_th, 1e-8)));
  }
  
  return forecasts;
}

/**
 * Forecast volatility h days ahead for EGARCH(1,1) model
 * 
 * Uses analytic approximation (Python script uses simulation for h>1, but analytic is faster)
 */
function forecastEgarch(
  model: FittedGarchModel,
  horizon: number
): number[] {
  const { omega = -0.1, alpha = 0.1, gamma = 0.1, beta = 0.9 } = model.params;
  
  // Validate inputs to prevent Infinity
  if (!isFinite(model.finalVariance) || model.finalVariance <= 0) {
    console.error(`[GARCH-DEBUG] EGARCH: Invalid finalVariance: ${model.finalVariance}`);
    // Fallback: use a reasonable default variance
    const defaultVar = 100; // 10% volatility squared in percentage units
    model.finalVariance = defaultVar;
  }
  
  if (!isFinite(model.lastReturn)) {
    console.error(`[GARCH-DEBUG] EGARCH: Invalid lastReturn: ${model.lastReturn}`);
    model.lastReturn = 0;
  }
  
  const lnSigma2_t = Math.log(Math.max(model.finalVariance, 1e-8));
  const r_t = model.lastReturn;
  const sigma_t = Math.sqrt(Math.max(model.finalVariance, 1e-8));
  const epsilon_t = sigma_t > 1e-6 ? r_t / sigma_t : 0;
  const absEpsilon_t = Math.abs(epsilon_t);
  
  // One-step ahead forecast
  const lnSigma2_t1 = omega + alpha * epsilon_t + gamma * (absEpsilon_t - Math.sqrt(2 / Math.PI)) + beta * lnSigma2_t;
  
  // Prevent Infinity from exp(lnSigma2_t1)
  const lnSigma2_t1_clamped = Math.max(-50, Math.min(50, lnSigma2_t1));
  const sigma2_t1 = Math.exp(lnSigma2_t1_clamped);
  
  // Long-run log variance
  // E[ln(sigma^2)] = omega / (1 - beta) for symmetric case
  // But prevent division by zero or Infinity
  const betaClamped = Math.max(0.01, Math.min(0.999, beta));
  const longRunLnVar = omega / (1 - betaClamped);
  const longRunLnVar_clamped = Math.max(-50, Math.min(50, longRunLnVar));
  
  // Multi-step ahead forecast
  const forecasts: number[] = [];
  const sigma1 = Math.sqrt(Math.max(sigma2_t1, 1e-8));
  forecasts.push(sigma1); // h=1
  
  for (let h = 2; h <= horizon; h++) {
    // For h>1, use long-run variance with decay
    const lnSigma2_th = longRunLnVar_clamped + Math.pow(betaClamped, h - 1) * (lnSigma2_t1_clamped - longRunLnVar_clamped);
    const lnSigma2_th_clamped = Math.max(-50, Math.min(50, lnSigma2_th));
    const sigma2_th = Math.exp(lnSigma2_th_clamped);
    forecasts.push(Math.sqrt(Math.max(sigma2_th, 1e-8)));
  }
  
  // Validate forecasts - if any are Infinity or NaN, replace with historical average
  const validForecasts = forecasts.filter(f => isFinite(f) && f > 0);
  if (validForecasts.length === 0 || validForecasts.length < forecasts.length) {
    console.warn(`[GARCH-DEBUG] EGARCH: Some forecasts were invalid, using fallback`);
    const fallback = Math.sqrt(Math.max(model.finalVariance, 1e-8));
    return Array(horizon).fill(fallback);
  }
  
  return forecasts;
}

/**
 * Forecast volatility h days ahead based on model type
 */
function forecastVolatility(
  model: FittedGarchModel,
  horizon: number
): number[] {
  switch (model.type) {
    case 'garch':
      return forecastGarch(model, horizon);
    case 'gjr':
      return forecastGjr(model, horizon);
    case 'egarch':
      return forecastEgarch(model, horizon);
    default:
      throw new Error(`Unknown model type: ${model.type}`);
  }
}

/**
 * Calculate volatility using all three models and average the results
 * 
 * This function matches the Python script behavior:
 * 1. Fits GARCH, GJR, and EGARCH models
 * 2. Forecasts volatility h days ahead (default 5 days)
 * 3. Averages the forecasted sigmas over h days for each model
 * 4. Averages the three model averages to get final result
 */
export function calculateAverageVolatility(
  prices: number[],
  opts: {
    clampPct?: [number, number];
    symbol?: string;
    timeframe?: string;
    day?: string;
    horizon?: number; // Forecast horizon in days (default: 5)
  } = {}
): VolatilityModelsResult {
  const { clampPct = [1, 10], symbol, timeframe, day, horizon = 5 } = opts;

  // Validate input
  if (!Array.isArray(prices) || prices.length < 2) {
    const defaultResult: Garch11Result = { vol: 0.02, var: 0.0004, kPct: clampPct[0] / 100 };
    return {
      garch11: defaultResult,
      egarch11: defaultResult,
      gjrgarch11: defaultResult,
      averaged: defaultResult,
    };
  }

  // Filter out invalid prices
  const validPrices = prices.filter(p => p > 0 && isFinite(p));
  if (validPrices.length < 2) {
    const defaultResult: Garch11Result = { vol: 0.02, var: 0.0004, kPct: clampPct[0] / 100 };
    return {
      garch11: defaultResult,
      egarch11: defaultResult,
      gjrgarch11: defaultResult,
      averaged: defaultResult,
    };
  }

  // Calculate log returns (in decimal units)
  const returns = logReturns(validPrices);
  
  if (returns.length === 0 || returns.length < 120) {
    // Not enough data, use simple calculation
    const garch11 = garch11FromReturns(returns, { clampPct });
    const egarch11 = egarch11FromReturns(returns, { clampPct });
    const gjrgarch11 = gjrgarch11FromReturns(returns, { clampPct });
    const avgKPct = (garch11.kPct + egarch11.kPct + gjrgarch11.kPct) / 3;
    const averaged: Garch11Result = {
      vol: Math.sqrt(garch11.var),
      var: garch11.var,
      kPct: avgKPct,
    };
    return { garch11, egarch11, gjrgarch11, averaged };
  }

  // Convert returns to percentage units (like Python script: r_pct = r * 100.0)
  const returnsPct = returns.map(r => r * 100.0);

  // Fit models
  // Note: Python arch library fits all models with MLE. We calibrate GARCH, but use defaults for GJR/EGARCH
  // This might cause differences, but calibration for all three would be computationally expensive
  // For better accuracy, we could derive GJR/EGARCH parameters from GARCH parameters
  const garchModel = fitGarchModel(returnsPct, 'garch', true);
  
  // Use GARCH parameters as basis for GJR and EGARCH (adjust for leverage effects)
  // This is a heuristic - proper MLE would be better but computationally expensive
  const { alpha0 = 1e-4, alpha1 = 0.10, beta1 = 0.85 } = garchModel.params;
  
  // Debug: Log fitted GARCH parameters
  if (symbol && timeframe) {
    console.log(`🔧 [GARCH-DEBUG] ${symbol} ${timeframe} - Fitted GARCH parameters:`);
    console.log(`  alpha0: ${alpha0.toFixed(8)}, alpha1: ${alpha1.toFixed(4)}, beta1: ${beta1.toFixed(4)}`);
  }
  
  // Estimate GJR parameters from GARCH (split alpha into alpha + gamma)
  // For GJR, we typically have alpha (symmetric) + gamma (asymmetric), so split alpha1
  // But keep more of the original alpha1 for symmetric part, less for asymmetric
  const gjrAlpha = alpha1 * 0.6; // More weight to symmetric part
  const gjrGamma = alpha1 * 0.4; // Asymmetric leverage term
  const gjrOmega = alpha0; // Same long-term variance
  
  // Estimate EGARCH parameters from GARCH (approximate conversion)
  // EGARCH omega in log space: omega ≈ log(alpha0) - mean adjustment
  // For percentage returns, typical EGARCH omega is around -0.5 to -2.0
  // Scale based on the magnitude of alpha0
  const egarchOmega = Math.log(Math.max(alpha0, 1e-6)) - 1.5; // Adjusted conversion
  const egarchAlpha = alpha1 * 0.6; // Asymmetric response (slightly higher)
  const egarchGamma = alpha1 * 0.4; // Symmetric response
  
  // Create models with estimated parameters
  const gjrModel = fitGarchModelWithParams(returnsPct, 'gjr', { 
    omega: gjrOmega, 
    alpha: gjrAlpha, 
    gamma: gjrGamma, 
    beta: beta1 
  });
  const egarchModel = fitGarchModelWithParams(returnsPct, 'egarch', { 
    omega: egarchOmega, 
    alpha: egarchAlpha, 
    gamma: egarchGamma, 
    beta: beta1 
  });

  // Calculate historical std dev for comparison (like Python script)
  // Python uses ddof=1 (Bessel's correction): std = sqrt(sum((r - mean)^2) / (n - 1))
  const returnsMean = returnsPct.reduce((a, b) => a + b, 0) / returnsPct.length;
  const returnsVariance = returnsPct.reduce((sum, r) => sum + Math.pow(r - returnsMean, 2), 0) / (returnsPct.length - 1);
  const returnsStdDevPct = Math.sqrt(returnsVariance);
  
  // Debug: Log sample returns to verify they look correct
  if (symbol && timeframe) {
    const sampleReturns = returnsPct.slice(0, 10);
    const sampleReturnsDecimal = returnsPct.slice(0, 10).map(r => r / 100.0);
    console.log(`[GARCH-DEBUG] ${symbol} ${timeframe} - Sample returns (first 10, in percentage units):`);
    console.log(`  Percentage: ${sampleReturns.map(r => r.toFixed(4)).join(', ')}%`);
    console.log(`  Decimal: ${sampleReturnsDecimal.map(r => r.toFixed(6)).join(', ')}`);
    console.log(`  Returns count: ${returnsPct.length}, Mean: ${returnsMean.toFixed(4)}%, Std Dev: ${returnsStdDevPct.toFixed(4)}%`);
    console.log(`  Expected std dev for BTC daily returns: ~2.4%. If much higher, data might be wrong timeframe.`);
  }

  // Forecast h days ahead for each model
  let garchForecasts: number[] = [];
  let gjrForecasts: number[] = [];
  let egarchForecasts: number[] = [];
  
  try {
    garchForecasts = forecastVolatility(garchModel, horizon);
  } catch (error) {
    console.error(`[GARCH-DEBUG] Error forecasting GARCH:`, error);
    garchForecasts = [returnsStdDevPct]; // Fallback to historical std dev
  }
  
  try {
    gjrForecasts = forecastVolatility(gjrModel, horizon);
  } catch (error) {
    console.error(`[GARCH-DEBUG] Error forecasting GJR:`, error);
    gjrForecasts = [returnsStdDevPct]; // Fallback to historical std dev
  }
  
  try {
    egarchForecasts = forecastVolatility(egarchModel, horizon);
  } catch (error) {
    console.error(`[GARCH-DEBUG] Error forecasting EGARCH:`, error);
    egarchForecasts = [returnsStdDevPct]; // Fallback to historical std dev
  }
  
  // Validate forecasts
  if (!garchForecasts || garchForecasts.length === 0) {
    console.warn(`[GARCH-DEBUG] GARCH forecasts empty, using historical std dev`);
    garchForecasts = [returnsStdDevPct];
  }
  if (!gjrForecasts || gjrForecasts.length === 0) {
    console.warn(`[GARCH-DEBUG] GJR forecasts empty, using historical std dev`);
    gjrForecasts = [returnsStdDevPct];
  }
  if (!egarchForecasts || egarchForecasts.length === 0) {
    console.warn(`[GARCH-DEBUG] EGARCH forecasts empty, using historical std dev`);
    egarchForecasts = [returnsStdDevPct];
  }

  // Average the forecasted sigmas over h days for each model (in percentage units)
  // These are already in percentage units (e.g., 2.5 means 2.5%)
  // Filter out Infinity and NaN values
  const validGarchForecasts = garchForecasts.filter(f => isFinite(f) && f > 0);
  const validGjrForecasts = gjrForecasts.filter(f => isFinite(f) && f > 0);
  const validEgarchForecasts = egarchForecasts.filter(f => isFinite(f) && f > 0);
  
  const promGarch = validGarchForecasts.length > 0 
    ? validGarchForecasts.reduce((a, b) => a + b, 0) / validGarchForecasts.length
    : returnsStdDevPct; // Fallback to historical std dev
  
  const promGjr = validGjrForecasts.length > 0
    ? validGjrForecasts.reduce((a, b) => a + b, 0) / validGjrForecasts.length
    : returnsStdDevPct; // Fallback to historical std dev
  
  const promEgarch = validEgarchForecasts.length > 0
    ? validEgarchForecasts.reduce((a, b) => a + b, 0) / validEgarchForecasts.length
    : returnsStdDevPct; // Fallback to historical std dev

  // Debug logging - print prominently to console
  if (symbol && timeframe) {
    console.log('\n' + '='.repeat(80));
    console.log(`🔍 [GARCH-DEBUG] ${symbol} ${timeframe}`);
    console.log('='.repeat(80));
    console.log(`  Historical std dev: ${returnsStdDevPct.toFixed(4)}%`);
    console.log(`  GARCH forecasts (h=${horizon}):`, garchForecasts.map(f => f.toFixed(4)).join(', '), '%');
    console.log(`  GJR forecasts (h=${horizon}):`, gjrForecasts.map(f => f.toFixed(4)).join(', '), '%');
    console.log(`  EGARCH forecasts (h=${horizon}):`, egarchForecasts.map(f => f.toFixed(4)).join(', '), '%');
    console.log(`  📊 Prom GARCH: ${promGarch.toFixed(4)}%`);
    console.log(`  📊 Prom GJR: ${promGjr.toFixed(4)}%`);
    console.log(`  📊 Prom EGARCH: ${promEgarch.toFixed(4)}%`);
    console.log(`  ⭐ Prom Global (avg of three): ${((promGarch + promGjr + promEgarch) / 3).toFixed(4)}%`);
    console.log('='.repeat(80) + '\n');
  }

  // Average the three model averages (prom_global in Python script)
  // DO NOT clamp individual models before averaging - this matches Python script
  const promGlobal = (promGarch + promGjr + promEgarch) / 3;

  // Debug logging
  if (symbol && timeframe) {
    console.log(`⚙️  [GARCH-DEBUG] ${symbol} ${timeframe} - Final averaging:`);
    console.log(`  promGlobal (before conversion): ${promGlobal.toFixed(4)}%`);
  }

  // Convert from percentage units to decimal units (e.g., 2.5% -> 0.025)
  const promGlobalDecimal = promGlobal / 100.0;
  
  // Apply clamping to final result only (not to individual models)
  // Clamp to reasonable bounds but don't cap too aggressively
  const promGlobalCapped = Math.min(promGlobalDecimal, 0.15); // Allow up to 15% daily volatility
  const kPctPercent = Math.max(clampPct[0], Math.min(clampPct[1], promGlobalCapped * 100));
  const kPct = kPctPercent / 100; // Convert to decimal form (0.01-0.10)

  // Debug logging
  if (symbol && timeframe) {
    console.log(`✅ [GARCH-DEBUG] ${symbol} ${timeframe} - After conversion and clamping:`);
    console.log(`  promGlobalDecimal: ${promGlobalDecimal.toFixed(6)}`);
    console.log(`  promGlobalCapped: ${promGlobalCapped.toFixed(6)}`);
    console.log(`  kPctPercent: ${kPctPercent.toFixed(4)}%`);
    console.log(`  🎯 Final kPct (decimal): ${kPct.toFixed(6)} (${(kPct * 100).toFixed(4)}%)`);
  }

  // Calculate individual model results for reporting (convert to decimal, don't clamp aggressively)
  const garchVolDecimal = promGarch / 100.0;
  const gjrVolDecimal = promGjr / 100.0;
  const egarchVolDecimal = promEgarch / 100.0;

  // For individual models, clamp for display but keep reasonable values
  const garchKPct = Math.max(clampPct[0] / 100, Math.min(0.15, garchVolDecimal));
  const gjrKPct = Math.max(clampPct[0] / 100, Math.min(0.15, gjrVolDecimal));
  const egarchKPct = Math.max(clampPct[0] / 100, Math.min(0.15, egarchVolDecimal));

  const garch11: Garch11Result = {
    vol: garchVolDecimal,
    var: garchVolDecimal ** 2,
    kPct: garchKPct,
  };

  const gjrgarch11: Garch11Result = {
    vol: gjrVolDecimal,
    var: gjrVolDecimal ** 2,
    kPct: gjrKPct,
  };

  const egarch11: Garch11Result = {
    vol: egarchVolDecimal,
    var: egarchVolDecimal ** 2,
    kPct: egarchKPct,
  };

  const averaged: Garch11Result = {
    vol: promGlobalCapped,
    var: promGlobalCapped ** 2,
    kPct: kPct,
  };

  const result: VolatilityModelsResult = {
    garch11,
    egarch11,
    gjrgarch11,
    averaged,
  };

  // Include debug info if symbol and timeframe are provided (for troubleshooting)
  if (symbol && timeframe) {
    result.debugInfo = {
      historicalStdDev: returnsStdDevPct,
      garchForecasts: garchForecasts.slice(),
      gjrForecasts: gjrForecasts.slice(),
      egarchForecasts: egarchForecasts.slice(),
      promGarch,
      promGjr,
      promEgarch,
      promGlobal,
    };
  }

  return result;
}

/**
 * Legacy function name - maps to estimateKPercent for API compatibility
 * Takes price array (closes) and returns kPct as decimal (0.01-0.10)
 * @deprecated Use estimateKPercent instead
 */
export function garch11(closes: number[], multiplier: number = 1.0): number {
  // Validate multiplier to prevent extreme values
  const safeMultiplier = Math.max(0.1, Math.min(10, multiplier)); // Clamp multiplier between 0.1 and 10

  const kPct = estimateKPercent(closes, { clampPct: [1, 10] });

  // kPct is in decimal form (0.01-0.10), convert to percentage, apply multiplier, then convert back
  const kPctPercent = kPct * 100; // Convert to percentage
  const resultPercent = kPctPercent * safeMultiplier;

  // Final clamp to prevent values > 20% (0.20 decimal), then convert back to decimal
  const finalResultPercent = Math.max(1, Math.min(20, resultPercent));
  return finalResultPercent / 100; // Convert back to decimal form
}
