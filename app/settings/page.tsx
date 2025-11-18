'use client';

import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import { formatCurrency } from '@/lib/format';

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const DEFAULT_MAX_TRADES = 3;
const DEFAULT_LEVERAGE = 1;
const DEFAULT_CAPITAL = 10000;
const DEFAULT_RISK_AMOUNT = 100;
const DEFAULT_RISK_TYPE = 'fixed';
const DEFAULT_DAILY_TARGET_TYPE = 'percent';
const DEFAULT_DAILY_TARGET_AMOUNT = 5;
const DEFAULT_DAILY_STOP_TYPE = 'percent';
const DEFAULT_DAILY_STOP_AMOUNT = 3;
const INTERVALS = [
  { value: '1', label: '1m' },
  { value: '3', label: '3m' },
  { value: '5', label: '5m' },
  { value: '15', label: '15m' },
  { value: '60', label: '1h' },
  { value: '120', label: '2h' },
  { value: '240', label: '4h' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'trading' | 'risk' | 'account'>('trading');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Trading Settings
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOLS[0]);
  const [candleInterval, setCandleInterval] = useState<string>('5');
  const [maxTrades, setMaxTrades] = useState<number>(DEFAULT_MAX_TRADES);
  const [leverage, setLeverage] = useState<number>(DEFAULT_LEVERAGE);
  const [useOrderBookConfirm, setUseOrderBookConfirm] = useState<boolean>(true);

  // Risk Settings
  const [capital, setCapital] = useState<number>(DEFAULT_CAPITAL);
  const [riskAmount, setRiskAmount] = useState<number>(DEFAULT_RISK_AMOUNT);
  const [riskType, setRiskType] = useState<'fixed' | 'percent'>(DEFAULT_RISK_TYPE);
  const [garchMode, setGarchMode] = useState<'auto' | 'custom'>('auto');
  const [customKPct, setCustomKPct] = useState<number>(0.03);
  const [dailyTargetType, setDailyTargetType] = useState<'fixed' | 'percent'>(DEFAULT_DAILY_TARGET_TYPE);
  const [dailyTargetAmount, setDailyTargetAmount] = useState<number>(DEFAULT_DAILY_TARGET_AMOUNT);
  const [dailyStopType, setDailyStopType] = useState<'fixed' | 'percent'>(DEFAULT_DAILY_STOP_TYPE);
  const [dailyStopAmount, setDailyStopAmount] = useState<number>(DEFAULT_DAILY_STOP_AMOUNT);

  // Account Settings
  const [apiMode, setApiMode] = useState<'demo' | 'live'>('demo');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [walletInfo, setWalletInfo] = useState<Array<{ coin: string; equity: number; availableToWithdraw: number }> | null>(null);

  useEffect(() => {
    loadSettings();
    loadSymbols();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        if (data.botConfig) {
          const config = data.botConfig;
          setSymbol(config.symbol || DEFAULT_SYMBOLS[0]);
          setCandleInterval(config.candle_interval || '5');
          setMaxTrades(config.max_trades || DEFAULT_MAX_TRADES);
          setLeverage(config.leverage || DEFAULT_LEVERAGE);
          setCapital(Number(config.capital) || DEFAULT_CAPITAL);
          setRiskAmount(Number(config.risk_amount) || DEFAULT_RISK_AMOUNT);
          setRiskType(config.risk_type || DEFAULT_RISK_TYPE);
          setDailyTargetType(config.daily_target_type || DEFAULT_DAILY_TARGET_TYPE);
          setDailyTargetAmount(Number(config.daily_target_amount) || DEFAULT_DAILY_TARGET_AMOUNT);
          setDailyStopType(config.daily_stop_type || DEFAULT_DAILY_STOP_TYPE);
          setDailyStopAmount(Number(config.daily_stop_amount) || DEFAULT_DAILY_STOP_AMOUNT);
          setGarchMode(config.garch_mode || 'auto');
          if (config.custom_k_pct !== null) setCustomKPct(Number(config.custom_k_pct));
          setUseOrderBookConfirm(config.use_orderbook_confirm !== false);
          setApiMode((config.api_mode as 'demo' | 'live') || 'demo');
          setApiKey(config.api_key || '');
          setApiSecret(config.api_secret || '');
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadSymbols = async () => {
    try {
      const res = await fetch('/api/symbols');
      const data = await res.json();
      if (res.ok && data.success && Array.isArray(data.symbols) && data.symbols.length > 0) {
        setSymbols(data.symbols);
      }
    } catch (error) {
      console.error('Failed to load symbols:', error);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaveMessage(null);

    try {
      const settingsToSave = {
        symbol,
        candle_interval: candleInterval,
        max_trades: maxTrades,
        leverage,
        capital,
        risk_amount: riskAmount,
        risk_type: riskType,
        daily_target_type: dailyTargetType,
        daily_target_amount: dailyTargetAmount,
        daily_stop_type: dailyStopType,
        daily_stop_amount: dailyStopAmount,
        garch_mode: garchMode,
        custom_k_pct: customKPct,
        use_orderbook_confirm: useOrderBookConfirm,
        api_mode: apiMode,
        api_key: apiKey.trim() || null,
        api_secret: apiSecret.trim() || null,
      };

      const res = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsToSave),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      setSaveMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      setSaveMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to save settings' 
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) {
      setConnectionStatus('error');
      setConnectionMessage('Please provide both API key and secret');
      return;
    }

    setConnectionStatus('loading');
    setConnectionMessage(null);
    setWalletInfo(null);

    try {
      const res = await fetch('/api/bybit/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          mode: apiMode,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Connection failed');
      }

      const balances = Array.isArray(data.wallet?.list)
        ? data.wallet.list.flatMap((wallet: any) =>
            (wallet.coin || []).map((coin: any) => ({
              coin: coin.coin,
              equity: Number(coin.equity || 0),
              availableToWithdraw: Number(coin.availableBalance || coin.availableToWithdraw || 0),
            }))
          ).filter((w: any) => w.equity > 0 || w.availableToWithdraw > 0)
        : [];

      setWalletInfo(balances);
      setConnectionStatus('success');
      setConnectionMessage('Connection successful');

      // Auto-sync capital in live mode
      if (apiMode === 'live' && balances.length > 0) {
        const totalEquity = balances.reduce((sum: number, w: any) => sum + w.equity, 0);
        if (totalEquity > 0) setCapital(totalEquity);
      }
    } catch (error) {
      setConnectionStatus('error');
      setConnectionMessage(error instanceof Error ? error.message : 'Connection failed');
    }
  };

  const dailyTargetValue = dailyTargetType === 'percent' 
    ? (capital * dailyTargetAmount) / 100 
    : dailyTargetAmount;

  const dailyStopValue = dailyStopType === 'percent' 
    ? (capital * dailyStopAmount) / 100 
    : dailyStopAmount;

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Navigation />
      
      <main className="pt-20 md:pt-24 pb-24 md:pb-8 px-4 md:px-6">
        <div className="max-w-[1400px] mx-auto">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-black gradient-text mb-2">Settings</h1>
            <p className="text-slate-400">Configure your trading bot parameters and preferences</p>
          </div>

          {/* Save Message */}
          {saveMessage && (
            <div className={`mb-6 p-4 rounded-xl border ${
              saveMessage.type === 'success' 
                ? 'bg-green-500/10 border-green-500/30 text-green-300' 
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              {saveMessage.text}
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex gap-2 mb-6 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700/60 overflow-x-auto">
            {[
              { key: 'trading', label: 'Trading', icon: '⚡' },
              { key: 'risk', label: 'Risk & Limits', icon: '🛡️' },
              { key: 'account', label: 'Account', icon: '🔑' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`flex-1 min-w-[120px] px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 flex items-center justify-center gap-2 ${
                  activeTab === tab.key
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                <span className="text-lg">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="space-y-6">
            {activeTab === 'trading' && (
              <>
                {/* Trading Pairs & Intervals */}
                <div className="card p-6">
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <span className="text-2xl">📊</span>
                    Trading Parameters
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Trading Pair</label>
                      <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="select w-full">
                        {symbols.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-400 mt-1.5">The cryptocurrency pair to trade</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Candle Interval</label>
                      <select value={candleInterval} onChange={(e) => setCandleInterval(e.target.value)} className="select w-full">
                        {INTERVALS.map((int) => (
                          <option key={int.value} value={int.value}>{int.label}</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-400 mt-1.5">Chart timeframe for analysis</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Max Concurrent Trades</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={maxTrades}
                        onChange={(e) => setMaxTrades(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                        className="input w-full"
                      />
                      <p className="text-xs text-slate-400 mt-1.5">Maximum number of open positions</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Leverage</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={leverage}
                        onChange={(e) => setLeverage(Math.max(1, Math.min(100, parseFloat(e.target.value) || 1)))}
                        className="input w-full"
                      />
                      <p className="text-xs text-slate-400 mt-1.5">Trading leverage multiplier (1x-100x)</p>
                    </div>
                  </div>
                  <div className="mt-6">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useOrderBookConfirm}
                        onChange={(e) => setUseOrderBookConfirm(e.target.checked)}
                        className="w-5 h-5 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <span className="text-sm font-semibold text-slate-300">Order Book Confirmation</span>
                        <p className="text-xs text-slate-400">Require liquidity wall before placing orders</p>
                      </div>
                    </label>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'risk' && (
              <>
                {/* GARCH Volatility */}
                <div className="card p-6">
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <span className="text-2xl">📈</span>
                    Volatility (GARCH)
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Mode</label>
                      <select value={garchMode} onChange={(e) => setGarchMode(e.target.value as 'auto' | 'custom')} className="select w-full">
                        <option value="auto">Auto (Daily Recalculation)</option>
                        <option value="custom">Custom Range</option>
                      </select>
                    </div>
                    {garchMode === 'custom' && (
                      <div>
                        <label className="block text-sm font-semibold text-slate-300 mb-2">Custom kPct (%)</label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          step="0.1"
                          value={(customKPct * 100).toFixed(1)}
                          onChange={(e) => setCustomKPct(Math.max(1, Math.min(10, parseFloat(e.target.value) || 1)) / 100)}
                          className="input w-full"
                        />
                        <p className="text-xs text-slate-400 mt-1.5">Expected daily move percentage (1%-10%)</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Position Sizing */}
                <div className="card p-6">
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <span className="text-2xl">💰</span>
                    Position Sizing
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">
                        Capital ($)
                        {apiMode === 'live' && <span className="ml-2 text-xs text-yellow-400">(Auto-synced)</span>}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={capital}
                        onChange={(e) => setCapital(Math.max(1, parseFloat(e.target.value) || 1))}
                        disabled={apiMode === 'live'}
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">Risk Type</label>
                      <select value={riskType} onChange={(e) => setRiskType(e.target.value as 'fixed' | 'percent')} className="select w-full">
                        <option value="fixed">Fixed Amount ($)</option>
                        <option value="percent">Percentage (%)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-slate-300 mb-2">
                        Risk Per Trade {riskType === 'percent' ? '(%)' : '($)'}
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step={riskType === 'percent' ? '0.1' : '1'}
                        value={riskAmount}
                        onChange={(e) => setRiskAmount(Math.max(0.01, parseFloat(e.target.value) || 0))}
                        className="input w-full"
                      />
                      <div className="mt-3 p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                        <span className="text-sm text-slate-400">Calculated Risk: </span>
                        <span className="text-lg font-bold text-indigo-300">
                          {formatCurrency(riskType === 'percent' ? (capital * riskAmount) / 100 : riskAmount)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Daily Limits */}
                <div className="card p-6">
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <span className="text-2xl">🎯</span>
                    Daily Limits
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-green-300 mb-2">Daily Target Type</label>
                      <select value={dailyTargetType} onChange={(e) => setDailyTargetType(e.target.value as 'fixed' | 'percent')} className="select w-full">
                        <option value="percent">Percentage (%)</option>
                        <option value="fixed">Fixed Amount ($)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-green-300 mb-2">Target Amount</label>
                      <input
                        type="number"
                        min="0.01"
                        step={dailyTargetType === 'percent' ? '0.1' : '1'}
                        value={dailyTargetAmount}
                        onChange={(e) => setDailyTargetAmount(Math.max(0.01, parseFloat(e.target.value) || 0))}
                        className="input w-full"
                      />
                      <p className="text-xs text-slate-400 mt-1.5">Value: {formatCurrency(dailyTargetValue)}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-red-300 mb-2">Daily Stop Type</label>
                      <select value={dailyStopType} onChange={(e) => setDailyStopType(e.target.value as 'fixed' | 'percent')} className="select w-full">
                        <option value="percent">Percentage (%)</option>
                        <option value="fixed">Fixed Amount ($)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-red-300 mb-2">Stop Amount</label>
                      <input
                        type="number"
                        min="0.01"
                        step={dailyStopType === 'percent' ? '0.1' : '1'}
                        value={dailyStopAmount}
                        onChange={(e) => setDailyStopAmount(Math.max(0.01, parseFloat(e.target.value) || 0))}
                        className="input w-full"
                      />
                      <p className="text-xs text-slate-400 mt-1.5">Value: {formatCurrency(dailyStopValue)}</p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'account' && (
              <>
                {/* API Configuration */}
                <div className="card p-6">
                  <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <span className="text-2xl">🔐</span>
                    Bybit API Configuration
                  </h2>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-3">Trading Mode</label>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={() => setApiMode('demo')}
                          className={`p-4 rounded-xl border-2 transition-all duration-300 ${
                            apiMode === 'demo'
                              ? 'bg-green-500/20 border-green-500/60 text-green-300 shadow-lg'
                              : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-green-500/40'
                          }`}
                        >
                          <div className="text-lg font-bold mb-1">Demo (Testnet)</div>
                          <div className="text-xs">Practice trading</div>
                        </button>
                        <button
                          onClick={() => setApiMode('live')}
                          className={`p-4 rounded-xl border-2 transition-all duration-300 ${
                            apiMode === 'live'
                              ? 'bg-red-500/20 border-red-500/60 text-red-300 shadow-lg'
                              : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:border-red-500/40'
                          }`}
                        >
                          <div className="text-lg font-bold mb-1">Live (Mainnet)</div>
                          <div className="text-xs">Real trading</div>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">API Key</label>
                      <input
                        type="text"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Enter your Bybit API key"
                        className="input w-full font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-300 mb-2">API Secret</label>
                      <input
                        type="password"
                        value={apiSecret}
                        onChange={(e) => setApiSecret(e.target.value)}
                        placeholder="Enter your Bybit API secret"
                        className="input w-full font-mono text-sm"
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleTestConnection}
                        disabled={connectionStatus === 'loading'}
                        className="btn btn-primary"
                      >
                        {connectionStatus === 'loading' ? 'Testing...' : '🔗 Test Connection'}
                      </button>
                      {connectionStatus === 'success' && (
                        <div className="flex items-center gap-2 text-green-400">
                          <span>✓</span>
                          <span className="text-sm font-semibold">{connectionMessage}</span>
                        </div>
                      )}
                      {connectionStatus === 'error' && (
                        <div className="flex items-center gap-2 text-red-400">
                          <span>✗</span>
                          <span className="text-sm font-semibold">{connectionMessage}</span>
                        </div>
                      )}
                    </div>

                    {/* Wallet Info */}
                    {walletInfo && walletInfo.length > 0 && (
                      <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
                        <div className="text-sm font-semibold text-green-300 mb-3">Wallet Balances</div>
                        <div className="space-y-2">
                          {walletInfo.map((wallet) => (
                            <div key={wallet.coin} className="flex justify-between text-sm">
                              <span className="text-slate-300 font-semibold">{wallet.coin}</span>
                              <span className="text-green-400 font-mono">
                                {wallet.equity.toFixed(4)} <span className="text-xs text-slate-400">(Avail: {wallet.availableToWithdraw.toFixed(4)})</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Save Button */}
          <div className="mt-8 flex gap-4">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="btn btn-success flex-1 md:flex-none md:px-12 py-4 text-lg"
            >
              {saving ? 'Saving...' : '💾 Save All Settings'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
