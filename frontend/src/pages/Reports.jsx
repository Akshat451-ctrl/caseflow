import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'react-hot-toast';

export default function Reports() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

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
      toast.error(err?.response?.data?.error || 'Delete failed');
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
                  <button
                    onClick={() => deleteLog(log.id)}
                    className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded hover:from-red-600 hover:to-rose-700 shadow-md transform hover:-translate-y-0.5 transition"
                    title="Delete import and failed rows"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}