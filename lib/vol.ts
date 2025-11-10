import type { Candle } from './types';

/**
 * GARCH(1,1) volatility estimator
 * Returns daily expected move as percentage (kPct), clamped between 1% and 10%
 */
export function garch11(closes: number[], multiplier: number = 1.0): number {
  if (closes.length < 30) {
    // Fallback to EWMA if insufficient data
    return ewmaVolatility(closes, multiplier);
  }

  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  // Initial variance estimate (sample variance)
  let meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  let variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;

  // GARCH(1,1) parameters (typical values)
  const alpha0 = 0.000001; // Long-term variance
  const alpha1 = 0.1; // ARCH coefficient
  const beta1 = 0.85; // GARCH coefficient

  // Iterate GARCH(1,1) update
  for (let i = 1; i < returns.length; i++) {
    const squaredReturn = Math.pow(returns[i], 2);
    variance = alpha0 + alpha1 * squaredReturn + beta1 * variance;
  }

  // Convert to daily percentage move (1 standard deviation)
  // Variance is already in daily terms (from daily returns), so just take sqrt
  const dailyVol = Math.sqrt(variance);
  const kPct = dailyVol * multiplier;

  // Clamp between 1% and 10%
  return Math.max(0.01, Math.min(0.10, kPct));
}

/**
 * EWMA (Exponentially Weighted Moving Average) volatility fallback
 * Lambda ~ 0.94 (typical for daily data)
 */
export function ewmaVolatility(closes: number[], multiplier: number = 1.0, lambda: number = 0.94): number {
  if (closes.length < 2) {
    return 0.02; // Default 2% if no data
  }

  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  // EWMA variance
  let ewmaVar = Math.pow(returns[0], 2);

  for (let i = 1; i < returns.length; i++) {
    ewmaVar = lambda * ewmaVar + (1 - lambda) * Math.pow(returns[i], 2);
  }

  // Convert to daily percentage move
  // Variance is already in daily terms (from daily returns), so just take sqrt
  const dailyVol = Math.sqrt(ewmaVar);
  const kPct = dailyVol * multiplier;

  // Clamp between 1% and 10%
  return Math.max(0.01, Math.min(0.10, kPct));
}
