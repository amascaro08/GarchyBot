'use client';

import { ReactNode } from 'react';

interface StatusBadgeProps {
  children: ReactNode;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

export default function StatusBadge({
  children,
  variant = 'neutral',
  dot = false,
  pulse = false,
  className = '',
}: StatusBadgeProps) {
  const getVariantClass = () => {
    switch (variant) {
      case 'success':
        return 'badge-success';
      case 'warning':
        return 'badge-warning';
      case 'danger':
        return 'badge-danger';
      case 'info':
        return 'badge-info';
      default:
        return 'badge-neutral';
    }
  };

  const getDotColor = () => {
    switch (variant) {
      case 'success':
        return 'bg-emerald-400';
      case 'warning':
        return 'bg-amber-400';
      case 'danger':
        return 'bg-red-400';
      case 'info':
        return 'bg-blue-400';
      default:
        return 'bg-slate-400';
    }
  };

  return (
    <span className={`badge ${getVariantClass()} ${className}`}>
      {dot && (
        <span className="relative flex h-2 w-2">
          <span className={`${pulse ? 'animate-ping' : ''} absolute inline-flex h-full w-full rounded-full ${getDotColor()} opacity-75`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${getDotColor()}`}></span>
        </span>
      )}
      {children}
    </span>
  );
}
