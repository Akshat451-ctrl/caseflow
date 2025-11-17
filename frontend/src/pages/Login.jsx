import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { toast } from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const magic = params.get('magic') || params.get('token');
    if (!magic) return;
    (async () => {
      try {
        toast.loading('Verifying magic link...');
        const res = await api.post('/api/auth/verify-magic', { token: magic });
        const { token, user } = res.data;
        setAuth(token, user);
        toast.dismiss();
        toast.success('Signed in');
        navigate('/upload');
      } catch (err) {
        toast.dismiss();
        console.error('Magic verify error', err);
        toast.error('Magic link invalid or expired');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const { token, user } = res.data;
      setAuth(token, user);
      toast.success('Signed in');
      navigate('/upload');
    } catch (err) {
      console.error('Login error', err);
      const message = err?.response?.data?.error || err.message || 'Login failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  async function sendMagic(e) {
    e.preventDefault();
    if (!email) return toast('Please enter your email');
    try {
      await api.post('/api/auth/magic-login', { email });
      toast.success('Magic link sent — check your email');
    } catch (err) {
      console.error('Magic send error', err);
      const message = err?.response?.data?.error || err.message || 'Failed to send magic link';
      toast.error(message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-indigo-50 to-white py-12 px-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-2">
        <div className="hidden md:flex flex-col justify-center items-start p-10 bg-gradient-to-br from-indigo-600 to-indigo-400 text-white">
          <h1 className="text-3xl font-bold mb-2">Welcome to CaseFlow</h1>
          <p className="text-sm opacity-90 mb-6">Manage case imports, review failures, and collaborate with your team — faster.</p>
          <div className="flex items-center space-x-3 mt-auto">
            <div className="bg-white/20 p-3 rounded-full">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v4a1 1 0 001 1h3m10-6v6a1 1 0 01-1 1h-3M7 21h10" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium">Secure, passwordless sign-in</div>
              <div className="text-xs opacity-80">Try the magic link or traditional password sign-in</div>
            </div>
          </div>
        </div>

        <div className="p-8 md:p-10">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">Sign in</h2>
            <p className="text-sm text-gray-500">Enter your email to continue</p>
          </div>

          {error && (
            <div className="mb-4 text-red-700 bg-red-100 p-3 rounded">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 block w-full px-4 py-2 border border-gray-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                className="mt-1 block w-full px-4 py-2 border border-gray-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 py-2 px-4 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
              <button type="button" className="text-sm text-gray-500 hover:underline">Forgot password?</button>
            </div>
          </form>

          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-medium mb-3">Or sign in with a magic link</h3>
            <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-2">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="flex-1 px-4 py-2 border border-gray-200 rounded-lg mb-2 sm:mb-0" />
              <button onClick={sendMagic} className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg font-medium">Send Magic Link</button>
            </div>
            <p className="mt-2 text-xs text-gray-400">You'll receive an email with a link to sign in without a password. Link valid for a short time.</p>
          </div>

          <div className="mt-6 text-center text-sm text-gray-500">
            Don't have an account? <span className="text-indigo-600 font-medium">Ask an admin to create one.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
