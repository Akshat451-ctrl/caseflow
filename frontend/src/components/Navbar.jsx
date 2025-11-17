import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function Navbar() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();

  const logout = () => {
    clearAuth();
    navigate('/login');
  };

  return (
    <nav className="bg-white border-b shadow-sm">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex justify-between items-center h-14">
          <div className="flex items-center space-x-4">
            <Link to="/upload" className="text-indigo-600 font-semibold">CaseFlow</Link>
            <Link to="/upload" className="text-gray-700 hover:text-gray-900">Upload</Link>
            <Link to="/cases" className="text-gray-700 hover:text-gray-900">Cases</Link>
          </div>
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                <span className="text-sm text-gray-700">{user.email}</span>
                <span className="px-2 py-1 text-xs bg-gray-100 rounded">{user.role}</span>
                <button onClick={logout} className="text-sm text-red-600">Logout</button>
              </>
            ) : (
              <Link to="/login" className="text-sm text-indigo-600">Sign in</Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
