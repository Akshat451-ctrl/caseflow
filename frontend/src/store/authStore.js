import { create } from 'zustand';

let logoutTimer = null;

function parseJwt(token) {
	// decode payload without external libs (base64url)
	try {
		const parts = token.split('.');
		if (parts.length < 2) return null;
		const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const json = decodeURIComponent(
			atob(payload)
				.split('')
				.map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
				.join('')
		);
		return JSON.parse(json);
	} catch (e) {
		return null;
	}
}

function scheduleAutoLogout(token) {
	try {
		// clear any existing timer
		if (logoutTimer) {
			clearTimeout(logoutTimer);
			logoutTimer = null;
		}
		const payload = parseJwt(token);
		if (!payload || !payload.exp) return;
		const expiresAt = payload.exp * 1000;
		const ms = expiresAt - Date.now();
		if (ms <= 0) {
			// already expired -> immediate cleanup
			localStorage.removeItem('token');
			localStorage.removeItem('user');
			window.location.href = '/login';
			return;
		}
		logoutTimer = setTimeout(() => {
			try {
				// ensure consistent cleanup
				localStorage.removeItem('token');
				localStorage.removeItem('user');
			} catch (e) {}
			// navigate to login (hard redirect ensures state reset)
			window.location.href = '/login';
		}, ms);
	} catch (e) {
		// ignore scheduling errors
	}
}

export const useAuthStore = create((set) => ({
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  user: typeof window !== 'undefined' && localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null,
  setAuth: (token, user) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    } catch (e) {}
    // schedule auto logout
    scheduleAutoLogout(token);
    set({ token, user });
  },
  clearAuth: () => {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch (e) {}
    if (logoutTimer) {
      clearTimeout(logoutTimer);
      logoutTimer = null;
    }
    set({ token: null, user: null });
  },
  isAuthenticated: () => !!(typeof window !== 'undefined' && localStorage.getItem('token')),
}));

// On module load, if there's a token schedule auto-logout
if (typeof window !== 'undefined') {
  const initialToken = localStorage.getItem('token');
  if (initialToken) scheduleAutoLogout(initialToken);
}
