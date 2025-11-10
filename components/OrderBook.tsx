'use client';

import { useEffect, useState } from 'react';
import { getOrderBookSnapshot } from '@/lib/orderbook';

interface OrderBookProps {
  symbol: string;
  currentPrice: number | null;
}

type DepthEntry = { price: number; size: number };

export default function OrderBook({ symbol, currentPrice }: OrderBookProps) {
  const [snapshot, setSnapshot] = useState<{ bids: DepthEntry[]; asks: DepthEntry[] } | null>(null);
  const [maxSize, setMaxSize] = useState<number>(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const snap = getOrderBookSnapshot(symbol);
      if (snap) {
        setSnapshot({ bids: snap.bids, asks: snap.asks });
        
        // Calculate max size for visualization
        const allSizes = [...snap.bids, ...snap.asks].map(e => e.size);
        setMaxSize(Math.max(...allSizes, 1));
      }
    }, 500); // Update every 500ms

    return () => clearInterval(interval);
  }, [symbol]);

  if (!snapshot || snapshot.bids.length === 0 || snapshot.asks.length === 0) {
    return (
      <div className="glass-effect rounded-xl p-6 border-2 border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-xl">
        <h3 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300 mb-4">
          Order Book
        </h3>
        <div className="text-center py-8 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-sm">Connecting to order book...</p>
        </div>
      </div>
    );
  }

  // Show top 10 bids and asks
  const topBids = snapshot.bids.slice(0, 10).reverse(); // Reverse to show highest first
  const topAsks = snapshot.asks.slice(0, 10);

  const formatPrice = (price: number) => {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 100) return price.toFixed(3);
    if (price >= 10) return price.toFixed(4);
    return price.toFixed(5);
  };

  const formatSize = (size: number) => {
    if (size >= 1000) return (size / 1000).toFixed(2) + 'K';
    return size.toFixed(2);
  };

  const calculateNotional = (price: number, size: number) => {
    return price * size;
  };

  return (
    <div className="glass-effect rounded-xl p-6 border-2 border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300">
          Order Book
        </h3>
        {currentPrice && (
          <div className="px-3 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
            <span className="text-xs text-cyan-300 font-medium">Price: </span>
            <span className="text-sm font-bold text-cyan-200">${formatPrice(currentPrice)}</span>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="grid grid-cols-3 gap-2 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-slate-700/50">
        <div className="text-right">Size</div>
        <div className="text-center">Price</div>
        <div>Size</div>
      </div>

      <div className="space-y-1 max-h-[400px] overflow-y-auto custom-scrollbar">
        {/* Asks (Sell orders) - Red */}
        {topAsks.map((ask, idx) => {
          const notional = calculateNotional(ask.price, ask.size);
          const widthPercent = (ask.size / maxSize) * 100;
          const isNearPrice = currentPrice && Math.abs(ask.price - currentPrice) / currentPrice < 0.001;
          
          return (
            <div
              key={`ask-${idx}`}
              className={`relative grid grid-cols-3 gap-2 py-1.5 px-2 rounded transition-all ${
                isNearPrice ? 'bg-red-500/20 border border-red-500/40' : 'hover:bg-slate-800/50'
              }`}
            >
              <div className="text-right text-red-400 font-semibold text-sm">
                {formatSize(ask.size)}
              </div>
              <div className="text-center text-red-300 font-bold text-sm relative z-10">
                {formatPrice(ask.price)}
              </div>
              <div className="text-left text-gray-400 text-xs">
                ${(notional / 1000).toFixed(1)}K
              </div>
              {/* Visual bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-red-500/20 rounded-r"
                style={{ width: `${widthPercent}%` }}
              />
            </div>
          );
        })}

        {/* Spread indicator */}
        {topBids.length > 0 && topAsks.length > 0 && (
          <div className="my-2 py-2 border-y border-slate-700/50">
            <div className="text-center">
              <span className="text-xs text-gray-400">Spread: </span>
              <span className="text-sm font-bold text-yellow-400">
                {formatPrice(topAsks[0].price - topBids[0].price)} (
                {currentPrice
                  ? (((topAsks[0].price - topBids[0].price) / currentPrice) * 100).toFixed(3)
                  : '0.000'}
                %)
              </span>
            </div>
          </div>
        )}

        {/* Bids (Buy orders) - Green */}
        {topBids.map((bid, idx) => {
          const notional = calculateNotional(bid.price, bid.size);
          const widthPercent = (bid.size / maxSize) * 100;
          const isNearPrice = currentPrice && Math.abs(bid.price - currentPrice) / currentPrice < 0.001;
          
          return (
            <div
              key={`bid-${idx}`}
              className={`relative grid grid-cols-3 gap-2 py-1.5 px-2 rounded transition-all ${
                isNearPrice ? 'bg-green-500/20 border border-green-500/40' : 'hover:bg-slate-800/50'
              }`}
            >
              <div className="text-right text-gray-400 text-xs">
                ${(notional / 1000).toFixed(1)}K
              </div>
              <div className="text-center text-green-300 font-bold text-sm relative z-10">
                {formatPrice(bid.price)}
              </div>
              <div className="text-left text-green-400 font-semibold text-sm">
                {formatSize(bid.size)}
              </div>
              {/* Visual bar */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-green-500/20 rounded-l"
                style={{ width: `${widthPercent}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="mt-4 pt-4 border-t border-slate-700/50 grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="text-gray-400 mb-1">Total Bid Volume</div>
          <div className="text-green-400 font-bold">
            ${(topBids.reduce((sum, b) => sum + calculateNotional(b.price, b.size), 0) / 1000).toFixed(1)}K
          </div>
        </div>
        <div>
          <div className="text-gray-400 mb-1">Total Ask Volume</div>
          <div className="text-red-400 font-bold">
            ${(topAsks.reduce((sum, a) => sum + calculateNotional(a.price, a.size), 0) / 1000).toFixed(1)}K
          </div>
        </div>
      </div>
    </div>
  );
}
