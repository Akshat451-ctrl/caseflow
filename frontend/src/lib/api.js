import axios from 'axios';
import { toast } from 'react-hot-toast';

const api = axios.create({
 baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
  headers: { 'Content-Type': 'application/json' },
});

// Attach token from localStorage for each request
api.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    // ignore
  }
  return config;
});

// Global response interceptor: handle 401 / token expiry centrally
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    try {
      const status = err?.response?.status;
      const data = err?.response?.data;
      // If unauthorized, clear stored token and redirect to login
      if (status === 401) {
        // Avoid infinite redirect loop if already on /login
        const isLogin = window.location.pathname.startsWith('/login');
        localStorage.removeItem('token');
        if (!isLogin) {
          toast.error(data?.error || data?.message || 'Session expired, please login again');
          // small delay so toast shows
          setTimeout(() => { window.location.href = '/login'; }, 600);
        }
      }
    } catch (e) {
      // ignore
    }
    return Promise.reject(err);
  }
);

export default api;
