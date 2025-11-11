'use client';

import { formatCurrency } from '@/lib/format';

interface CardsProps {
  price: number | null;
  garchPct: number | null;
  vwap: number | null;
  dOpen: number | null;
  upper: number | null;
  lower: number | null;
}

export default function Cards({ price, garchPct, vwap, dOpen, upper, lower }: CardsProps) {
  // Format percentage
  const formatPct = (val: number | null) => (val !== null ? `${(val * 100).toFixed(2)}%` : '—');

  const getPriceChange = () => {
    if (!price || !dOpen) return null;
    const change = ((price - dOpen) / dOpen) * 100;
    return { value: change, isPositive: change >= 0 };
  };

  const priceChange = getPriceChange();

  const cardData = [
    {
      label: 'Price',
      value: formatCurrency(price),
      subtitle: priceChange ? `${priceChange.isPositive ? '+' : ''}${priceChange.value.toFixed(2)}%` : null,
      color: priceChange ? (priceChange.isPositive ? 'text-green-400' : 'text-red-400') : 'text-white',
      bgGradient: 'from-blue-500/20 to-blue-600/20',
      borderColor: 'border-blue-500/30',
      icon: '💰'
    },
    {
      label: 'Volatility',
      value: formatPct(garchPct),
      subtitle: 'GARCH(1,1)',
      color: 'text-blue-400',
      bgGradient: 'from-purple-500/20 to-purple-600/20',
      borderColor: 'border-purple-500/30',
      icon: '📊'
    },
    {
      label: 'VWAP',
      value: formatCurrency(vwap),
      subtitle: 'Volume Weighted',
      color: 'text-green-400',
      bgGradient: 'from-green-500/20 to-green-600/20',
      borderColor: 'border-green-500/30',
      icon: '📈'
    },
    {
      label: 'Daily Open',
      value: formatCurrency(dOpen),
      subtitle: 'UTC 00:00',
      color: 'text-yellow-400',
      bgGradient: 'from-yellow-500/20 to-yellow-600/20',
      borderColor: 'border-yellow-500/30',
      icon: '🌅'
    },
    {
      label: 'Upper Range',
      value: formatCurrency(upper),
      subtitle: 'Resistance',
      color: 'text-teal-400',
      bgGradient: 'from-teal-500/20 to-teal-600/20',
      borderColor: 'border-teal-500/30',
      icon: '📈'
    },
    {
      label: 'Lower Range',
      value: formatCurrency(lower),
      subtitle: 'Support',
      color: 'text-orange-400',
      bgGradient: 'from-orange-500/20 to-orange-600/20',
      borderColor: 'border-orange-500/30',
      icon: '📉'
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-6">
      {cardData.map((card, idx) => (
        <div
          key={idx}
          className={`glass-effect rounded-xl p-5 border ${card.borderColor} bg-gradient-to-br ${card.bgGradient} card-hover shadow-lg hover:shadow-xl transition-all duration-300 relative overflow-hidden`}
        >
          {/* Icon background */}
          <div className="absolute top-2 right-2 text-2xl opacity-20">
            {card.icon}
          </div>

          <div className="text-gray-400 text-xs sm:text-sm mb-1 font-medium uppercase tracking-wide">
            {card.label}
          </div>

          <div className={`text-2xl sm:text-3xl font-bold ${card.color} transition-all duration-300 mb-1`}>
            {card.value}
          </div>

          {card.subtitle && (
            <div className="text-xs text-gray-400 font-medium">
              {card.subtitle}
            </div>
          )}

          {/* Progress indicator for volatility */}
          {card.label === 'Volatility' && garchPct && (
            <div className="mt-3">
              <div className="w-full bg-gray-700/50 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-purple-500 to-purple-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (garchPct * 100) * 10)}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Price change indicator */}
          {card.label === 'Price' && priceChange && (
            <div className={`mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
              priceChange.isPositive
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              <svg className={`w-3 h-3 ${priceChange.isPositive ? 'rotate-0' : 'rotate-180'}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.293l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13a1 1 0 102 0V9.414l1.293 1.293a1 1 0 001.414-1.414z" clipRule="evenodd" />
              </svg>
              {priceChange.isPositive ? '+' : ''}{priceChange.value.toFixed(2)}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
