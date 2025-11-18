'use client';

import { useEffect, useState } from 'react';

interface RealTimeIndicatorProps {
  lastUpdateTime: number | null;
  label?: string;
  showAge?: boolean;
  className?: string;
}

/**
 * Compact real-time data freshness indicator
 * Perfect for showing live price updates, order book freshness, etc.
 */
export default function RealTimeIndicator({
  lastUpdateTime,
  label,
  showAge = true,
  className = '',
}: RealTimeIndicatorProps) {
  const [age, setAge] = useState<number>(0);

  useEffect(() => {
    if (!lastUpdateTime) return;

    const interval = setInterval(() => {
      setAge(Date.now() - lastUpdateTime);
    }, 100);

    return () => clearInterval(interval);
  }, [lastUpdateTime]);

  const getStatus = () => {
    if (!lastUpdateTime || age > 5000) {
      return { color: 'text-red-400', icon: '○', desc: 'Stale' };
    }
    if (age > 2000) {
      return { color: 'text-yellow-400', icon: '◐', desc: 'Slow' };
    }
    return { color: 'text-green-400', icon: '●', desc: 'Live' };
  };

  const status = getStatus();
  const ageText = age < 1000 ? 'now' : `${(age / 1000).toFixed(1)}s`;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`${status.color} text-xs font-bold animate-pulse`}>{status.icon}</span>
      {label && <span className="text-gray-400 text-xs">{label}:</span>}
      {showAge && (
        <span className={`${status.color} text-xs font-medium`}>
          {ageText}
        </span>
      )}
    </div>
  );
}
