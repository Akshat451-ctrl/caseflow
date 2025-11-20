import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { AgGridReact } from 'ag-grid-react';
import { toast } from 'react-hot-toast';
import Papa from 'papaparse';

export default function ImportReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [log, setLog] = useState(null);
  const [failedRows, setFailedRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get(`/api/import-logs/${id}`)
      .then((res) => {
        setLog(res.data.importLog);
        setFailedRows(res.data.failedRows || []);
      })
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load import report');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const total = log ? log.totalRows : 0;
  const success = log ? log.successCount : 0;
  const failed = log ? log.failCount : failedRows.length;

  const percent = total > 0 ? Math.round((success / total) * 100) : 0;

  const columnDefs = useMemo(() => [
    { field: 'case_id', headerName: 'Case ID', flex: 1 },
    { field: 'applicant_name', headerName: 'Name', flex: 1 },
    { field: 'email', headerName: 'Email', flex: 1 },
    { field: 'phone', headerName: 'Phone', flex: 1 },
    { field: 'category', headerName: 'Category', flex: 1 },
    { field: 'priority', headerName: 'Priority', flex: 1 },
    { field: 'errorMessage', headerName: 'Error', flex: 1 },
  ], []);

  function downloadCSV() {
    if (!failedRows || failedRows.length === 0) return toast('No failed rows to download');
    const csv = Papa.unparse(failedRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-${id}-failed.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Enhanced success card */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Import Report</h1>
            {log && (
              <p className="text-sm text-gray-600">Imported at: {new Date(log.createdAt).toLocaleString()}</p>
            )}
          </div>
          <div className="flex items-center space-x-6">
            <div className="text-center">
              <div className="text-sm text-gray-500">Total</div>
              <div className="text-xl font-semibold">{total}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-500">Success</div>
              <div className="text-xl font-semibold text-green-600">{success}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-500">Failed</div>
              <div className="text-xl font-semibold text-red-600">{failed}</div>
            </div>
            <div className="w-24 h-24">
              <svg viewBox="0 0 36 36" className="w-24 h-24">
                <path className="text-gray-200" d="M18 2.0845a15.9155 15.9155 0 1 0 0 31.831A15.9155 15.9155 0 1 0 18 2.0845" fill="none" stroke="#e5e7eb" strokeWidth="4" />
                <path className="text-green-500" d="M18 2.0845a15.9155 15.9155 0 1 0 0 31.831A15.9155 15.9155 0 1 0 18 2.0845" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset="25" />
                <text x="18" y="20.35" className="text-sm" textAnchor="middle" fill="#111827">{percent}%</text>
              </svg>
            </div>
          </div>
        </div>

        {/* Failed rows table and actions */}
        <div className="bg-white p-4 rounded shadow mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium">Failed Rows</h2>
            <div className="flex space-x-2">
              <button onClick={downloadCSV} className="px-3 py-1 bg-indigo-600 text-white rounded">Download Failed Rows as CSV</button>
            </div>
          </div>

          <div className="ag-theme-alpine" style={{ height: 400, width: '100%' }}>
            <AgGridReact rowData={failedRows} columnDefs={columnDefs} domLayout="normal" />
          </div>
        </div>

        {/* Navigation buttons */}
        <div className="flex space-x-4">
          <button onClick={() => navigate('/cases')} className="px-4 py-2 bg-gray-200 rounded">Back to cases</button>
          <button onClick={() => navigate('/upload')} className="px-4 py-2 bg-gray-200 rounded">Import Again</button>
        </div>
      </div>
    </div>
  );
}
