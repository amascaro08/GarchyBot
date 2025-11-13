'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, invitationCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      // Redirect to main page
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="glass-effect rounded-2xl p-8 border-2 border-slate-700/50 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Garchy Bot</h1>
            <p className="text-gray-400">Create your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold mb-2 text-green-300 uppercase tracking-wider">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/20 focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                placeholder="your@email.com"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2 text-green-300 uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/20 focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2 text-green-300 uppercase tracking-wider">
                Invitation Code
              </label>
              <input
                type="text"
                value={invitationCode}
                onChange={(e) => setInvitationCode(e.target.value)}
                required
                className="glass-effect rounded-xl px-4 py-3 text-white font-semibold w-full transition-all duration-300 hover:border-green-500/50 hover:shadow-lg hover:shadow-green-500/20 focus:outline-none focus:ring-2 focus:ring-green-500/50 bg-slate-900/70 backdrop-blur-xl border-2 border-slate-700/50"
                placeholder="Enter invitation code"
                autoComplete="off"
              />
            </div>

            {error && (
              <div className="bg-red-500/20 border-2 border-red-500/50 rounded-xl px-4 py-3 text-red-300 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-3 px-6 rounded-xl transition-all duration-300 shadow-lg shadow-green-500/30 hover:shadow-green-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account...' : 'Register'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-gray-400">
              Already have an account?{' '}
              <Link href="/login" className="text-green-400 hover:text-green-300 font-semibold">
                Login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

