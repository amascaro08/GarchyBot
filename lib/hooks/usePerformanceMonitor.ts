import { useEffect, useRef } from 'react';

/**
 * Performance monitoring hook for React components
 * Tracks component render time and warns if it exceeds threshold
 * Critical for trading applications where UI lag affects decision-making
 * 
 * @param componentName - Name of the component being monitored
 * @param threshold - Warning threshold in milliseconds (default: 50ms for trading UIs)
 */
export function usePerformanceMonitor(componentName: string, threshold: number = 50) {
  const renderStart = useRef<number>(performance.now());
  const renderCount = useRef<number>(0);
  const totalRenderTime = useRef<number>(0);

  useEffect(() => {
    const renderTime = performance.now() - renderStart.current;
    renderCount.current++;
    totalRenderTime.current += renderTime;

    // Warn if render time exceeds threshold (50ms default for 60fps = 16.67ms per frame)
    if (renderTime > threshold) {
      console.warn(
        `[PERFORMANCE] ${componentName} render took ${renderTime.toFixed(2)}ms (threshold: ${threshold}ms)`
      );
    }

    // Log average render time every 100 renders
    if (renderCount.current % 100 === 0) {
      const avgRenderTime = totalRenderTime.current / renderCount.current;
      console.log(
        `[PERFORMANCE] ${componentName} - Avg render: ${avgRenderTime.toFixed(2)}ms over ${renderCount.current} renders`
      );
    }

    // Reset start time for next render
    renderStart.current = performance.now();
  });

  return {
    renderCount: renderCount.current,
    avgRenderTime: totalRenderTime.current / renderCount.current,
  };
}

/**
 * Measure execution time of an async function
 * Useful for API calls, data processing, etc.
 */
export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    
    if (duration > 100) {
      console.warn(`[PERFORMANCE] ${label} took ${duration.toFixed(2)}ms`);
    } else {
      console.log(`[PERFORMANCE] ${label} took ${duration.toFixed(2)}ms`);
    }
    
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.error(`[PERFORMANCE] ${label} failed after ${duration.toFixed(2)}ms`);
    throw error;
  }
}
