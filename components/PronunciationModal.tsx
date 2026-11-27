'use client';

import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
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
      ? 'bg-[#242636] border-white/10 text-[#F3F4F6] placeholder-[#9CA3AF]'
      : theme === 'sepia'
        ? 'bg-amber-50 border-amber-300 text-amber-900 placeholder-amber-400'
        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-xl max-h-[85vh] sm:max-h-[75vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl border ${
          theme === 'dark'
            ? 'bg-[#1B1D2B] border-white/10 text-[#F3F4F6]'
            : theme === 'sepia'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        {/* Centered Header */}
        <div className="relative flex items-center justify-center px-5 py-3.5 border-b border-current/10 shrink-0">
          <h3 className="font-semibold text-sm sm:text-base tracking-tight">Từ điển</h3>
          <button
            onClick={onClose}
            className="absolute right-3 opacity-70 hover:opacity-100 p-2 rounded-full hover:bg-white/10"
            aria-label="Đóng"
          >
            <X size={17} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              placeholder="Từ gốc (vd: Skill, Boss)"
              className={`min-w-0 flex-1 px-3 py-2 min-h-[40px] rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5CF6] ${inputCls}`}
            />
            <input
              type="text"
              value={spoken}
              onChange={(e) => setSpoken(e.target.value)}
              placeholder="Cách đọc (vd: sờ kiu, bót)"
              className={`min-w-0 flex-1 px-3 py-2 min-h-[40px] rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-[#8B5CF6] ${inputCls}`}
            />
            <button
              type="submit"
              disabled={!original.trim() || !spoken.trim()}
              className="px-4 py-2 min-h-[40px] rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#7C5DFA] hover:opacity-95 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-1 shrink-0"
            >
              <Plus size={16} /> Thêm
            </button>
          </form>

          {rules.length === 0 ? (
            <div className="text-center py-7 text-[#9CA3AF] text-xs sm:text-sm border border-dashed border-current/15 rounded-xl">
              Chưa có từ nào. Ví dụ: <code className="px-1.5 py-0.5 bg-black/20 rounded">Skill</code> →{' '}
              <code className="px-1.5 py-0.5 bg-black/20 rounded">sờ kiu</code>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`relative rounded-xl px-3.5 py-2.5 border transition-colors ${
                    theme === 'dark'
                      ? 'bg-[#242636] border-white/10 hover:border-[#8B5CF6]/50'
                      : 'bg-black/5 border-current/15'
                  }`}
                >
                  <button
                    onClick={() => handleDelete(rule.id)}
                    className="absolute top-2 right-2 p-1 rounded-md opacity-60 hover:opacity-100 hover:bg-red-500/15 text-red-400 transition-opacity"
                    title="Xóa"
                  >
                    <Trash2 size={13} />
                  </button>
                  <div className="pr-6 text-xs sm:text-sm font-medium break-words">
                    {rule.original} <span className="text-[#9CA3AF]">→</span>{' '}
                    <span className="text-[#A78BFA]">{rule.spoken}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
