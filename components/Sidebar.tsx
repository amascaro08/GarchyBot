'use client';

import { useState } from 'react';

interface SidebarProps {
  symbol: string;
  setSymbol: (s: string) => void;
  candleInterval: string;
  setCandleInterval: (s: string) => void;
  maxTrades: number;
  setMaxTrades: (n: number) => void;
  leverage: number;
  setLeverage: (n: number) => void;
  capital: number;
  setCapital: (n: number) => void;
  riskAmount: number;
  setRiskAmount: (n: number) => void;
  riskType: 'fixed' | 'percent';
  setRiskType: (t: 'fixed' | 'percent') => void;
  dailyTargetType: 'fixed' | 'percent';
  setDailyTargetType: (t: 'fixed' | 'percent') => void;
  dailyTargetAmount: number;
  setDailyTargetAmount: (n: number) => void;
  dailyStopType: 'fixed' | 'percent';
  setDailyStopType: (t: 'fixed' | 'percent') => void;
  dailyStopAmount: number;
  setDailyStopAmount: (n: number) => void;
  useOrderBookConfirm: boolean;
  setUseOrderBookConfirm: (b: boolean) => void;
  dailyPnL: number;
  dailyTargetValue: number;
  dailyStopValue: number;
  isDailyTargetHit: boolean;
  isDailyStopHit: boolean;
  canTrade: boolean;
  botRunning: boolean;
  onStartBot: () => void;
  onStopBot: () => void;
  symbols: string[];
  intervals: Array<{ value: string; label: string }>;
}

