import { useState, useRef, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import { parse } from "papaparse";
import api from "../lib/api";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { themeQuartz } from "ag-grid-community";

// Normalize and validate helpers --------------------------------------------------
// Convert priority values from CSV into the numeric representation expected by the DB.
// Rules:
// - numeric strings "1","2","3" -> Number(1|2|3)
// - named values "HIGH" -> 3, "MEDIUM" -> 2, "LOW" -> 1 (case-insensitive)
// - empty / null / undefined -> null
// - unknown values are returned as trimmed string so frontend validation and backend will mark them invalid
function normalizePriority(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  // numeric string -> number
  if (!Number.isNaN(Number(s)) && /^-?\d+$/.test(s)) {
    const n = Number(s);
    // Only accept positive integer priorities 1/2/3 here, otherwise leave as string to be invalid
    if ([1,2,3].includes(n)) return n;
    // if numeric but outside accepted range, return as string so validation flags it
    return s;
  }
  // named mapping (case-insensitive)
  const up = s.toUpperCase();
  if (up === 'HIGH') return 3;
  if (up === 'MEDIUM') return 2;
  if (up === 'LOW') return 1;
  // unknown value -> return original trimmed string so it's shown invalid
  return s;
}

// zodLikeValidation: extend priority handling to accept numeric or named values
const zodLikeValidation = (value, type) => {
  if (!value && value !== 0) return false;
  if (type === "email") return /^\S+@\S+\.\S+$/.test(value);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (type === "phone") return /^(\+91|91)?[6-9]\d{9}$/.test(String(value).replace(/\s/g, ""));
  if (type === "category") return ["TAX", "LICENSE", "PERMIT"].includes(String(value).toUpperCase());

  if (type === "priority") {
    // Accept numeric priorities (1,2,3)
    if (typeof value === 'number') return [1,2,3].includes(value);
    // Accept numeric strings that represent valid numbers (defensive)
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
      const n = Number(value);
      return [1,2,3].includes(n);
    }
    // Accept named priorities
    return ["LOW","MEDIUM","HIGH"].includes(String(value).toUpperCase());
  }

  // Case ID: must be a non-empty trimmed string (allow letters, numbers, dashes, underscores and spaces)
  if (type === "case_id") {
    if (typeof value !== 'string') return false;
    const s = value.trim();
    return s.length > 0;
  }
  
  // Status must match the CaseStatus enum in backend
  if (type === "status") {
    if (!value && value !== 0) return false;
    const up = String(value).toUpperCase().trim();
    return ["NEW", "PROCESSING", "COMPLETED", "FAILED"].includes(up);
  }

  return true;
};

