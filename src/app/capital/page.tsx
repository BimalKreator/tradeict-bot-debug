'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Trash2, X } from 'lucide-react';

interface TransferRecord {
  id: number;
  date: string;
  exchange: string;
  type: string;
  amount: number;
  timestamp: number;
}

function fmtAmount(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CapitalPage() {
  const [rows, setRows] = useState<TransferRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState<TransferRecord | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editType, setEditType] = useState<'DEPOSIT' | 'WITHDRAWAL'>('DEPOSIT');
  const [saving, setSaving] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/capital/history');
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data) ? data : []);
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleDelete = async (record: TransferRecord) => {
    const confirmed = window.confirm(
      `Delete ${record.type} of $${fmtAmount(record.amount)} on ${record.date}?`
    );
    if (!confirmed) return;

    try {
      const res = await fetch('/api/capital/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: record.id }),
      });
      if (res.ok) {
        await fetchRecords();
      } else {
        const data = await res.json();
        alert(data.error ?? 'Delete failed');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const openEditModal = (record: TransferRecord) => {
    setEditModal(record);
    setEditDate(record.date);
    setEditAmount(String(record.amount));
    setEditType((record.type.toUpperCase() === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT') as 'DEPOSIT' | 'WITHDRAWAL');
  };

  const closeEditModal = () => {
    setEditModal(null);
    setEditDate('');
    setEditAmount('');
  };

  const handleSaveEdit = async () => {
    if (!editModal) return;

    const numAmount = parseFloat(editAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('Enter a valid amount');
      return;
    }
    if (!editDate.trim()) {
      alert('Enter a valid date');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/capital/history', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editModal.id,
          date: editDate.trim(),
          amount: numAmount,
          type: editType,
        }),
      });
      if (res.ok) {
        closeEditModal();
        await fetchRecords();
      } else {
        const data = await res.json();
        alert(data.error ?? 'Update failed');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-white/70 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      <section className="rounded-xl border border-cyan-500/30 bg-black/50 p-6">
        <h1 className="mb-6 text-2xl font-semibold text-white">Capital History Management</h1>

        {loading ? (
          <div className="glass flex min-h-[200px] items-center justify-center rounded-xl">
            <div className="text-white/70">Loading capital history...</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg bg-white/5 py-12 text-center text-sm text-white/60">
            No transfer records yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-3 py-3 text-left font-medium text-white/80">Date</th>
                  <th className="px-3 py-3 text-left font-medium text-white/80">Exchange</th>
                  <th className="px-3 py-3 text-left font-medium text-white/80">Type</th>
                  <th className="px-3 py-3 text-right font-medium text-white/80">Amount</th>
                  <th className="px-3 py-3 text-center font-medium text-white/80">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 transition-colors hover:bg-white/5"
                  >
                    <td className="px-3 py-3 tabular-nums text-white/90">{row.date}</td>
                    <td className="px-3 py-3 text-white/90">{row.exchange}</td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          row.type.toUpperCase() === 'DEPOSIT'
                            ? 'rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400'
                            : 'rounded-md bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400'
                        }
                      >
                        {row.type}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-white/90">
                      ${fmtAmount(row.amount)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="rounded-lg border border-white/20 p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          className="rounded-lg border border-red-500/30 p-2 text-red-400 transition-colors hover:bg-red-500/10"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-xl border border-white/10 bg-[#0a0f1c] p-6 shadow-2xl">
            <button
              type="button"
              onClick={closeEditModal}
              className="absolute right-4 top-4 text-white/50 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="mb-4 text-lg font-semibold text-white">Edit Transfer</h3>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-white/60">Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/60">Type</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as 'DEPOSIT' | 'WITHDRAWAL')}
                  className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="DEPOSIT">Deposit</option>
                  <option value="WITHDRAWAL">Withdrawal</option>
                </select>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closeEditModal}
                className="flex-1 rounded-lg border border-white/20 py-2 text-white/80 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex-1 rounded-lg bg-cyan-600 py-2 font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
