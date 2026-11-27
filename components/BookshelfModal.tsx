'use client';

import React from 'react';
import { X, BookMarked, Play, Trash2, Clock, CloudOff, LogIn } from 'lucide-react';
import type { BookshelfEntry } from '@/lib/db';

interface BookshelfModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: BookshelfEntry[];
  onResumeEntry: (entry: BookshelfEntry) => void;
  onDeleteEntry: (seriesKey: string) => void;
  isLoggedIn: boolean;
  userLabel?: string;
  onOpenAuth: () => void;
  onSignOut: () => void;
  theme: 'dark' | 'sepia' | 'light';
}

function formatRelativeTime(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function BookshelfModal({
  isOpen,
  onClose,
  items,
  onResumeEntry,
  onDeleteEntry,
  isLoggedIn,
  userLabel,
  onOpenAuth,
  onSignOut,
  theme,
}: BookshelfModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4">
      <div
        className={`w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl shadow-2xl border transition-all ${
          theme === 'dark'
            ? 'bg-[#222434] border-white/10 text-[#F3F4F6]'
            : theme === 'sepia'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-current/10 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-base sm:text-lg tracking-tight">📚 Tủ truyện của bạn</h3>
            {isLoggedIn && (
              <span className="text-[11px] font-medium text-[#34D399]">
                ✓ Đã đồng bộ
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="opacity-70 hover:opacity-100 p-2 rounded-full hover:bg-white/10 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Book List */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-2.5">
          {items.length === 0 ? (
            <div className="text-center py-10 opacity-60 text-sm border border-dashed border-current/15 rounded-xl">
              Tủ truyện đang trống. Mở một chương truyện bất kỳ để tự động lưu vào tủ.
            </div>
          ) : (
            items.map((item) => {
              const total = Math.max(1, item.totalChunks || 1);
              const pct = Math.min(100, Math.round(((item.chunkIndex + 1) / total) * 100));
              const canResume = Boolean(item.content || item.url);
              const initial = (item.seriesName || 'A').trim()[0]?.toUpperCase() || 'A';
              return (
                <div
                  key={item.seriesKey}
                  className={`rounded-xl border p-3 flex items-center gap-3 transition-colors ${
                    theme === 'dark'
                      ? 'bg-[#282A3C] border-white/10 hover:border-[#8B5CF6]/50'
                      : 'border-current/15 bg-black/5'
                  }`}
                >
                  {/* Rounded Cover Thumbnail */}
                  <div className="w-11 h-14 rounded-lg bg-gradient-to-br from-[#8B5CF6] to-[#5B21B6] shadow-md flex flex-col items-center justify-center text-white shrink-0 select-none">
                    <span className="font-bold text-base leading-none">{initial}</span>
                    <BookMarked size={11} className="mt-1 opacity-80" />
                  </div>

                  {/* Title + Compact Progress Metadata */}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{item.seriesName}</div>
                    <div className="text-xs text-[#9CA3AF] truncate mt-0.5">
                      {item.chapterTitle} • {pct}% • <Clock size={10} className="inline mb-0.5" /> {formatRelativeTime(item.updatedAt)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {canResume && (
                      <button
                        onClick={() => onResumeEntry(item)}
                        className="px-3 py-1.5 min-h-[36px] rounded-full bg-[#8B5CF6] hover:bg-[#7C5DFA] text-white text-xs font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Play size={11} /> Đọc
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteEntry(item.seriesKey)}
                      className="p-2 rounded-lg hover:bg-red-500/15 text-[#9CA3AF] hover:text-red-400 transition-colors"
                      title="Xóa khỏi tủ truyện"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer CTA & Secondary Link */}
        <div className="px-5 py-4 border-t border-current/10 shrink-0 flex flex-col items-center gap-2">
          {!isLoggedIn ? (
            <>
              <p className="text-xs text-[#9CA3AF] flex items-center gap-1.5 text-center mb-1">
                <CloudOff size={13} className="text-[#8B5CF6] shrink-0" />
                Đang lưu cục bộ. Đăng nhập để đồng bộ trên mọi thiết bị.
              </p>
              <button
                onClick={() => {
                  onClose();
                  onOpenAuth();
                }}
                className="w-full py-2.5 min-h-[42px] rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#7C5DFA] hover:opacity-95 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-opacity shadow-lg"
              >
                <LogIn size={15} /> Đăng nhập
              </button>
            </>
          ) : (
            <>
              <div className="text-xs text-[#9CA3AF] text-center">
                Đang đồng bộ với <strong className="text-[#F3F4F6]">{userLabel}</strong>
              </div>
              <button
                onClick={onSignOut}
                className="text-xs text-[#9CA3AF] hover:text-red-400 hover:underline py-1"
              >
                Gỡ tài khoản
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
