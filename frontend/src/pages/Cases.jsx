import React, { useEffect, useState, useMemo } from 'react';
import api from '../lib/api';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
// register the AllCommunityModule so AG Grid can initialise
ModuleRegistry.registerModules([AllCommunityModule]);
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function Cases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState({ category: '', priority: '', search: '' });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const navigate = useNavigate();
  const { token } = useAuthStore();

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

  const load = async (nextPage = 1) => {
    setLoading(true);
    try {
      const params = {
        limit: 50,
        page: nextPage,
        category: filters.category,
        priority: filters.priority,
        search: filters.search,
      };
      const res = await api.get('/api/cases', { params, headers: { Authorization: `Bearer ${token}` } });
      const data = res.data;
      if (Array.isArray(data.items)) {
        setCases(data.items);
        setPage(nextPage);
        setTotalPages(data.totalPages);
      } else {
        toast.error('Unexpected response from server');
        console.warn('Unexpected /api/cases response', data);
      }
    } catch (err) {
      console.error('Failed to load cases', err);
      toast.error(err?.response?.data?.error || 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const onRowClicked = (row) => {
    navigate(`/cases/${row.data.case_id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Cases</h1>

        <div className="bg-white p-4 rounded shadow mb-4">
          <div className="grid grid-cols-3 gap-4 mb-4">
            <select
              name="category"
              value={filters.category}
              onChange={handleFilterChange}
              className="border border-gray-300 rounded p-2"
            >
              <option value="">All Categories</option>
              <option value="TAX">TAX</option>
              <option value="LICENSE">LICENSE</option>
            </select>

            <select
              name="priority"
              value={filters.priority}
              onChange={handleFilterChange}
              className="border border-gray-300 rounded p-2"
            >
              <option value="">All Priorities</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>

            <input
              type="text"
              name="search"
              value={filters.search}
              onChange={handleFilterChange}
              placeholder="Search by Case ID or Name"
              className="border border-gray-300 rounded p-2"
            />
          </div>

          <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
            <AgGridReact
              rowData={cases}
              columnDefs={columnDefs}
              domLayout="normal"
              onRowClicked={onRowClicked}
              defaultColDef={{ resizable: true, sortable: true }}
            />
          </div>

          <div className="mt-4 flex justify-between items-center">
            <button
              onClick={() => load(page - 1)}
              disabled={page === 1}
              className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
            >
              Previous
            </button>

            <span>Page {page} of {totalPages}</span>

            <button
              onClick={() => load(page + 1)}
              disabled={page === totalPages}
              className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
