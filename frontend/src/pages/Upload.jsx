import { useState, useRef, useMemo, useEffect } from 'react';
import Papa from 'papaparse';
import api from '../lib/api';
import { AgGridReact } from 'ag-grid-react';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

// Small Zod schema for validating a single case row
const caseSchema = z.object({
  case_id: z.string().min(1, 'case_id is required'),
  applicant_name: z.string().optional().nullable(),
  dob: z.string().optional().nullable(),
  email: z.string().email('Invalid email').optional().nullable(),
  phone: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  priority: z.preprocess((v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }, z.number().int().nullable()).optional(),
});

// Helpers
const validateRow = (row) => {
  const result = caseSchema.safeParse(row);
  if (result.success) return { valid: true, errors: {} };
  const errObj = {};
  result.error.errors.forEach((e) => {
    const key = e.path[0] || '_row';
    errObj[key] = e.message;
  });
  return { valid: false, errors: errObj };
};

const titleCase = (s) => {
  if (!s) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
};


const Upload = () => {
  const [file, setFile] = useState(null);
  const [gridData, setGridData] = useState([]); // rows with __errors and __valid
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [validCount, setValidCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const gridApiRef = useRef(null);
  const navigate = useNavigate();

  // Cell renderer to show value and inline error message
  const ErrorCellRenderer = (props) => {
    const field = props.colDef.field;
    const value = props.value;
    const row = props.data || {};
    const error = row.__errors && row.__errors[field];
    return (
      <div>
        <div>{value ?? ''}</div>
        {error && <div className="text-red-600 text-xs mt-1">{error}</div>}
      </div>
    );
  };

  const columnDefs = [
    { field: 'case_id', headerName: 'Case ID', flex: 1, editable: true, cellRenderer: ErrorCellRenderer, cellClassRules: { 'invalid-cell': (params) => !!params.data?.__errors?.case_id } },
    { field: 'applicant_name', headerName: 'Name', flex: 1, editable: true, cellRenderer: ErrorCellRenderer, cellClassRules: { 'invalid-cell': (params) => !!params.data?.__errors?.applicant_name } },
    { field: 'dob', headerName: 'DOB', flex: 1, editable: true, cellRenderer: ErrorCellRenderer, cellClassRules: { 'invalid-cell': (params) => !!params.data?.__errors?.dob } },
    { field: 'email', headerName: 'Email', flex: 1, editable: true, cellRenderer: ErrorCellRenderer, cellClassRules: { 'invalid-cell': (params) => !!params.data?.__errors?.email } },
    { field: 'phone', headerName: 'Phone', flex: 1, editable: true, cellRenderer: ErrorCellRenderer, cellClassRules: { 'invalid-cell': (params) => !!params.data?.__errors?.phone } },
    { field: 'category', headerName: 'Category', flex: 1, editable: true, cellRenderer: ErrorCellRenderer, cellClassRules: { 'invalid-cell': (params) => !!params.data?.__errors?.category } },
    { field: 'priority', headerName: 'Priority', flex: 1, editable: true, cellRenderer: ErrorCellRenderer, cellClassRules: { 'invalid-cell': (params) => !!params.data?.__errors?.priority } },
    { field: '__status', headerName: 'Status', width: 120, valueGetter: (params) => (params.data && params.data.__valid ? '✅ Valid' : '❌ Invalid') },
  ];

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Map rows and validate
        const mapped = results.data.map((r) => {
          const cleaned = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
          const { valid, errors } = validateRow(cleaned);
          return { ...cleaned, __valid: valid, __errors: errors };
        });
        setGridData(mapped);
        toast.success(`Parsed ${mapped.length} rows`);
      },
      error: () => toast.error('Failed to parse CSV'),
    });
  };

  useEffect(() => {
    const v = gridData.filter((r) => r.__valid).length;
    const iv = gridData.length - v;
    setValidCount(v);
    setInvalidCount(iv);
  }, [gridData]);

  const handleCellValueChanged = (params) => {
    const row = params.data;
    // revalidate this row
    const cleaned = Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith('__')).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    const { valid, errors } = validateRow(cleaned);
    const newRow = { ...cleaned, __valid: valid, __errors: errors };

    setGridData((prev) => prev.map((r) => (r === row ? newRow : r)));
  };

  const handleUpload = async () => {
    if (gridData.length === 0) return toast.error('No data to upload');
    if (invalidCount > 0) return toast.error('Fix invalid rows before uploading');

    setUploading(true);
    setProgress(0);
    try {
      const payload = gridData.map(({ __errors, __valid, __status, ...rest }) => rest);
      const res = await api.post('/api/cases/batch', payload, {
        onUploadProgress: (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });

      const { totalRows, successCount, failCount, importLogId } = res.data;
      toast.success(`Import complete: ${successCount}/${totalRows} succeeded, ${failCount} failed`);
      if (importLogId) {
        setTimeout(() => navigate(`/import-report/${importLogId}`), 800);
      } else {
        setTimeout(() => navigate('/cases'), 800);
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  // Toolbar fixes
  const fixTrim = () => {
    setGridData((prev) => prev.map((r) => {
      const fixed = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
      const { valid, errors } = validateRow(fixed);
      return { ...fixed, __valid: valid, __errors: errors };
    }));
  };

  const fixTitleNames = () => {
    setGridData((prev) => prev.map((r) => {
      const name = r.applicant_name ? titleCase(String(r.applicant_name)) : r.applicant_name;
      const fixed = { ...r, applicant_name: name };
      const { valid, errors } = validateRow(fixed);
      return { ...fixed, __valid: valid, __errors: errors };
    }));
  };

  const fixPhoneNormalize = () => {
    setGridData((prev) => prev.map((r) => {
      let phone = r.phone ? String(r.phone).trim() : '';
      if (phone && !phone.startsWith('+')) {
        // basic: if 10 digits, prefix +91
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 10) phone = `+91${digits}`;
      }
      const fixed = { ...r, phone };
      const { valid, errors } = validateRow(fixed);
      return { ...fixed, __valid: valid, __errors: errors };
    }));
  };

  const markAllValid = () => {
    setGridData((prev) => prev.map((r) => ({ ...r, __valid: true, __errors: {} })));
  };

  return (
    <>
      
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">Upload Cases (CSV)</h1>

          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none"
            />
            {file && (
              <p className="mt-2 text-sm text-green-600">
                Selected: <strong>{file.name}</strong>
              </p>
            )}
          </div>

          {gridData.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex space-x-2">
                  <button onClick={fixTrim} className="px-3 py-1 bg-gray-200 rounded">Fix All → Trim whitespace</button>
                  <button onClick={fixTitleNames} className="px-3 py-1 bg-gray-200 rounded">Fix All → Title case names</button>
                  <button onClick={fixPhoneNormalize} className="px-3 py-1 bg-gray-200 rounded">Fix All → Normalize phone (+91)</button>
                  <button onClick={markAllValid} className="px-3 py-1 bg-gray-200 rounded">Mark all valid</button>
                </div>
                <div className="text-sm">
                  <span className="mr-4">Valid: <strong className="text-green-600">{validCount}</strong></span>
                  <span>Invalid: <strong className="text-red-600">{invalidCount}</strong></span>
                </div>
              </div>

              <div
                className="ag-theme-alpine"
                style={{ height: 500, width: '100%' }}
              >
                <AgGridReact
                  rowData={gridData}
                  columnDefs={columnDefs}
                  domLayout="normal"
                  onGridReady={(params) => { gridApiRef.current = params.api; }}
                  editType="fullRow"
                  onCellValueChanged={handleCellValueChanged}
                  defaultColDef={{ resizable: true, sortable: true }}
                  getRowNodeId={(data) => data.case_id || Math.random().toString(36).slice(2, 9)}
                />
              </div>

              <div className="mt-6">
                <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                  <div className="bg-green-600 h-3 rounded-full" style={{ width: `${progress}%` }} />
                </div>
                <button
                  onClick={handleUpload}
                  disabled={uploading || invalidCount > 0}
                  className={`px-6 py-2 font-medium text-white rounded-md ${
                    uploading || invalidCount > 0 ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {uploading ? 'Uploading...' : 'Upload to Server'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default Upload;