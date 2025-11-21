import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { toast } from 'react-hot-toast';

// Enhanced Professional CaseFlow Login/Register Component
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const mounted = useRef(true);

  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: 'demo@caseflow.local',
    password: 'demopass',
    confirm: ''
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Magic link verification
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const magic = params.get('magic') || params.get('token');
    if (!magic) return;
    (async () => {
      const t = toast.loading('Verifying magic link...');
      try {
        const res = await api.post('/api/auth/verify-magic', { token: magic });
        const { token, user } = res.data;
        setAuth(token, user);
        toast.dismiss(t);
        toast.success('Signed in — welcome back');
        navigate('/upload');
      } catch (err) {
        toast.dismiss(t);
        console.error(err);
        toast.error('Magic link invalid or expired');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const validateForm = () => {
    const newErrors = {};
    if (mode === 'register') {
      if (!formData.name.trim()) newErrors.name = 'Full name is required';
      if (formData.password.length < 6) newErrors.password = 'Password must be at least 6 characters';
      if (formData.password !== formData.confirm) newErrors.confirm = 'Passwords do not match';
    }
    if (!formData.email) newErrors.email = 'Email is required';
    if (!formData.password) newErrors.password = 'Password is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (loading) return; // prevent duplicate submissions
    if (!validateForm()) return;

    setLoading(true);
    try {
      if (mode === 'login') {
        const payload = {
          email: formData.email,
          password: formData.password
        };
        console.log('[AUTH] Login payload:', payload); // debug payload
        const res = await api.post('/api/auth/login', payload);
        console.log('[AUTH] Login response:', res?.status, res?.data); // debug response
        const { token, user } = res.data;
        setAuth(token, user);
        toast.success('Signed in successfully');
        navigate('/upload');
      } else {
        const payload = {
          name: formData.name.trim(),
          email: formData.email,
          password: formData.password
        };
        console.log('[AUTH] Register payload:', payload); // debug payload
        const res = await api.post('/api/auth/register', payload);
        console.log('[AUTH] Register response:', res?.status, res?.data); // debug response
        const { token, user } = res.data;
        setAuth(token, user);
        toast.success('Account created — welcome!');
        navigate('/upload');
      }
    } catch (err) {
      // Enhanced error logging for easier diagnosis
      console.error('[AUTH ERROR]', {
        message: err?.message,
        status: err?.response?.status,
        responseData: err?.response?.data,
        stack: err?.stack
      });

      // Prefer structured server message, fall back to full response JSON for debugging
      const serverMsg = err?.response?.data?.error || err?.response?.data?.message;
      const serverDebug = err?.response?.data && typeof err.response.data === 'object'
        ? JSON.stringify(err.response.data)
        : undefined;

      const message = serverMsg || err.message || 'Authentication failed';

      // show both concise message and a developer toast with status + raw body
      toast.error(message);
      if (err?.response?.status) {
        toast('Server: ' + err.response.status + (serverDebug ? ` — ${serverDebug}` : ''), { icon: 'ℹ️' });
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const sendMagic = async () => {
    if (!formData.email) return toast.error('Please enter your email');
    setMagicLoading(true);
    try {
      await api.post('/api/auth/magic-login', { email: formData.email });
      toast.success('Magic link sent — check your email');
    } catch (err) {
      console.error(err);
      const message = err?.response?.data?.error || err.message || 'Failed to send magic link';
      toast.error(message);
    } finally {
      if (mounted.current) setMagicLoading(false);
    }
  };

  const toggleMode = (next) => {
    setMode(next);
    setErrors({});
  };

  const updateFormData = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-900 to-purple-900 p-4 sm:p-6">
      <div className="w-full max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 items-stretch">

          {/* Left marketing / brand column */}
          <aside className="hidden lg:flex lg:flex-col lg:justify-between lg:col-span-2 rounded-3xl p-8 bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl text-white">
            <div>
              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-400 flex items-center justify-center text-white font-extrabold text-xl shadow-xl">
                  CF
                </div>
                <div>
                  <h2 className="text-3xl font-extrabold">CaseFlow</h2>
                  <p className="text-sm opacity-90 mt-1">Professional case management platform</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold mb-3">Why CaseFlow?</h3>
                  <ul className="space-y-3 text-sm">
                    <li className="flex items-start gap-3">
                      <CheckIcon className="mt-0.5 text-green-400" />
                      <span>Lightning-fast CSV imports with real-time validation</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckIcon className="mt-0.5 text-green-400" />
                      <span>Advanced error detection and row-level corrections</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckIcon className="mt-0.5 text-green-400" />
                      <span>Role-based access control and audit trails</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckIcon className="mt-0.5 text-green-400" />
                      <span>Seamless integration with existing workflows</span>
                    </li>
                  </ul>
                </div>

                <div className="bg-white/10 p-6 rounded-2xl border border-white/20">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <SparklesIcon className="w-4 h-4" />
                    Try the demo
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div>Email: <span className="font-semibold text-indigo-300">demo@caseflow.local</span></div>
                    <div>Password: <span className="font-semibold text-indigo-300">demopass</span></div>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Main form card */}
          <main className="lg:col-span-3 bg-white/95 backdrop-blur-md border border-white/20 rounded-3xl p-6 sm:p-8 lg:p-10 shadow-2xl">
            <div className="max-w-md mx-auto">

              {/* Header */}
              <div className="text-center mb-8">
                <div className="flex items-center justify-center gap-4 mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-500 flex items-center justify-center text-white font-extrabold text-lg shadow-lg">
                    CF
                  </div>
                  <div>
                    <h1 className="text-2xl lg:text-3xl font-extrabold text-gray-900">CaseFlow</h1>
                    <p className="text-sm text-gray-600">Import • Review • Act</p>
                  </div>
                </div>
              </div>

              {/* Toggle */}
              <div className="mb-8 flex items-center bg-gray-100 p-1 rounded-2xl w-max mx-auto border border-gray-200">
                <button
                  onClick={() => toggleMode('login')}
                  aria-pressed={mode === 'login'}
                  className={`px-6 py-3 rounded-xl transition-all duration-300 font-medium ${
                    mode === 'login'
                      ? 'bg-white shadow-lg text-indigo-700 scale-105'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Sign in
                </button>
                <button
                  onClick={() => toggleMode('register')}
                  aria-pressed={mode === 'register'}
                  className={`ml-1 px-6 py-3 rounded-xl transition-all duration-300 font-medium ${
                    mode === 'register'
                      ? 'bg-white shadow-lg text-indigo-700 scale-105'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Register
                </button>
              </div>

              {/* Form */}
              <form onSubmit={submit} className="space-y-6">
                {mode === 'register' && (
                  <FloatingInput
                    label="Full name"
                    value={formData.name}
                    onChange={(v) => updateFormData('name', v)}
                    error={errors.name}
                    autoComplete="name"
                    required
                  />
                )}

                <FloatingInput
                  label="Email address"
                  type="email"
                  value={formData.email}
                  onChange={(v) => updateFormData('email', v)}
                  error={errors.email}
                  autoComplete="email"
                  required
                />

                <FloatingInput
                  label="Password"
                  type="password"
                  value={formData.password}
                  onChange={(v) => updateFormData('password', v)}
                  error={errors.password}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />

                {mode === 'register' && (
                  <FloatingInput
                    label="Confirm password"
                    type="password"
                    value={formData.confirm}
                    onChange={(v) => updateFormData('confirm', v)}
                    error={errors.confirm}
                    autoComplete="new-password"
                    required
                  />
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 inline-flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold transform transition-all duration-200 hover:scale-105 hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {loading ? (
                      <SpinnerIcon className="w-5 h-5 animate-spin" />
                    ) : (
                      <ArrowRightIcon className="w-5 h-5" />
                    )}
                    <span>{mode === 'login' ? 'Sign in' : 'Create account'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={sendMagic}
                    disabled={magicLoading}
                    className="px-6 py-4 rounded-2xl bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium transition-colors duration-200 disabled:opacity-60"
                  >
                    {magicLoading ? (
                      <SpinnerIcon className="w-4 h-4 animate-spin mx-auto" />
                    ) : (
                      'Magic link'
                    )}
                  </button>
                </div>

                <div className="text-center text-sm text-gray-600">
                  {mode === 'login' ? (
                    <>
                      Don't have an account?{' '}
                      <button
                        type="button"
                        onClick={() => toggleMode('register')}
                        className="text-indigo-600 font-medium hover:underline transition-colors"
                      >
                        Sign up
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => toggleMode('login')}
                        className="text-indigo-600 font-medium hover:underline transition-colors"
                      >
                        Sign in
                      </button>
                    </>
                  )}
                </div>

                {/* Demo credentials for mobile */}
                <div className="lg:hidden mt-6 bg-gray-50 p-4 rounded-2xl border border-gray-200">
                  <div className="font-medium text-sm mb-2">Demo credentials</div>
                  <div className="text-sm space-y-1">
                    <div>Email: <span className="font-semibold text-indigo-600">demo@caseflow.local</span></div>
                    <div>Password: <span className="font-semibold text-indigo-600">demopass</span></div>
                  </div>
                </div>

              </form>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

// Enhanced FloatingInput with error states and better animations
function FloatingInput({ label, type = 'text', value, onChange, error, required = false, autoComplete }) {
  const [focused, setFocused] = useState(false);
  const hasValue = value !== undefined && value !== null && String(value).length > 0;

  return (
    <div className="relative">
      <label className="relative block">
        <input
          type={type}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder=""
          autoComplete={autoComplete}
          className={`w-full rounded-2xl bg-white border px-4 py-4 text-gray-900 placeholder-transparent focus:outline-none transition-all duration-200 ${
            error
              ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200'
              : 'border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200'
          }`}
        />

        <span
          aria-hidden
          className={
            'absolute left-4 pointer-events-none transform transition-all duration-200 px-1 ' +
            (focused || hasValue
              ? '-top-3 text-xs font-medium bg-white px-2 rounded-md ' +
                (error ? 'text-red-600' : 'text-indigo-700')
              : 'top-1/2 -translate-y-1/2 text-base text-gray-500')
          }
        >
          {label}
        </span>
      </label>

      {error && (
        <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
          <ExclamationIcon className="w-4 h-4" />
          {error}
        </p>
      )}
    </div>
  );
}

// Icon components
function CheckIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SparklesIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}

function SpinnerIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}

function ArrowRightIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

function ExclamationIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  );
}
