import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function Navbar() {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  function logout() {
    clearAuth();
    navigate('/login');
  }

  const LinkItem = ({ to, children }) => (
    <Link
      to={to}
      className="px-3 py-2 rounded-md text-sm font-medium text-white transition transform hover:scale-105 hover:shadow-xl hover:shadow-yellow-400/30"
    >
      {children}
    </Link>
  );

  return (
    <nav className="bg-gradient-to-r from-indigo-700 via-purple-700 to-pink-700 shadow-2xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: Logo */}
          <div className="flex items-center gap-4">
            <Link to="/upload" className="flex items-center gap-3">
              <div className="text-white font-extrabold text-lg sm:text-2xl tracking-tight">CaseFlow</div>
              <div className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-semibold flex items-center">Pro</div>
            </Link>

            {/* Desktop links */}
            <div className="hidden md:flex items-center ml-6 space-x-1">
              <LinkItem to="/upload">Upload CSV</LinkItem>
              <LinkItem to="/cases">Cases</LinkItem>
              <LinkItem to="/import-reports">Reports</LinkItem>
            </div>
          </div>

          {/* Right: user area */}
          <div className="hidden md:flex items-center gap-4">
            <div className="text-white text-sm">Welcome{user?.email ? ',' : ''} <span className="font-semibold">{user?.email}</span></div>
            <button
              onClick={logout}
              className="ml-2 px-3 py-2 bg-red-600 text-white rounded-md font-medium transform transition-transform duration-150 hover:scale-105 hover:bg-red-700 shadow-md"
            >
              Logout
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden">
            <button
              onClick={() => setOpen((s) => !s)}
              className="inline-flex items-center justify-center p-2 rounded-md text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white"
            >
              <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {open ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="md:hidden px-2 pt-2 pb-3 space-y-1 bg-gradient-to-r from-indigo-700 via-purple-700 to-pink-700">
          <Link to="/upload" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-base font-medium text-white hover:shadow-xl hover:shadow-yellow-400/30">Upload CSV</Link>
          <Link to="/cases" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-base font-medium text-white hover:shadow-xl hover:shadow-yellow-400/30">Cases</Link>
          <Link to="/import-reports" onClick={() => setOpen(false)} className="block px-3 py-2 rounded-md text-base font-medium text-white hover:shadow-xl hover:shadow-yellow-400/30">Reports</Link>

          <div className="border-t border-white/20 mt-2 pt-2">
            <div className="px-3 py-2 text-white text-sm">Welcome{user?.email ? ',' : ''} <span className="font-semibold">{user?.email}</span></div>
            <div className="px-3 py-2">
              <button onClick={() => { setOpen(false); logout(); }} className="w-full px-3 py-2 bg-red-600 text-white rounded-md font-medium hover:scale-105 transform transition">Logout</button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
