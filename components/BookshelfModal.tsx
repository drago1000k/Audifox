'use client';

import React from 'react';
import { X, BookMarked, Play, Trash2, Clock, Cloud, CloudOff, LogIn } from 'lucide-react';
import type { BookshelfEntry } from '@/lib/db';

interface BookshelfModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: BookshelfEntry[];
  onResumeEntry: (entry: BookshelfEntry) => void;
  onDeleteEntry: (seriesKey: string) => void;
  isLoggedIn: boolean;
  onOpenAuth: () => void;
  theme: 'dark' | 'sepia' | 'light';
}

function formatRelativeTime(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} giờ trước`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} ngày trước`;
}

export default function BookshelfModal({
  isOpen,
  onClose,
  items,
  onResumeEntry,
  onDeleteEntry,
  isLoggedIn,
  onOpenAuth,
  theme,
}: BookshelfModalProps) {
  if (!isOpen) return null;

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
          <div className="flex items-center gap-2 flex-wrap">
            <BookMarked size={20} className="text-indigo-400 shrink-0" />
            <h3 className="font-bold text-base sm:text-lg">Tủ truyện ({items.length})</h3>
            {isLoggedIn && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-medium">
                <Cloud size={11} /> Đã đồng bộ
              </span>
            )}
          </div>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Guest Sync Prompt Banner */}
        {!isLoggedIn && (
          <div className="mb-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 opacity-90">
              <CloudOff size={14} className="text-indigo-400 shrink-0" />
              Đang lưu cục bộ. Đăng nhập để đồng bộ tủ truyện trên mọi thiết bị.
            </span>
            <button
              onClick={() => {
                onClose();
                onOpenAuth();
              }}
              className="px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold inline-flex items-center gap-1 shrink-0"
            >
              <LogIn size={12} /> Đăng nhập
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-10 opacity-50 text-sm border border-dashed border-current/20 rounded-xl">
            Tủ truyện đang trống. Mở một chương truyện bất kỳ để tự động lưu vào tủ.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const total = Math.max(1, item.totalChunks || 1);
              const pct = Math.min(100, Math.round(((item.chunkIndex + 1) / total) * 100));
              const canResume = Boolean(item.content || item.url);
              return (
                <div
                  key={item.seriesKey}
                  className="rounded-xl border border-current/15 p-3.5 space-y-2 hover:border-indigo-500/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{item.seriesName}</div>
                      <div className="text-xs opacity-75 truncate mt-0.5">{item.chapterTitle}</div>
                    </div>
                    <button
                      onClick={() => onDeleteEntry(item.seriesKey)}
                      className="p-1.5 rounded hover:bg-red-500/15 text-red-400 shrink-0"
                      title="Xóa khỏi tủ truyện"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-current/10 overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="opacity-60 flex items-center gap-1">
                      <Clock size={12} /> {formatRelativeTime(item.updatedAt)} · Đoạn {item.chunkIndex + 1}/{total} ({pct}%)
                    </span>
                    {canResume && (
                      <button
                        onClick={() => onResumeEntry(item)}
                        className="px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1 shrink-0"
                      >
                        <Play size={11} /> Đọc tiếp
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
