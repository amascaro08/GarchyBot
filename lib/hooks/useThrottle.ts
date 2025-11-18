import { useEffect, useRef, useState } from 'react';

/**
 * Throttle hook - limits how often a value can change
 * For trading: Use SHORT delays (100-300ms) to preserve real-time feel
 * while reducing unnecessary re-renders
 * 
 * @param value - Value to throttle
 * @param delay - Delay in milliseconds (default: 100ms for trading)
 */
export function useThrottle<T>(value: T, delay: number = 100): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastRan = useRef(Date.now());

  useEffect(() => {
    const handler = setTimeout(() => {
      if (Date.now() - lastRan.current >= delay) {
        setThrottledValue(value);
        lastRan.current = Date.now();
      }
    }, delay - (Date.now() - lastRan.current));

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return throttledValue;
}

/**
 * Debounce hook - waits for value to stop changing before updating
 * Use for non-critical UI updates like log scrolling
 * 
 * @param value - Value to debounce
 * @param delay - Delay in milliseconds (default: 300ms)
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
