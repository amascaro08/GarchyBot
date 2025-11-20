'use client';

import { useEffect, useState } from 'react';

interface ActivityLog {
  id: string;
  created_at: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  metadata?: any;
}

export default function BotDecisionPanel({ className = '' }: { className?: string }) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch('/api/activity?limit=20');
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
        }
      } catch (err) {
        console.error('Error fetching activity logs:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const getLevelIcon = (level: string) => {
    if (level === 'success') return { icon: '✓', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' };
    if (level === 'error') return { icon: '✗', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
    if (level === 'warning') return { icon: '⚠', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' };
    return { icon: '•', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30' };
  };

  const getRelativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  if (loading) {
    return (
      <div className={`card p-6 ${className}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <span className="text-2xl">🧠</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Bot Activity</h2>
            <p className="text-xs text-slate-400">Real-time decision logic</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`card p-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <span className="text-2xl">🧠</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Bot Activity</h2>
            <p className="text-xs text-slate-400">Real-time decision logic</p>
          </div>
        </div>
        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
      </div>

      {/* Activity Logs */}
      {logs.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-slate-500">
          <div className="text-center">
            <div className="text-4xl mb-2">💤</div>
            <p className="text-sm">No recent activity</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
          {logs.map((log) => {
            const style = getLevelIcon(log.level);
            return (
              <div
                key={log.id}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${style.bg} ${style.border}`}
              >
                <span className={`text-sm ${style.color} mt-0.5`}>{style.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-300 leading-relaxed">{log.message}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{getRelativeTime(log.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
