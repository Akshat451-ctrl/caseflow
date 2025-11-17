import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
// register the AllCommunityModule so AG Grid can initialise
ModuleRegistry.registerModules([AllCommunityModule]);
import { toast } from 'react-hot-toast';

export default function Cases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);

  const columnDefs = useMemo(() => [
    { field: 'case_id', headerName: 'Case ID', flex: 1 },
    { field: 'applicant_name', headerName: 'Name', flex: 1 },
    { field: 'dob', headerName: 'DOB', flex: 1 },
    { field: 'email', headerName: 'Email', flex: 1 },
    { field: 'phone', headerName: 'Phone', flex: 1 },
    { field: 'category', headerName: 'Category', flex: 1 },
    { field: 'priority', headerName: 'Priority', flex: 1 },
    { field: 'status', headerName: 'Status', flex: 1 },
  ], []);

  const load = async (nextCursor = null) => {
    setLoading(true);
    try {
      const params = { limit: 50 };
      if (nextCursor) params.cursor = nextCursor;
      const res = await api.get('/api/cases', { params });
      const data = res.data;
      if (Array.isArray(data.items)) {
        setCases((s) => [...s, ...data.items]);
        setCursor(data.nextCursor || null);
        setHasMore(!!data.nextCursor);
      } else {
        toast.error('Unexpected response from server');
        console.warn('Unexpected /api/cases response', data);
      }
    } catch (err) {
      console.error('Failed to load cases', err);
      const status = err?.response?.status;
      if (status === 401) {
        toast.error('Not authenticated — redirecting to login');
        setTimeout(() => window.location.replace('/login'), 700);
        return;
      }
      if (status === 404) {
        toast.error('Cases endpoint not found (404). Is the backend running on port 5000?');
        return;
      }

      toast.error(err?.response?.data?.error || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Cases</h1>

        <div className="bg-white p-4 rounded shadow">
          <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
            <AgGridReact rowData={cases} columnDefs={columnDefs} domLayout="normal" />
          </div>

          <div className="mt-4 flex justify-between items-center">
            <div>
              {hasMore ? (
                <button onClick={() => load(cursor)} className="px-4 py-2 bg-indigo-600 text-white rounded">Load more</button>
              ) : (
                <span className="text-sm text-gray-500">No more results</span>
              )}
            </div>
            <div>
              <a href="#" onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(JSON.stringify(cases.slice(0,50))); toast.success('Copied sample to clipboard'); }} className="text-sm text-indigo-600">Copy sample JSON</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
