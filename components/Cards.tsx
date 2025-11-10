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

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Price</div>
        <div className="text-2xl font-bold text-white">{formatPrice(price)}</div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">GARCH %</div>
        <div className="text-2xl font-bold text-blue-400">{formatPct(garchPct)}</div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">VWAP</div>
        <div className="text-2xl font-bold text-green-400">{formatPrice(vwap)}</div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Daily Open</div>
        <div className="text-2xl font-bold text-yellow-400">{formatPrice(dOpen)}</div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Upper</div>
        <div className="text-2xl font-bold text-teal-400">{formatPrice(upper)}</div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Lower</div>
        <div className="text-2xl font-bold text-orange-400">{formatPrice(lower)}</div>
      </div>
    </div>
  );
}
