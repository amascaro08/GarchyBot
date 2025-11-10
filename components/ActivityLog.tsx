'use client';

import { useEffect, useRef } from 'react';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';
export type LogEntry = {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
};

interface ActivityLogProps {
  logs: LogEntry[];
  maxLogs?: number;
}

export default function ActivityLog({ logs, maxLogs = 50 }: ActivityLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 2 
    });
  };

  const getLevelStyles = (level: LogLevel) => {
    switch (level) {
      case 'success':
        return {
          bg: 'bg-green-500/10',
          border: 'border-green-500/30',
          text: 'text-green-300',
          icon: '✓',
        };
      case 'warning':
        return {
          bg: 'bg-yellow-500/10',
          border: 'border-yellow-500/30',
          text: 'text-yellow-300',
          icon: '⚠',
        };
      case 'error':
        return {
          bg: 'bg-red-500/10',
          border: 'border-red-500/30',
          text: 'text-red-300',
          icon: '✗',
        };
      default:
        return {
          bg: 'bg-cyan-500/10',
          border: 'border-cyan-500/30',
          text: 'text-cyan-300',
          icon: 'ℹ',
        };
    }
  };

  const displayedLogs = logs.slice(-maxLogs);

  return (
    <div className="glass-effect rounded-xl p-5 border-2 border-slate-700/50 bg-gradient-to-br from-slate-900/80 to-slate-800/80 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-purple-300 to-pink-300">
          Activity Log
        </h3>
        <div className="px-2 py-1 rounded-lg bg-slate-800/50 border border-slate-700/50">
          <span className="text-xs text-gray-400 font-medium">{logs.length} entries</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2"
      >
        {displayedLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">Waiting for activity...</p>
          </div>
        ) : (
          displayedLogs.map((log) => {
            const styles = getLevelStyles(log.level);
            return (
              <div
                key={log.id}
                className={`${styles.bg} ${styles.border} border rounded-lg p-3 transition-all duration-200 hover:bg-opacity-20`}
              >
                <div className="flex items-start gap-2">
                  <div className={`${styles.text} text-xs font-bold flex-shrink-0 mt-0.5`}>
                    {styles.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`${styles.text} text-xs font-semibold`}>
                        {log.message}
                      </span>
                      <span className="text-gray-500 text-xs font-mono flex-shrink-0">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
