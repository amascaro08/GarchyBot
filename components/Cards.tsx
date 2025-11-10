'use client';

interface CardsProps {
  price: number | null;
  garchPct: number | null;
  vwap: number | null;
  dOpen: number | null;
  upper: number | null;
  lower: number | null;
}

export default function Cards({ price, garchPct, vwap, dOpen, upper, lower }: CardsProps) {
  const formatPrice = (val: number | null) => (val !== null ? val.toFixed(2) : '—');
  const formatPct = (val: number | null) => (val !== null ? `${(val * 100).toFixed(2)}%` : '—');

  const cardData = [
    { label: 'Price', value: formatPrice(price), color: 'text-white', bgGradient: 'from-blue-500/20 to-blue-600/20', borderColor: 'border-blue-500/30' },
    { label: 'GARCH %', value: formatPct(garchPct), color: 'text-blue-400', bgGradient: 'from-purple-500/20 to-purple-600/20', borderColor: 'border-purple-500/30' },
    { label: 'VWAP', value: formatPrice(vwap), color: 'text-green-400', bgGradient: 'from-green-500/20 to-green-600/20', borderColor: 'border-green-500/30' },
    { label: 'Daily Open', value: formatPrice(dOpen), color: 'text-yellow-400', bgGradient: 'from-yellow-500/20 to-yellow-600/20', borderColor: 'border-yellow-500/30' },
    { label: 'Upper', value: formatPrice(upper), color: 'text-teal-400', bgGradient: 'from-teal-500/20 to-teal-600/20', borderColor: 'border-teal-500/30' },
    { label: 'Lower', value: formatPrice(lower), color: 'text-orange-400', bgGradient: 'from-orange-500/20 to-orange-600/20', borderColor: 'border-orange-500/30' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      {cardData.map((card, idx) => (
        <div
          key={idx}
          className={`glass-effect rounded-xl p-4 border ${card.borderColor} bg-gradient-to-br ${card.bgGradient} card-hover shadow-lg`}
        >
          <div className="text-gray-400 text-xs sm:text-sm mb-2 font-medium uppercase tracking-wide">
            {card.label}
          </div>
          <div className={`text-xl sm:text-2xl font-bold ${card.color} transition-all duration-200`}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}
