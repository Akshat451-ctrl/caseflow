import axios from 'axios';
import { toast } from 'react-hot-toast';
import { useAuthStore } from '../store/authStore'; // used for programmatic logout

// FINAL FIX - NO MORE LOCALHOST - 100% LIVE BACKEND
// const BACKEND_URL = import.meta.env.VITE_API_URL || 'https://caseflow-1-i13x.onrender.com';

const BACKEND_URL = 'https://caseflow-1-i13x.onrender.com';
//const BACKEND_URL = 'http://localhost:5000';
console.log('FRONTEND CONNECTING TO →', BACKEND_URL);

// Quick workaround: disable `withCredentials` so browsers don't require
// Access-Control-Allow-Origin to be exact when credentials are sent.
// Only do this if your auth does NOT rely on cookies. You use Bearer tokens
// saved in localStorage, so this is safe for testing.
const api = axios.create({
  baseURL: BACKEND_URL,
  withCredentials: false,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {}
  return config;
});

api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    try {
      if (err?.response?.status === 401) {
        // Clear auth from store (which also clears localStorage and cancels timers)
        try {
          useAuthStore.getState().clearAuth();
        } catch (e) {
          // fallback: clear localStorage
          try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch(_) {}
        }
        const isLogin = window.location.pathname.startsWith('/login');
        if (!isLogin) {
          toast.error('Session expired, please login again');
          // redirect immediately to login
          window.location.href = '/login';
        }
      }
    } catch (e) {}
    return Promise.reject(err);
  }
);

export default api;