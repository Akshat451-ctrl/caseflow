import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';

export default function Reports() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const currentUser = useAuthStore((s) => s.user);

  // Helper: determine if current user can delete a given import log
  const canDeleteLog = (log) => {
    if (!currentUser) return false;
    const curId = String(currentUser.id ?? currentUser.userId ?? '');
    const curEmail = String(currentUser.email ?? '').toLowerCase();
    const role = String(currentUser.role ?? '').toUpperCase();
    const ownerId = String(log.user?.id ?? log.userId ?? '');
    const ownerEmail = String(log.user?.email ?? '').toLowerCase();
    return role === 'ADMIN' || (curId && ownerId && curId === ownerId) || (curEmail && ownerEmail && curEmail === ownerEmail);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await api.get('/api/import-logs');
      setLogs(res.data.importLogs || []);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  // Delete import log (with confirmation)
  const deleteLog = async (id) => {
    if (!window.confirm('Delete this import report and its failed rows? This cannot be undone.')) return;
    try {
      await api.delete(`/api/import-logs/${id}`);
      toast.success('Import report deleted');
      // refresh list
      fetchLogs();
    } catch (err) {
      console.error('Failed to delete import log:', err);
      if (err?.response?.status === 403) {
        const msg = err.response.data?.message || 'You are not allowed to delete this import';
        toast.error(msg);
      } else {
        toast.error(err?.response?.data?.error || 'Delete failed');
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading reports...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Import Reports</h1>
      {logs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500">No import reports yet.</p>
          <Link to="/upload" className="text-indigo-600 hover:underline">Upload a CSV to get started</Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {logs.map((log) => (
            <div key={log.id} className="bg-white border rounded-lg p-4 shadow">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-semibold">Import #{log.id}</h2>
                  {log.user?.email && <div className="text-sm text-gray-500">Owner: <span className="font-medium">{log.user.email}</span></div>}
                  <p className="text-sm text-gray-600">Created: {new Date(log.createdAt).toLocaleString()}</p>
                  <p className="text-sm">Total rows: {log.totalRows}, Success: {log.successCount}, Failed: {log.failCount}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <Link
                    to={`/import-report/${log.id}`}
                    className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                  >
                    View Details
                  </Link>
                  {/* Only show Delete if current user is the owner or an ADMIN */}
                  {canDeleteLog(log) ? (
                    <button
                      onClick={() => deleteLog(log.id)}
                      className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded hover:from-red-600 hover:to-rose-700 shadow-md transform hover:-translate-y-0.5 transition"
                      title="Delete import and failed rows"
                    >
                      Delete
                    </button>
                  ) : (
                    <div className="px-4 py-2 text-sm text-gray-400 rounded border border-gray-100" title="Only import owner or admin can delete">Delete</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}