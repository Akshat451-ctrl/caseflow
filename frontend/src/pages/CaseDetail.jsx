import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'react-hot-toast';

export default function CaseDetail() {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit mode + form state for inline editing
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    applicant_name: '',
    email: '',
    phone: '',
    category: '',
    priority: '',
  });

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    api.get(`/api/cases/${caseId}`)
      .then((res) => setData(res.data))
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load case');
      })
      .finally(() => setLoading(false));
  }, [caseId]);

  // populate form when data loads or changes
  useEffect(() => {
    if (!data || !data.case) return;
    const c = data.case;
    setForm({
      applicant_name: c.applicant_name ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      category: c.category ?? '',
      priority: c.priority ?? '',
    });
  }, [data]);

  function refresh() {
    if (!caseId) return;
    setLoading(true);
    api.get(`/api/cases/${caseId}`).then((res) => setData(res.data)).catch(() => toast.error('Failed to refresh')).finally(() => setLoading(false));
  }

  async function addNote(e) {
    e.preventDefault();
    if (!noteText || noteText.trim().length === 0) return toast('Please enter a note');
    setAdding(true);
    try {
      const res = await api.post(`/api/cases/${caseId}/notes`, { content: noteText.trim() });
      setNoteText('');
      toast.success('Note added');
      // prepend to notes
      setData((d) => ({ ...d, notes: [res.data.note, ...(d?.notes || [])], timeline: [
        { type: 'note', date: res.data.note.createdAt, author: res.data.note.author ? { id: res.data.note.author.id, email: res.data.note.author.email } : null, content: res.data.note.content, noteId: res.data.note.id },
        ... (d?.timeline || [])
      ] }));
    } catch (err) {
      console.error(err);
      toast.error('Failed to add note');
    } finally {
      setAdding(false);
    }
  }

  // Helper: format errorMessage stored in DB (Zod arrays, objects or plain strings)
  function formatErrorMessage(raw) {
    if (!raw) return null;
    // already a string that's short - return as-is
    if (typeof raw === 'string') {
      // try to detect JSON content inside string
      const trimmed = raw.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('['))) {
        try {
          const parsed = JSON.parse(trimmed);
          return extractMessages(parsed);
        } catch (e) {
          // not JSON, return raw
          return trimmed;
        }
      }
      return trimmed;
    }
    // If it's an object/array stored directly (unlikely), extract messages
    try {
      return extractMessages(raw);
    } catch (e) {
      return String(raw);
    }
  }

  function extractMessages(obj) {
    // If obj is an array of Zod issues
    if (Array.isArray(obj)) {
      const msgs = obj.map((it) => {
        if (it && typeof it === 'object' && it.message) return it.message;
        return String(it);
      }).filter(Boolean);
      return msgs.length ? msgs.join('; ') : JSON.stringify(obj);
    }
    // If obj has "errors" array (Zod format)
    if (obj && typeof obj === 'object') {
      if (Array.isArray(obj.errors)) {
        return obj.errors.map((e) => e?.message || String(e)).join('; ');
      }
      if (obj.message && typeof obj.message === 'string') return obj.message;
      // fallback stringify small
      const s = JSON.stringify(obj);
      return s.length > 100 ? s.slice(0, 200) + '...' : s;
    }
    return String(obj);
  }

  const startEdit = () => setEditing(true);
  const cancelEdit = () => {
    // revert form to case values
    if (data?.case) {
      const c = data.case;
      setForm({
        applicant_name: c.applicant_name ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        category: c.category ?? '',
        priority: c.priority ?? '',
      });
    }
    setEditing(false);
  };

  const saveEdit = async () => {
    if (!data?.case) return;
    const caseIdToUpdate = data.case.case_id;
    // build minimal payload only with fields that are present (backend accepts partial)
    const payload = {
      applicant_name: form.applicant_name,
      email: form.email,
      phone: form.phone,
      category: form.category,
      priority: form.priority,
    };

    const t = toast.loading('Saving changes...');
    try {
      const res = await api.put(`/api/cases/${encodeURIComponent(caseIdToUpdate)}`, payload);
      // update UI with returned case
      setData((d) => ({ ...d, case: res.data.case }));
      toast.dismiss(t);
      toast.success('Case updated');
      setEditing(false);
    } catch (err) {
      toast.dismiss(t);
      console.error('Failed to update case', err);
      toast.error(err?.response?.data?.error || 'Failed to save changes');
      // do not auto-close edit mode so user can try again or cancel
    }
  };

  if (loading) return <div className="p-6">Loading...</div>;
  if (!data || !data.case) return <div className="p-6">Case not found</div>;

  const c = data.case;
  const importMeta = {
    importedBy: c.importedBy,
    importedAt: c.importedAt,
    importLogId: data.importLogId,
  };

  // detect duplicate-note (added by import process)
  const duplicateNote = (data.notes || []).find(n => typeof n.content === 'string' && n.content.startsWith('Duplicate rows in import'));
  const isDuplicate = !!duplicateNote;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold text-gray-800">Case {c.case_id}</h1>
              {isDuplicate && (
                <span title={duplicateNote.content} className="text-xs font-semibold px-2 py-1 rounded bg-yellow-100 text-yellow-800 border border-yellow-200">
                  Duplicate
                </span>
              )}
            </div>

            <div className="mt-2 flex items-center space-x-3">
              <span className="text-sm text-gray-500">Status</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${c.status === 'FAILED' ? 'bg-red-100 text-red-700' : c.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{c.status}</span>
              <span className="text-sm text-gray-500">Priority: <strong className="ml-1">{c.priority ?? '-'}</strong></span>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button onClick={() => navigate('/cases')} className="px-4 py-2 bg-white border rounded text-sm">Back</button>
            {!editing ? (
              <button onClick={startEdit} className="px-4 py-2 bg-yellow-400 text-black rounded text-sm">Edit</button>
            ) : (
              <>
                <button onClick={saveEdit} className="px-4 py-2 bg-green-600 text-white rounded text-sm">Save</button>
                <button onClick={cancelEdit} className="px-4 py-2 bg-gray-200 rounded text-sm">Cancel</button>
              </>
            )}
            <button onClick={refresh} className="px-4 py-2 bg-indigo-600 text-white rounded text-sm">Refresh</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Applicant</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-500">Name</div>
                {editing ? (
                  <input className="w-full border rounded px-3 py-2" value={form.applicant_name} onChange={(e) => setForm(prev => ({ ...prev, applicant_name: e.target.value }))} />
                ) : (
                  <div className="font-medium">{c.applicant_name || '-'}</div>
                )}
              </div>
              <div>
                <div className="text-sm text-gray-500">DOB</div>
                <div className="font-medium">{c.dob ? new Date(c.dob).toLocaleDateString() : '-'}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Email</div>
                {editing ? (
                  <input className="w-full border rounded px-3 py-2" value={form.email} onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))} />
                ) : (
                  <div className="font-medium">{c.email || '-'}</div>
                )}
              </div>
              <div>
                <div className="text-sm text-gray-500">Phone</div>
                {editing ? (
                  <input className="w-full border rounded px-3 py-2" value={form.phone} onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))} />
                ) : (
                  <div className="font-medium">{c.phone || '-'}</div>
                )}
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">Case Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-500">Category</div>
                  {editing ? (
                    <select className="w-full border rounded px-3 py-2" value={form.category} onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))}>
                      <option value="">-</option>
                      <option value="TAX">TAX</option>
                      <option value="LICENSE">LICENSE</option>
                      <option value="PERMIT">PERMIT</option>
                    </select>
                  ) : (
                    <div className="font-medium">{c.category || '-'}</div>
                  )}
                </div>
                <div>
                  <div className="text-sm text-gray-500">Error</div>
                  <div className="font-bold text-black">{formatErrorMessage(c.errorMessage) || '-'}</div>
                </div>
                {editing && (
                  <div>
                    <div className="text-sm text-gray-500">Priority</div>
                    <select className="w-full border rounded px-3 py-2" value={form.priority ?? ''} onChange={(e) => setForm(prev => ({ ...prev, priority: e.target.value }))}>
                      <option value="">-</option>
                      <option value="3">HIGH</option>
                      <option value="2">MEDIUM</option>
                      <option value="1">LOW</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="bg-white p-6 rounded-lg shadow space-y-4">
            <div>
              <div className="text-sm text-gray-500">Imported By</div>
              <div className="font-medium">{importMeta.importedBy ? importMeta.importedBy.email : '-'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Imported At</div>
              <div className="font-medium">{importMeta.importedAt ? new Date(importMeta.importedAt).toLocaleString() : '-'}</div>
            </div>
            <div>
              {importMeta.importLogId ? (
                <button onClick={() => navigate(`/import-report/${importMeta.importLogId}`)} className="w-full px-3 py-2 bg-indigo-600 text-white rounded">View Import Report</button>
              ) : (
                <div className="text-sm text-gray-400">No import log available</div>
              )}
            </div>
          </aside>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Timeline</h3>
            <div className="flow-root">
              <ul className="-mb-8">
                {data.timeline && data.timeline.length ? data.timeline.map((t, idx) => (
                  <li key={idx} className="mb-8">
                    <div className="relative pb-8">
                      <span className="absolute left-0 -ml-3.5 mt-1 w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs">{t.type === 'note' ? 'N' : t.type === 'imported' ? 'I' : 'S'}</span>
                      <div className="ml-12">
                        <div className="text-sm text-gray-500">{new Date(t.date || Date.now()).toLocaleString()}</div>
                        <div className="mt-1 font-medium">
                          {t.type === 'imported' && <>Imported by {t.by ? t.by.email : 'system'}</>}
                          {t.type === 'status' && <>Status: {t.status}</>}
                          {t.type === 'note' && <>Note by {t.author ? t.author.email : 'unknown'}: {t.content}</>}
                        </div>
                      </div>
                    </div>
                  </li>
                )) : <div className="text-sm text-gray-500">No timeline events</div>}
              </ul>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Notes</h3>
            <form onSubmit={addNote} className="mb-4">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={4} className="w-full p-3 border rounded-lg mb-3" placeholder="Add a note" />
              <div className="flex items-center space-x-2">
                <button type="submit" disabled={adding} className="px-4 py-2 bg-green-600 text-white rounded">{adding ? 'Adding...' : 'Add Note'}</button>
                <button type="button" onClick={() => setNoteText('')} className="px-4 py-2 bg-gray-100 rounded">Clear</button>
              </div>
            </form>

            <div className="space-y-4">
              {data.notes && data.notes.length ? data.notes.map((n) => (
                <div key={n.id} className="p-3 border rounded flex items-start space-x-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold">{n.author ? (n.author.email || 'U').charAt(0).toUpperCase() : 'S'}</div>
                  <div>
                    <div className="text-sm text-gray-500">{new Date(n.createdAt).toLocaleString()} • {n.author ? n.author.email : 'system'}</div>
                    <div className="mt-1">{n.content}</div>
                  </div>
                </div>
              )) : <div className="text-sm text-gray-500">No notes</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