export default function Upload() {
  const [rowData, setRowData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
  // expected DB columns (keep in sync with prisma schema)
  const expectedColumns = ['case_id','applicant_name','dob','email','phone','category','priority','status'];
  const [missingColumns, setMissingColumns] = useState([]);
  const [extraColumns, setExtraColumns] = useState([]);
  const [columnWarningAccepted, setColumnWarningAccepted] = useState(false);
  const [invalidCount, setInvalidCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ totalBatches: 0, completed: 0, success: 0, failed: 0 });

  const gridRef = useRef();
  const inputRef = useRef();
  const navigate = useNavigate();
  const { token } = useAuthStore();

  const validateRow = (row) => {
    let invalid = 0;

    // Explicit check for case_id (required)
    const caseIdKey = Object.keys(row).find(k => k && k.toLowerCase() === 'case_id');
    const caseIdVal = caseIdKey ? row[caseIdKey] : undefined;
    if (!zodLikeValidation(caseIdVal, 'case_id')) invalid++;

    // Explicit check for status (optional but if present must be valid)
    const statusKey = Object.keys(row).find(k => k && k.toLowerCase() === 'status');
    const statusVal = statusKey ? row[statusKey] : undefined;
    // treat empty status as okay (backend will default), but if present validate it
    if (statusVal !== undefined && statusVal !== null && String(statusVal).trim() !== '') {
      if (!zodLikeValidation(statusVal, 'status')) invalid++;
    }

    Object.keys(row).forEach((key) => {
      const value = row[key];
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes("email") && !zodLikeValidation(value, "email")) invalid++;
      if (lowerKey.includes("dob") && !zodLikeValidation(value, "date")) invalid++;
      if (lowerKey.includes("phone") && value && !zodLikeValidation(value, "phone")) invalid++;
      if (lowerKey.includes("category") && !zodLikeValidation(value, "category")) invalid++;
      if (lowerKey.includes("priority") && value !== undefined && value !== null && !zodLikeValidation(value, "priority")) invalid++;
    });
    return invalid > 0;
  };

  const updateInvalidCount = () => {
    if (!gridRef.current?.api) return;
    let count = 0;
    gridRef.current.api.forEachNode((node) => {
      if (validateRow(node.data)) count++;
    });
    setInvalidCount(count);
  };

  const onGridReady = (params) => {
    updateInvalidCount();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0] || e.dataTransfer.files[0];
    if (!file) return;

    parse(file, {
      header: true,
      complete: (results) => {
        const parsedHeaders = (results.meta && results.meta.fields) ? results.meta.fields : (results.data[0] ? Object.keys(results.data[0]) : []);
        // compute mismatch
        const missing = expectedColumns.filter((c) => !parsedHeaders.includes(c));
        const extra = parsedHeaders.filter((c) => !expectedColumns.includes(c));
        setMissingColumns(missing);
        setExtraColumns(extra);
        // reset acknowledgement when new file loaded
        setColumnWarningAccepted(false);

        // Normalize rows: apply normalizePriority to the priority column so frontend and backend
        // consistently see numeric priority values where possible.
        // Keep invalid values as strings so they are flagged by validation.
        const normalizedRows = results.data.map((row) => {
          // Make a shallow copy so we don't mutate papaparse internals
          const r = { ...row };
          if ('priority' in r) {
            r.priority = normalizePriority(r.priority);
          } else {
            // try case-insensitive header names if CSV uses different casing
            const key = Object.keys(r).find(k => k && k.toLowerCase() === 'priority');
            if (key) r[key] = normalizePriority(r[key]);
          }
          return r;
        });

        const cols = (normalizedRows[0] ? Object.keys(normalizedRows[0]) : parsedHeaders).map((key) => ({
          field: key,
          editable: true,
          cellClassRules: {
            "bg-red-200": (params) => {
              const val = params.value;
              const field = params.colDef.field.toLowerCase();
              if (field.includes("email")) return val && !zodLikeValidation(val, "email");
              if (field.includes("dob")) return val && !zodLikeValidation(val, "date");
              if (field.includes("phone")) return val && !zodLikeValidation(val, "phone");
              if (field.includes("category")) return val && !zodLikeValidation(val, "category");
              if (field.includes("priority")) return val && !zodLikeValidation(val, "priority");
              return false;
            },
          },
        }));
        setColumnDefs(cols);
        // use normalized rows for display and submit
        setRowData(normalizedRows);
        toast.success("CSV loaded – check red cells!");
      },
    });
  };

  // UI helper to render column mismatch banner
  function ColumnMismatchBanner() {
    if (!missingColumns.length && !extraColumns.length) return null;
    return (
      <div className="mb-4 p-4 border rounded bg-yellow-50 border-yellow-300">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-semibold text-yellow-800">Column mismatch detected</div>
            <div className="text-sm text-yellow-700 mt-1">The uploaded file headers do not match the database columns. Some data may be lost or not imported.</div>
            <div className="mt-2 text-sm">
              {missingColumns.length > 0 && <div><strong>Missing columns:</strong> {missingColumns.join(', ')}</div>}
              {extraColumns.length > 0 && <div className="mt-1"><strong>Extra columns:</strong> {extraColumns.join(', ')}</div>}
            </div>
            <div className="mt-2 text-xs text-gray-600">Tip: rename CSV headers to match database columns to ensure a safe import.</div>
          </div>
          <div className="ml-4 flex flex-col items-end gap-2">
            {!columnWarningAccepted ? (
              <>
                <button onClick={() => setColumnWarningAccepted(true)} className="px-3 py-1 bg-yellow-600 text-white rounded">Proceed anyway</button>
                <button onClick={() => { setRowData([]); setColumnDefs([]); setMissingColumns([]); setExtraColumns([]); }} className="px-3 py-1 bg-gray-100 rounded text-sm">Discard file</button>
              </>
            ) : (
              <div className="text-sm text-green-700">Acknowledged — you may proceed</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const fixAll = (type) => {
    const updated = rowData.map((row) => {
      const newRow = { ...row };
      Object.keys(row).forEach((key) => {
        if (type === "trim") newRow[key] = row[key]?.trim() || row[key];
        if (type === "title" && key.toLowerCase().includes("name"))
          newRow[key] = row[key]?.replace(/\b\w/g, (c) => c.toUpperCase());
        // Only apply phone normalization to columns whose key includes "phone"
        if (type === "phone" && key.toLowerCase().includes("phone") && row[key]) {
          const digits = row[key].toString().replace(/\D/g, "");
          const last10 = digits.slice(-10);
          newRow[key] = last10 ? `+91${last10}` : row[key];
        }
        // Only update columns that appear to be the priority column
        if (type === "priority" && key.toLowerCase().includes("priority")) {
          newRow[key] = "LOW";
        }
      });
      return newRow;
    });
    setRowData(updated);
    toast.success("Applied to all rows!");
  };

  // helper to chunk array on frontend
  const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
  };

  const submitBatch = async () => {
    if (!columnWarningAccepted && (missingColumns.length > 0 || extraColumns.length > 0)) {
      return toast.error('Please review column mismatch and "Proceed anyway" or fix headers.');
    }
    if (invalidCount > 0) {
      return toast.error("Fix all red cells first!");
    }

    const batchSize = 100;
    const batches = chunkArray(rowData, batchSize);
    const totalBatches = batches.length;
    if (totalBatches === 0) return toast.error('No rows to upload');

    setUploading(true);
    setUploadProgress({ totalBatches, completed: 0, success: 0, failed: 0 });

    // single toast that we'll update
    const toastId = toast.loading(`Uploading 0/${totalBatches} batches...`, { duration: Infinity });

    const concurrency = 4; // tune this (4 is a reasonable default)
    let pointer = 0;
    let successCount = 0;
    let failCount = 0;

    try {
      while (pointer < totalBatches) {
        const window = batches.slice(pointer, pointer + concurrency);
        const promises = window.map((batch) =>
          api.post('/api/cases/batch', batch).then(
            (res) => ({ ok: true, res }),
            (err) => ({ ok: false, err })
          )
        );

        const results = await Promise.all(promises);

        // update counts
        for (const r of results) {
          if (r.ok) {
            successCount += 1 * batchSize; // approximate: count rows as batchSize (backend may reject partial rows)
          } else {
            failCount += 1 * batchSize;
            console.error('Batch error detail:', r.err?.response?.data || r.err?.message || r.err);
          }
        }

        pointer += concurrency;
        const completed = Math.min(pointer, totalBatches);
        setUploadProgress((p) => ({ ...p, completed, success: successCount, failed: failCount }));
        // update toast message in-place
        toast(`Uploading ${completed}/${totalBatches} batches...`, { id: toastId, duration: Infinity });
      }

      // final summary - refine counts: if you prefer exact row-level success, adjust backend to return counts per batch
      // Dismiss the loading toast and show a timed success toast so it does not persist across refresh/navigation
      toast.dismiss(toastId);
      toast.success(`Upload complete — approx success: ${successCount} rows, failed: ${failCount} rows`, { duration: 3000 });

      // optional: clear data after successful upload
      setRowData([]);
      setColumnDefs([]);
      setMissingColumns([]);
      setExtraColumns([]);
      setColumnWarningAccepted(false);
      setInvalidCount(0);
      navigate('/cases');
    } catch (err) {
      console.error('Upload error:', err);
      // Ensure the loading toast is dismissed, then show an error toast that auto-hides
      toast.dismiss(toastId);
      toast.error('Upload failed — check console for details', { duration: 7000 });
    } finally {
      setUploading(false);
      setUploadProgress((p) => ({ ...p, completed: p.totalBatches }));
      // Defensive: ensure any lingering loading toast is removed
      try { toast.dismiss(toastId); } catch (e) {}
      // allow final toast to be visible then dismiss if needed
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Upload CSV</h1>

      {/* Column mismatch warning */}
      <ColumnMismatchBanner />

      {/* Drag & Drop */}
      <div
        onDrop={handleFileUpload}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current.click()}
        className="border-4 border-dashed border-gray-400 rounded-xl p-16 text-center mb-6 cursor-pointer hover:border-blue-500"
      >
        <p className="text-xl">Drop CSV here or click</p>
        <input ref={inputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
      </div>

      {/* Toolbar */}
      {rowData.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3 items-center">
          <button onClick={() => fixAll("trim")} className="bg-blue-600 text-white px-4 py-2 rounded">
            Trim All Whitespace
          </button>
          <button onClick={() => fixAll("title")} className="bg-green-600 text-white px-4 py-2 rounded">
            Title Case Names
          </button>
          <button onClick={() => fixAll("phone")} className="bg-purple-600 text-white px-4 py-2 rounded">
            Add +91 to Phones
          </button>
          <button onClick={() => fixAll("priority")} className="bg-orange-600 text-white px-4 py-2 rounded">
            Set Priority = LOW
          </button>

          <div className="ml-auto text-lg font-semibold">
            Valid: {rowData.length - invalidCount} | Invalid: <span className="text-red-600">{invalidCount}</span>
          </div>

          <button
            onClick={submitBatch}
            disabled={invalidCount > 0}
            className={`ml-4 px-8 py-3 text-white text-xl rounded ${invalidCount > 0 ? "bg-gray-400" : "bg-green-700 hover:bg-green-800"}`}
          >
            Submit to Database
          </button>
        </div>
      )}

      {/* AG Grid */}
      <div className="h-96">
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          onGridReady={onGridReady}
          onCellValueChanged={() => setTimeout(updateInvalidCount, 100)}
          domLayout="normal"
          theme={themeQuartz}
        />
      </div>
    </div>
  );
}