'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  BookMarked,
  Play,
  Trash2,
  Clock,
  CloudOff,
  LogIn,
  MoreVertical,
  RefreshCw,
} from 'lucide-react';
import type { BookshelfEntry } from '@/lib/db';

interface BookshelfModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: BookshelfEntry[];
  activeSeriesKey?: string;
  lastSyncAt?: number | null;
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
  if (diffMin < 60) return `${diffMin}m trước`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h trước`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d trước`;
}

const COVER_GRADIENTS = [
  'from-[#5B21B6]/70 via-[#4C1D95]/60 to-[#1E1B4B]/90',
  'from-[#6D28D9]/70 via-[#3B0764]/65 to-[#18182F]/90',
  'from-[#4338CA]/70 via-[#312E81]/65 to-[#14162B]/90',
  'from-[#7C3AED]/65 via-[#581C87]/60 to-[#19162B]/90',
];

export default function BookshelfModal({
  isOpen,
  onClose,
  items,
  activeSeriesKey = '',
  lastSyncAt,
  onResumeEntry,
  onDeleteEntry,
  isLoggedIn,
  userLabel,
  onOpenAuth,
  onSignOut,
  theme,
}: BookshelfModalProps) {
  const [menuState, setMenuState] = useState<{
    item: BookshelfEntry;
    top: number;
    left: number;
  } | null>(null);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<BookshelfEntry | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setMenuState(null);
      setConfirmDeleteItem(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const latestItemTs = items.reduce((max, it) => Math.max(max, it.updatedAt || 0), 0);
  const effectiveSyncAt = lastSyncAt || (latestItemTs > 0 ? latestItemTs : null);

  function openRowMenu(e: React.MouseEvent<HTMLButtonElement>, item: BookshelfEntry) {
    e.stopPropagation();
    if (menuState?.item.seriesKey === item.seriesKey) {
      setMenuState(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 152;
    const clampedLeft = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12));
    const clampedTop = Math.min(rect.bottom + 6, window.innerHeight - 64);
    setMenuState({ item, top: clampedTop, left: clampedLeft });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2.5 sm:p-5">
      <div
        className={`w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl border transition-all ${
          theme === 'dark'
            ? 'bg-[#191B28] border-white/10 text-[#F3F4F6]'
            : theme === 'sepia'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-current/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center text-[#A78BFA]">
              <BookMarked size={18} />
            </span>
            <div>
              <h3 className="font-bold text-base sm:text-lg tracking-tight leading-tight">
                Tủ truyện của bạn
              </h3>
              <p className={`text-[11px] ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'}`}>
                {items.length} truyện đã lưu
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="opacity-75 hover:opacity-100 p-2 rounded-full hover:bg-white/10 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Account Sync Header ("Đồng bộ tài khoản") */}
        <div
          className={`px-4 sm:px-6 py-3 border-b border-current/10 shrink-0 flex flex-wrap items-center justify-between gap-2.5 ${
            theme === 'dark' ? 'bg-white/[0.02]' : 'bg-black/[0.02]'
          }`}
        >
          {isLoggedIn ? (
            <>
              <div className="min-w-0 flex items-center gap-2.5">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">
                  <RefreshCw size={14} />
                </span>
                <div className="min-w-0">
                  <div className="text-xs flex items-center gap-1.5 flex-wrap">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="text-emerald-400 font-medium">Đang đồng bộ với</span>
                    <strong className="truncate max-w-[180px] sm:max-w-[260px] font-semibold">
                      {userLabel || 'Tài khoản'}
                    </strong>
                  </div>
                  {effectiveSyncAt && (
                    <div className={`text-[11px] mt-0.5 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'}`}>
                      Lần đồng bộ cuối: {formatRelativeTime(effectiveSyncAt)}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className={`min-h-[40px] px-3.5 py-2 rounded-xl border text-xs font-medium transition-colors shrink-0 ${
                  theme === 'dark'
                    ? 'border-white/10 bg-white/[0.04] text-zinc-300 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30'
                    : 'border-current/15 bg-black/[0.03] hover:text-red-600 hover:bg-red-500/10 hover:border-red-400/40'
                }`}
              >
                Gỡ tài khoản
              </button>
            </>
          ) : (
            <div className="w-full flex flex-wrap items-center justify-between gap-2.5">
              <p className={`text-xs flex items-center gap-1.5 ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-600'}`}>
                <CloudOff size={14} className="text-[#8B5CF6] shrink-0" />
                <span>Đang lưu cục bộ. Đăng nhập để đồng bộ trên mọi thiết bị.</span>
              </p>
              <button
                onClick={() => {
                  onClose();
                  onOpenAuth();
                }}
                className="min-h-[40px] px-4 py-2 rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:brightness-110 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0"
              >
                <LogIn size={14} /> Đăng nhập
              </button>
            </div>
          )}
        </div>

        {/* Responsive Book Grid */}
        <div className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 sm:py-5">
          {items.length === 0 ? (
            <div className="text-center py-12 opacity-65 text-sm border border-dashed border-current/15 rounded-2xl">
              Tủ truyện đang trống. Mở một chương truyện bất kỳ để tự động lưu vào tủ.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {items.map((item, idx) => {
                const total = Math.max(1, item.totalChunks || 1);
                const pct = Math.min(100, Math.round(((item.chunkIndex + 1) / total) * 100));
                const canResume = Boolean(item.content || item.url);
                const initial = (item.seriesName || 'A').trim()[0]?.toUpperCase() || 'A';
                const isReading =
                  (Boolean(activeSeriesKey) && item.seriesKey === activeSeriesKey) ||
                  item.chunkIndex > 0;
                const coverGrad = COVER_GRADIENTS[idx % COVER_GRADIENTS.length];

                return (
                  <div
                    key={item.seriesKey}
                    className={`group rounded-2xl border overflow-hidden flex flex-col transition-all duration-200 ${
                      theme === 'dark'
                        ? 'bg-[#232638] border-white/10 hover:border-[#8B5CF6]/55 hover:shadow-lg hover:shadow-[#8B5CF6]/10'
                        : 'border-current/15 bg-black/[0.03] hover:border-[#8B5CF6]/45'
                    }`}
                  >
                    {/* Rich Visual Cover Header */}
                    <div
                      className={`relative h-28 sm:h-32 p-3 flex flex-col justify-between bg-gradient-to-br ${coverGrad} border-b border-white/10 select-none`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border backdrop-blur-sm ${
                            isReading
                              ? 'bg-[#8B5CF6]/35 text-violet-100 border-[#A78BFA]/50'
                              : 'bg-black/35 text-zinc-200 border-white/15'
                          }`}
                        >
                          {isReading ? 'Đang đọc' : 'Đã lưu'}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => openRowMenu(e, item)}
                          className="h-9 w-9 -mr-1 -mt-1 rounded-xl bg-black/25 hover:bg-black/45 text-zinc-200 hover:text-white flex items-center justify-center transition-colors"
                          aria-label="Tùy chọn truyện"
                          title="Tùy chọn"
                        >
                          <MoreVertical size={15} />
                        </button>
                      </div>

                      <div className="flex items-end justify-between gap-2">
                        <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 backdrop-blur-sm flex items-center justify-center text-white font-bold text-base shadow-inner">
                          {initial}
                        </div>
                        <BookMarked size={20} className="text-white/40" />
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm leading-snug line-clamp-2 min-h-[2.5rem]">
                          {item.seriesName}
                        </div>
                        <div
                          className={`text-xs truncate mt-1 ${
                            theme === 'dark' ? 'text-zinc-300' : 'text-gray-600'
                          }`}
                        >
                          {item.chapterTitle || 'Chương đã lưu'}
                        </div>
                      </div>

                      {/* Progress Bar & Time */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] tabular-nums">
                          <span className={theme === 'dark' ? 'text-zinc-300' : 'text-gray-600'}>
                            {pct}%
                          </span>
                          <span className={`flex items-center gap-1 ${theme === 'dark' ? 'text-zinc-400' : 'text-gray-500'}`}>
                            <Clock size={10} />
                            {formatRelativeTime(item.updatedAt)}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-black/25 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Primary 40px Read Button */}
                      {canResume && (
                        <button
                          type="button"
                          onClick={() => onResumeEntry(item)}
                          className="w-full h-10 px-4 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#7C3AED] hover:brightness-110 hover:shadow-[0_0_16px_rgba(139,92,246,0.45)] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                        >
                          <Play size={13} /> Đọc
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

      {/* Portal Three-Dot Dropdown Menu (never clipped on mobile or scrollable containers) */}
      {menuState &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[70]" onClick={() => setMenuState(null)}>
            <div
              style={{ top: menuState.top, left: menuState.left }}
              onClick={(e) => e.stopPropagation()}
              className={`fixed w-[152px] rounded-xl border shadow-2xl p-1.5 ${
                theme === 'dark'
                  ? 'bg-[#26283B] border-white/15 text-[#F3F4F6]'
                  : theme === 'sepia'
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-white border-gray-200 text-gray-900'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  const target = menuState.item;
                  setMenuState(null);
                  setConfirmDeleteItem(target);
                }}
                className="w-full min-h-[40px] px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 text-left transition-colors hover:bg-red-500/15 hover:text-red-400"
              >
                <Trash2 size={14} /> Xóa truyện
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Delete Confirmation Dialog */}
      {confirmDeleteItem &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setConfirmDeleteItem(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
                theme === 'dark'
                  ? 'bg-[#1D1F2E] border-white/15 text-[#F3F4F6]'
                  : theme === 'sepia'
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-white border-gray-200 text-gray-900'
              }`}
            >
              <h4 className="font-semibold text-base mb-1.5">Xóa khỏi tủ truyện?</h4>
              <p className={`text-xs sm:text-sm leading-relaxed mb-4 ${theme === 'dark' ? 'text-zinc-300' : 'text-gray-600'}`}>
                Bạn có chắc muốn xóa truyện này khỏi tủ truyện?
                <span className="block font-semibold mt-1 truncate">
                  {confirmDeleteItem.seriesName}
                </span>
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteItem(null)}
                  className={`min-h-[40px] px-4 py-2 rounded-xl border text-xs font-medium transition-colors ${
                    theme === 'dark'
                      ? 'border-white/15 hover:bg-white/10 text-zinc-200'
                      : 'border-current/20 hover:bg-black/5'
                  }`}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const key = confirmDeleteItem.seriesKey;
                    setConfirmDeleteItem(null);
                    onDeleteEntry(key);
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors"
                >
                  Xóa
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
