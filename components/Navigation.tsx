'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BybitBalanceCard from './BybitBalanceCard';

interface NavigationProps {
  botRunning?: boolean;
  onQuickToggle?: () => void;
  botToggling?: boolean;
}

export default function Navigation({ botRunning = false, onQuickToggle, botToggling = false }: NavigationProps) {
  const pathname = usePathname();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const navItems = [
    { href: '/', label: 'Dashboard', icon: '📊' },
    { href: '/trades', label: 'Trades', icon: '💹' },
    { href: '/analytics', label: 'Analytics', icon: '📈' },
    { href: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href);
  };

  // Desktop Navigation (Top)
  const DesktopNav = () => (
    <nav className="hidden md:block fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800/60 shadow-xl">
      <div className="max-w-[1920px] mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 group-hover:shadow-indigo-500/50 transition-all duration-300">
              <span className="text-2xl">⚡</span>
            </div>
            <div>
              <h1 className="text-xl font-black gradient-text">GARCHY</h1>
              <p className="text-xs text-slate-400">Trading Bot</p>
            </div>
          </Link>

          {/* Nav Items */}
          <div className="flex items-center gap-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  px-4 py-2.5 rounded-xl font-semibold text-sm
                  transition-all duration-300 flex items-center gap-2
                  active:scale-95 cursor-pointer
                  ${
                    isActive(item.href)
                      ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50 active:bg-slate-800'
                  }
                `}
              >
                <span className="text-lg">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-4">
            {/* Bybit Balance */}
            <BybitBalanceCard />

            {/* Bot Status */}
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className={`w-2.5 h-2.5 rounded-full ${botRunning ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-sm font-semibold text-slate-300">
                {botRunning ? 'Bot Active' : 'Bot Inactive'}
              </span>
            </div>

            {/* Quick Toggle */}
            {onQuickToggle && (
              <button
                onClick={onQuickToggle}
                disabled={botToggling}
                className={`
                  px-5 py-2.5 rounded-xl font-bold text-sm
                  transition-all duration-300 shadow-lg
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${
                    botRunning
                      ? 'bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-500 hover:to-red-400 shadow-red-500/30 hover:shadow-red-500/50'
                      : 'bg-gradient-to-r from-green-600 to-green-500 text-white hover:from-green-500 hover:to-green-400 shadow-green-500/30 hover:shadow-green-500/50'
                  }
                `}
              >
                {botToggling ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⏳</span>
                    {botRunning ? 'Stopping...' : 'Starting...'}
                  </span>
                ) : (
                  <>{botRunning ? '⏸ Stop' : '▶ Start'}</>
                )}
              </button>
            )}

            {/* User Menu */}
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all duration-300"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );

  // Mobile Navigation (Bottom)
  const MobileNav = () => (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800/60 shadow-2xl">
      <div className="grid grid-cols-4 gap-1 px-2 py-3">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`
              flex flex-col items-center justify-center gap-1 py-2 rounded-xl
              transition-all duration-300 cursor-pointer active:scale-95
              ${
                isActive(item.href)
                  ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white shadow-lg'
                  : 'text-slate-400 active:bg-slate-800/50'
              }
            `}
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="text-xs font-semibold">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );

  // Mobile Top Bar
  const MobileTopBar = () => (
    <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800/60">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
            <span className="text-xl">⚡</span>
          </div>
          <span className="text-lg font-black gradient-text">GARCHY</span>
        </Link>

        <div className="flex items-center gap-2">
          {/* Bot Status */}
          <div className={`w-2 h-2 rounded-full ${botRunning ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          
          {/* Quick Toggle */}
          {onQuickToggle && (
            <button
              onClick={onQuickToggle}
              disabled={botToggling}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-bold
                transition-all duration-300
                disabled:opacity-50 disabled:cursor-not-allowed
                ${
                  botRunning
                    ? 'bg-red-600 text-white'
                    : 'bg-green-600 text-white'
                }
              `}
            >
              {botToggling ? (
                botRunning ? '⏳' : '⏳'
              ) : (
                botRunning ? 'Stop' : 'Start'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <DesktopNav />
      <MobileTopBar />
      <MobileNav />
    </>
  );
}