export default function Sidebar({
  symbol,
  setSymbol,
  candleInterval,
  setCandleInterval,
  maxTrades,
  setMaxTrades,
  leverage,
  setLeverage,
  capital,
  setCapital,
  riskAmount,
  setRiskAmount,
  riskType,
  setRiskType,
  dailyTargetType,
  setDailyTargetType,
  dailyTargetAmount,
  setDailyTargetAmount,
  dailyStopType,
  setDailyStopType,
  dailyStopAmount,
  setDailyStopAmount,
  useOrderBookConfirm,
  setUseOrderBookConfirm,
  dailyPnL,
  dailyTargetValue,
  dailyStopValue,
  isDailyTargetHit,
  isDailyStopHit,
  canTrade,
  botRunning,
  onStartBot,
  onStopBot,
  symbols,
  intervals,
}: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 right-4 z-50 glass-effect rounded-xl p-3 border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-purple-500/10 backdrop-blur-xl shadow-lg"
      >
        <svg className="w-6 h-6 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:sticky top-0 left-0 h-screen lg:h-auto
          w-80 lg:w-full
          z-40 lg:z-auto
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          overflow-y-auto custom-scrollbar
          glass-effect border-r-2 border-slate-700/50 bg-slate-900/95 backdrop-blur-xl
        `}
      >
        <div className="p-4 sm:p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between lg:hidden">
            <h2 className="text-xl font-black text-gradient-animated">Settings</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 rounded-lg hover:bg-slate-800/50 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Bot Controls */}
          <div className="glass-effect rounded-xl p-5 border-2 border-green-500/20 bg-gradient-to-br from-green-500/5 to-emerald-500/5 backdrop-blur-xl">
            <h3 className="text-sm font-bold text-green-300 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Bot Controls
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-2 text-cyan-300 uppercase tracking-wider">Trading Pair</label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                >
                  {symbols.map((s) => (
                    <option key={s} value={s} className="bg-slate-900">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-bold mb-2 text-purple-300 uppercase tracking-wider">Interval</label>
                <select
                  value={candleInterval}
                  onChange={(e) => setCandleInterval(e.target.value)}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/20 focus:outline-none focus:ring-2 focus:ring-purple-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                >
                  {intervals.map((int) => (
                    <option key={int.value} value={int.value} className="bg-slate-900">
                      {int.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-2 text-pink-300 uppercase tracking-wider">Max Trades</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={maxTrades}
                    onChange={(e) => setMaxTrades(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                    className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-pink-500/50 hover:shadow-lg hover:shadow-pink-500/20 focus:outline-none focus:ring-2 focus:ring-pink-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-bold mb-2 text-cyan-300 uppercase tracking-wider">Leverage</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={leverage}
                    onChange={(e) => setLeverage(Math.max(1, Math.min(100, parseFloat(e.target.value) || 1)))}
                    className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                {!botRunning ? (
                  <button
                    onClick={onStartBot}
                    disabled={!canTrade}
                    className="flex-1 glass-effect rounded-xl px-6 py-3 bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border-2 border-green-500/40 font-bold hover:from-green-500/30 hover:to-emerald-500/30 hover:border-green-500/60 hover:shadow-lg hover:shadow-green-500/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed backdrop-blur-xl flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Bot
                  </button>
                ) : (
                  <button
                    onClick={onStopBot}
                    className="flex-1 glass-effect rounded-xl px-6 py-3 bg-gradient-to-r from-red-500/20 to-rose-500/20 text-red-300 border-2 border-red-500/40 font-bold hover:from-red-500/30 hover:to-rose-500/30 hover:border-red-500/60 hover:shadow-lg hover:shadow-red-500/30 transition-all duration-300 backdrop-blur-xl flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                    </svg>
                    Stop Bot
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Risk Management */}
          <div className="glass-effect rounded-xl p-5 border-2 border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 backdrop-blur-xl">
            <h3 className="text-sm font-bold text-blue-300 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Risk Management
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-2 text-blue-300 uppercase tracking-wider">Capital ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={capital}
                  onChange={(e) => setCapital(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-2 text-blue-300 uppercase tracking-wider">Risk Type</label>
                <select
                  value={riskType}
                  onChange={(e) => setRiskType(e.target.value as 'fixed' | 'percent')}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                >
                  <option value="fixed" className="bg-slate-900">Fixed $</option>
                  <option value="percent" className="bg-slate-900">% of Capital</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold mb-2 text-blue-300 uppercase tracking-wider">
                  Risk {riskType === 'percent' ? '(%)' : '($)'}
                </label>
                <input
                  type="number"
                  min="0.01"
                  step={riskType === 'percent' ? "0.1" : "1"}
                  value={riskAmount}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (riskType === 'percent') {
                      setRiskAmount(Math.max(0.01, Math.min(100, val)));
                    } else {
                      setRiskAmount(Math.max(0.01, val));
                    }
                  }}
                  className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                />
              </div>
              <div className="glass-effect rounded-xl px-5 py-3 border-2 border-purple-500/40 bg-gradient-to-br from-purple-500/10 to-pink-500/10 backdrop-blur-xl">
                <div className="text-xs text-purple-300 mb-1 font-bold uppercase tracking-wider">Risk Per Trade</div>
                <div className="text-lg font-black text-purple-200 bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                  ${riskType === 'percent' 
                    ? ((capital * riskAmount) / 100).toFixed(2)
                    : riskAmount.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Daily Limits */}
          <div className="glass-effect rounded-xl p-5 border-2 border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 backdrop-blur-xl">
            <h3 className="text-sm font-bold text-cyan-300 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Daily Limits
            </h3>
            
            <div className="mb-4 p-3 rounded-lg bg-slate-900/50 border border-slate-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">Today's P&L</span>
                <span className={`text-lg font-bold ${dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {dailyPnL >= 0 ? '+' : ''}${dailyPnL.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Target: ${dailyTargetValue.toFixed(2)}</span>
                <span className="text-gray-500">Stop: -${dailyStopValue.toFixed(2)}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-cyan-300 uppercase tracking-wider">Target Type</label>
                  <select
                    value={dailyTargetType}
                    onChange={(e) => setDailyTargetType(e.target.value as 'fixed' | 'percent')}
                    className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium cursor-pointer transition-all duration-200 hover:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 w-full bg-slate-900/50"
                  >
                    <option value="percent" className="bg-slate-900">%</option>
                    <option value="fixed" className="bg-slate-900">$</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-cyan-300 uppercase tracking-wider">Target Amount</label>
                  <input
                    type="number"
                    min="0.01"
                    step={dailyTargetType === 'percent' ? "0.1" : "1"}
                    value={dailyTargetAmount}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (dailyTargetType === 'percent') {
                        setDailyTargetAmount(Math.max(0.01, Math.min(100, val)));
                      } else {
                        setDailyTargetAmount(Math.max(0.01, val));
                      }
                    }}
                    className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium w-full transition-all duration-200 hover:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 bg-slate-900/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-red-300 uppercase tracking-wider">Stop Type</label>
                  <select
                    value={dailyStopType}
                    onChange={(e) => setDailyStopType(e.target.value as 'fixed' | 'percent')}
                    className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium cursor-pointer transition-all duration-200 hover:border-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/50 w-full bg-slate-900/50"
                  >
                    <option value="percent" className="bg-slate-900">%</option>
                    <option value="fixed" className="bg-slate-900">$</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-red-300 uppercase tracking-wider">Stop Amount</label>
                  <input
                    type="number"
                    min="0.01"
                    step={dailyStopType === 'percent' ? "0.1" : "1"}
                    value={dailyStopAmount}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      if (dailyStopType === 'percent') {
                        setDailyStopAmount(Math.max(0.01, Math.min(100, val)));
                      } else {
                        setDailyStopAmount(Math.max(0.01, val));
                      }
                    }}
                    className="glass-effect rounded-lg px-3 py-2 text-white text-sm font-medium w-full transition-all duration-200 hover:border-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/50 bg-slate-900/50"
                  />
                </div>
              </div>

              {(isDailyTargetHit || isDailyStopHit) && (
                <div className={`p-3 rounded-lg border-2 ${
                  isDailyTargetHit 
                    ? 'bg-green-500/10 border-green-500/50 text-green-400' 
                    : 'bg-red-500/10 border-red-500/50 text-red-400'
                }`}>
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm font-semibold">
                      {isDailyTargetHit ? 'Daily Target Reached!' : 'Daily Stop Loss Hit!'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Order Book Confirmation */}
          <div className="glass-effect rounded-xl p-5 border-2 border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-pink-500/5 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-purple-300 mb-1 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Order Book Confirmation
                </h3>
                <p className="text-xs text-gray-400">Require order-book imbalance/wall before entering trades</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useOrderBookConfirm}
                  onChange={(e) => setUseOrderBookConfirm(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-12 h-6 bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500 shadow-lg"></div>
              </label>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
