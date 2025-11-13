'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/format';

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
  onSaveSettings: () => void;
  symbols: string[];
  symbolsLoading?: boolean;
  intervals: Array<{ value: string; label: string }>;
  garchMode: 'auto' | 'custom';
  setGarchMode: (m: 'auto' | 'custom') => void;
  customKPct: number;
  setCustomKPct: (n: number) => void;
  apiMode: 'demo' | 'live';
  setApiMode: (m: 'demo' | 'live') => void;
  apiKey: string;
  setApiKey: (value: string) => void;
  apiSecret: string;
  setApiSecret: (value: string) => void;
  onTestConnection: () => void;
  connectionStatus: 'idle' | 'loading' | 'success' | 'error';
  connectionMessage: string | null;
  walletInfo: Array<{ coin: string; equity: number; availableToWithdraw: number }> | null;
}

export default function Sidebar(props: SidebarProps) {
  const {
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
    onSaveSettings,
    symbols,
    symbolsLoading = false,
    intervals,
    garchMode,
    setGarchMode,
    customKPct,
    setCustomKPct,
    apiMode,
    setApiMode,
    apiKey,
    setApiKey,
    apiSecret,
    setApiSecret,
    onTestConnection,
    connectionStatus,
    connectionMessage,
    walletInfo,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'trading' | 'risk' | 'account'>('trading');

  const renderTradingTab = () => (
    <div className="space-y-6">
      <div className="glass-effect rounded-xl p-5 border-2 border-green-500/20 bg-gradient-to-br from-green-500/5 to-emerald-500/5 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-green-300">Bot Controls</h3>
            <p className="text-xs text-gray-400">Start and manage automated execution</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-2 text-cyan-300 uppercase tracking-wider">Trading Pair</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              disabled={symbols.length === 0}
              className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-cyan-500/50 hover:shadow-lg hover:shadow-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {symbols.length === 0 ? (
                <option value="" className="bg-slate-900">
                  {symbolsLoading ? 'Loading symbols…' : 'No symbols available'}
                </option>
              ) : (
                symbols.map((s) => (
                  <option key={s} value={s} className="bg-slate-900">
                    {s}
                  </option>
                ))
              )}
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

          <div>
            <label className="flex items-center gap-2 text-xs font-bold text-cyan-300 uppercase tracking-wider">
              <input
                type="checkbox"
                checked={useOrderBookConfirm}
                onChange={(e) => setUseOrderBookConfirm(e.target.checked)}
                className="form-checkbox h-4 w-4 text-cyan-500 border-slate-600 rounded"
              />
              Order Book Confirmation
            </label>
            <p className="text-xs text-gray-400 mt-1">
              Require a liquidity wall on Level 2 data before submitting a live order.
            </p>
          </div>

          {!canTrade && (
            <div className="glass-effect rounded-lg px-3 py-2 border border-yellow-500/40 bg-yellow-500/10 text-yellow-200 text-sm">
              Daily limit reached. Starting the bot will create a new session.
            </div>
          )}

          <div className="flex gap-3">
            {!botRunning ? (
              <button
                onClick={onStartBot}
                className="flex-1 glass-effect rounded-xl px-6 py-3 bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border-2 border-green-500/40 font-bold hover:from-green-500/30 hover:to-emerald-500/30 hover:border-green-500/60 hover:shadow-lg hover:shadow-green-500/30 transition-all duration-300 backdrop-blur-xl flex items-center justify-center gap-2"
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
    </div>
  );

  const renderRiskTab = () => (
    <div className="space-y-6">
      <div className="glass-effect rounded-xl p-5 border-2 border-yellow-500/20 bg-gradient-to-br from-yellow-500/5 to-orange-500/5 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-yellow-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-yellow-300">GARCH Volatility</h3>
            <p className="text-xs text-gray-400">Control the daily statistical setup</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-2 text-yellow-300 uppercase tracking-wider">Mode</label>
            <select
              value={garchMode}
              onChange={(e) => setGarchMode(e.target.value as 'auto' | 'custom')}
              className="glass-effect rounded-xl px-4 py-3 text-white font-semibold cursor-pointer transition-all duration-300 hover:border-yellow-500/50 hover:shadow-lg hover:shadow-yellow-500/20 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 w-full bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
            >
              <option value="auto" className="bg-slate-900">Auto (Daily Open)</option>
              <option value="custom" className="bg-slate-900">Custom Range</option>
            </select>
          </div>

          {garchMode === 'custom' ? (
            <div>
              <label className="block text-xs font-bold mb-2 text-yellow-300 uppercase tracking-wider">Custom kPct (%)</label>
              <input
                type="number"
                min="1"
                max="10"
                step="0.1"
                value={(customKPct * 100).toFixed(1)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 1;
                  const clamped = Math.max(1, Math.min(10, val));
                  setCustomKPct(clamped / 100);
                }}
                className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-yellow-500/50 hover:shadow-lg hover:shadow-yellow-500/20 focus:outline-none focus:ring-2 focus:ring-yellow-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
              />
              <p className="text-xs text-gray-400 mt-1">Expected daily move percentage (1%-10%).</p>
            </div>
          ) : (
            <div className="glass-effect rounded-xl px-5 py-3 border-2 border-yellow-500/30 bg-yellow-500/10 text-yellow-200">
              Daily GARCH(1,1), EGARCH(1,1), GJR forecasts averaged automatically at 00:00 UTC.
            </div>
          )}
        </div>
      </div>

      <div className="glass-effect rounded-xl p-5 border-2 border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-blue-300">Risk Management</h3>
            <p className="text-xs text-gray-400">Position sizing for each entry</p>
          </div>
        </div>

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
              step={riskType === 'percent' ? '0.1' : '1'}
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
              {formatCurrency(riskType === 'percent' ? (capital * riskAmount) / 100 : riskAmount)}
            </div>
          </div>
        </div>
      </div>

      <div className="glass-effect rounded-xl p-5 border-2 border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-cyan-300">Daily Limits</h3>
            <p className="text-xs text-gray-400">Daily P&L guardrails</p>
          </div>
        </div>

        <div className="mb-4 p-3 rounded-lg bg-slate-900/50 border border-slate-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Today's P&L</span>
            <span className={`text-lg font-bold ${dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {dailyPnL >= 0 ? '+' : ''}{formatCurrency(dailyPnL).replace('$', '')}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Target: {formatCurrency(dailyTargetValue).replace('$', '')}</span>
            <span>Stop: -{formatCurrency(dailyStopValue).replace('$', '')}</span>
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
                step={dailyTargetType === 'percent' ? '0.1' : '1'}
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
                step={dailyStopType === 'percent' ? '0.1' : '1'}
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
            <div
              className={`p-3 rounded-lg border-2 ${
                isDailyTargetHit
                  ? 'bg-green-500/10 border-green-500/50 text-green-300'
                  : 'bg-red-500/10 border-red-500/50 text-red-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm font-semibold">
                  {isDailyTargetHit ? 'Daily target reached' : 'Daily stop loss hit'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderAccountTab = () => (
    <div className="space-y-6">
      <div className="glass-effect rounded-xl p-5 border-2 border-green-500/20 bg-gradient-to-br from-green-500/5 to-emerald-500/5 backdrop-blur-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 1.343-3 3v7h6v-7c0-1.657-1.343-3-3-3z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10V6a3 3 0 013-3h8a3 3 0 013 3v4M4 21h16" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-green-300">Bybit Account</h3>
            <p className="text-xs text-gray-400">API credentials & wallet snapshot</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-2 text-green-300 uppercase tracking-wider">Account Mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setApiMode('demo')}
                className={`px-4 py-3 rounded-xl border-2 transition-all duration-300 text-sm font-semibold ${
                  apiMode === 'demo'
                    ? 'bg-green-500/20 border-green-500/60 text-green-200 shadow-lg shadow-green-500/20'
                    : 'bg-slate-900/70 border-slate-700/50 text-gray-300 hover:border-green-500/40 hover:shadow-green-500/10'
                }`}
              >
                Demo (Testnet)
              </button>
              <button
                onClick={() => setApiMode('live')}
                className={`px-4 py-3 rounded-xl border-2 transition-all duration-300 text-sm font-semibold ${
                  apiMode === 'live'
                    ? 'bg-red-500/20 border-red-500/60 text-red-200 shadow-lg shadow-red-500/20'
                    : 'bg-slate-900/70 border-slate-700/50 text-gray-300 hover:border-red-500/40 hover:shadow-red-500/10'
                }`}
              >
                Live (Mainnet)
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Demo mode uses Bybit Testnet. Live mode places orders on mainnet — double-check your keys before enabling.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold mb-2 text-green-300 uppercase tracking-wider">Bybit API Key</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter API key"
              className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/20 focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div>
            <label className="block text-xs font-bold mb-2 text-green-300 uppercase tracking-wider">Bybit API Secret</label>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Enter API secret"
              className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/20 focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onTestConnection}
              className="glass-effect rounded-xl px-4 py-3 bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border-2 border-green-500/40 font-semibold hover:from-green-500/30 hover:to-emerald-500/30 hover:border-green-500/60 hover:shadow-lg hover:shadow-green-500/30 transition-all duration-300 backdrop-blur-xl flex items-center justify-center gap-2"
            >
              {connectionStatus === 'loading' ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-green-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Testing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m7 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Test Connection
                </>
              )}
            </button>

            {connectionStatus === 'success' && (
              <span className="text-sm text-green-300 font-semibold flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Connection successful
              </span>
            )}

            {connectionStatus === 'error' && (
              <span className="text-sm text-red-300 font-semibold flex items-center gap-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                {connectionMessage || 'Connection failed'}
              </span>
            )}
          </div>

          {walletInfo && walletInfo.length > 0 && (
            <div className="glass-effect rounded-xl border border-green-500/30 p-4 bg-green-500/5">
              <div className="text-xs text-green-300 uppercase tracking-wider font-bold mb-2">Wallet Balances</div>
              <div className="space-y-2">
                {walletInfo.map((wallet) => (
                  <div key={wallet.coin} className="flex items-center justify-between text-sm text-green-200">
                    <span className="font-semibold">{wallet.coin}</span>
                    <span className="font-mono">
                      Equity: {wallet.equity}
                      <span className="text-xs text-green-300 ml-2">Available: {wallet.availableToWithdraw}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {connectionMessage && connectionStatus !== 'error' && (
            <p className="text-xs text-gray-400">{connectionMessage}</p>
          )}
        </div>
      </div>
    </div>
  );

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'trading':
        return renderTradingTab();
      case 'risk':
        return renderRiskTab();
      case 'account':
      default:
        return renderAccountTab();
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 right-4 z-50 glass-effect rounded-xl p-3 border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-purple-500/10 backdrop-blur-xl shadow-lg hover:shadow-xl hover:border-cyan-500/50 transition-all duration-300"
      >
        <svg className="w-6 h-6 text-cyan-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-screen
          w-80 lg:w-96
          z-40
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          overflow-y-auto custom-scrollbar
          glass-effect border-r-2 border-slate-700/50 bg-slate-900/95 backdrop-blur-xl
        `}
      >
        <div className="p-4 sm:p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-gradient-animated">Settings</h2>
              <p className="text-xs text-gray-400 mt-0.5">Tune execution, risk, and API access</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-3 rounded-xl hover:bg-slate-800/50 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/20"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-3 bg-slate-900/70 border border-slate-700/60 rounded-xl p-2">
            {[
              { key: 'trading', label: 'Trading' },
              { key: 'risk', label: 'Risk' },
              { key: 'account', label: 'Account' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${
                  activeTab === tab.key
                    ? 'bg-cyan-500/30 text-cyan-100 border border-cyan-400/50 shadow-lg shadow-cyan-500/20'
                    : 'text-gray-400 hover:text-cyan-200 hover:bg-cyan-500/10'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            {renderActiveTab()}
          </div>

          <div className="pt-2">
            <button
              onClick={onSaveSettings}
              className="w-full glass-effect rounded-xl px-6 py-3 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-cyan-300 border-2 border-cyan-500/40 font-bold hover:from-cyan-500/30 hover:to-purple-500/30 hover:border-cyan-500/60 hover:shadow-lg hover:shadow-cyan-500/30 transition-all duration-300 backdrop-blur-xl flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save Settings
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
