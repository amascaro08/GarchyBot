'use client';

import { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: {
    value: number;
    label: string;
  };
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

export default function MetricCard({
  label,
  value,
  change,
  icon,
  trend = 'neutral',
  className = '',
}: MetricCardProps) {
  const getTrendColor = () => {
    if (trend === 'up') return 'text-emerald-400';
    if (trend === 'down') return 'text-red-400';
    return 'text-slate-400';
  };

  const getTrendIcon = () => {
    if (trend === 'up') return '↑';
    if (trend === 'down') return '↓';
    return '•';
  };

  return (
    <div className={`stat-card group ${className}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="stat-label flex items-center gap-2">
          {icon && <span className="text-slate-500">{icon}</span>}
          {label}
        </div>
        {trend !== 'neutral' && (
          <span className={`text-xl font-bold ${getTrendColor()}`}>
            {getTrendIcon()}
          </span>
        )}
      </div>
      
      <div className="stat-value mb-2 group-hover:text-indigo-400 transition-colors">
        {value}
      </div>
      
      {change && (
        <div className={`stat-change ${change.value >= 0 ? 'stat-change-positive' : 'stat-change-negative'}`}>
          {change.value >= 0 ? '+' : ''}{change.value}% {change.label}
        </div>
      )}
    </div>
  );
}
