'use client';

import React, { useState } from 'react';
import { X, Plus, Trash2, Volume2 } from 'lucide-react';
import type { PronunciationRule } from '@/lib/textUtils';

interface PronunciationModalProps {
  isOpen: boolean;
  onClose: () => void;
  rules: PronunciationRule[];
  onSaveRules: (rules: PronunciationRule[]) => void;
  theme: 'dark' | 'sepia' | 'light';
}

export default function PronunciationModal({
  isOpen,
  onClose,
  rules,
  onSaveRules,
  theme,
}: PronunciationModalProps) {
  const [original, setOriginal] = useState('');
  const [spoken, setSpoken] = useState('');

  if (!isOpen) return null;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const orig = original.trim();
    const spk = spoken.trim();
    if (!orig || !spk) return;
    const next: PronunciationRule[] = [
      ...rules.filter((r) => r.original.toLowerCase() !== orig.toLowerCase()),
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, original: orig, spoken: spk },
    ];
    onSaveRules(next);
    setOriginal('');
    setSpoken('');
  }

  function handleDelete(id: string) {
    onSaveRules(rules.filter((r) => r.id !== id));
  }

  const inputCls =
    theme === 'dark'
      ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
      : theme === 'sepia'
        ? 'bg-amber-50 border-amber-300 text-amber-900 placeholder-amber-400'
        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4">
      <div
        className={`w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-4 sm:p-6 shadow-2xl border ${
          theme === 'dark'
            ? 'bg-gray-900 border-gray-800 text-white'
            : theme === 'sepia'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Volume2 size={20} className="text-indigo-400 shrink-0" />
            <h3 className="font-bold text-base sm:text-lg">Từ điển phát âm</h3>
          </div>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 p-1">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs sm:text-sm opacity-75 mb-4">
          Chỉ thay thế cách đọc gửi tới giọng AI (không làm thay đổi chữ hiển thị trên màn hình).
        </p>

        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            type="text"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            placeholder="Từ gốc (vd: Skill, Boss)"
            className={`min-w-0 flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputCls}`}
          />
          <input
            type="text"
            value={spoken}
            onChange={(e) => setSpoken(e.target.value)}
            placeholder="Cách đọc (vd: sờ kiu, bót)"
            className={`min-w-0 flex-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputCls}`}
          />
          <button
            type="submit"
            disabled={!original.trim() || !spoken.trim()}
            className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-1 shrink-0"
          >
            <Plus size={16} /> Thêm
          </button>
        </form>

        {rules.length === 0 ? (
          <div className="text-center py-8 opacity-50 text-sm border border-dashed border-current/20 rounded-xl">
            Chưa có từ nào. Ví dụ: <code className="px-1 bg-black/15 rounded">Skill</code> →{' '}
            <code className="px-1 bg-black/15 rounded">sờ kiu</code>
          </div>
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-current/15 text-sm"
              >
                <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold break-words">{rule.original}</span>
                  <span className="opacity-40">→</span>
                  <span className="text-indigo-400 break-words">{rule.spoken}</span>
                </div>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="p-1.5 rounded hover:bg-red-500/15 text-red-400 shrink-0"
                  title="Xóa"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end mt-5 pt-3 border-t border-current/10">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
          >
            Xong
          </button>
        </div>
      </div>
    </div>
  );
}
