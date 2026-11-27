'use client';

import React, { useState } from 'react';
import {
  X,
  ListOrdered,
  BookMarked,
  History,
  Play,
  Trash2,
  Clock,
  ChevronLeft,
  Cloud,
  LogIn,
} from 'lucide-react';
import type { BookshelfEntry } from '@/lib/db';
import type { SubChapterMarker } from '@/lib/textUtils';

export type SidebarTab = 'toc' | 'bookshelf' | 'history';

interface ReaderSidebarProps {
  theme: 'dark' | 'sepia' | 'light';
  desktopOpen: boolean;
  onToggleDesktop: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  subChapters: SubChapterMarker[];
  activeParagraph: number;
  onJumpToChunk: (chunkIndex: number) => void;
  bookshelfItems: BookshelfEntry[];
  onResumeBookshelf: (entry: BookshelfEntry) => void;
  onDeleteBookshelf: (seriesKey: string) => void;
  isLoggedIn: boolean;
  onOpenAuth: () => void;
  playlist: { title: string; url: string }[];
  currentUrl: string;
  onSelectHistoryUrl: (url: string) => void;
}

function formatRelTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function ReaderSidebar({
  theme,
  desktopOpen,
  onToggleDesktop,
  mobileOpen,
  onCloseMobile,
  subChapters,
  activeParagraph,
  onJumpToChunk,
  bookshelfItems,
  onResumeBookshelf,
  onDeleteBookshelf,
  isLoggedIn,
  onOpenAuth,
  playlist,
  currentUrl,
  onSelectHistoryUrl,
}: ReaderSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>(subChapters.length >= 2 ? 'toc' : 'bookshelf');

  const surfaceCls =
    theme === 'dark'
      ? 'bg-[#181B28] border-white/[0.07] text-[#F3F4F6]'
      : theme === 'sepia'
        ? 'bg-amber-100 border-amber-300 text-amber-950'
        : 'bg-gray-50 border-gray-200 text-gray-900';

  const cardCls =
    theme === 'dark'
      ? 'bg-[#12141E]/85 border-white/[0.06] hover:border-[#8B5CF6]/45'
      : 'bg-white/70 border-current/15 hover:border-indigo-400';

  const body = (isMobile: boolean) => (
    <div className="flex flex-col h-full">
      {/* Sidebar Header + Tabs */}
      <div className="p-3 border-b border-current/10 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#A78BFA]">
            Điều hướng đọc
          </span>
          {isMobile ? (
            <button
              onClick={onCloseMobile}
              className="p-1.5 rounded-lg hover:bg-white/10 opacity-75 hover:opacity-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
              aria-label="Đóng thanh bên"
            >
              <X size={16} />
            </button>
          ) : (
            <button
              onClick={onToggleDesktop}
              className="p-1 rounded-lg hover:bg-white/10 opacity-65 hover:opacity-100"
              title="Thu gọn thanh bên"
              aria-label="Thu gọn thanh bên"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/20">
          <button
            onClick={() => setTab('toc')}
            className={`py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
              tab === 'toc' ? 'bg-[#8B5CF6] text-white' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <ListOrdered size={12} /> Mục lục
          </button>
          <button
            onClick={() => setTab('bookshelf')}
            className={`py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
              tab === 'bookshelf' ? 'bg-[#8B5CF6] text-white' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <BookMarked size={12} /> Tủ ({bookshelfItems.length})
          </button>
          <button
            onClick={() => setTab('history')}
            className={`py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
              tab === 'history' ? 'bg-[#8B5CF6] text-white' : 'opacity-70 hover:opacity-100'
            }`}
          >
            <History size={12} /> Lịch sử
          </button>
        </div>
      </div>

      {/* Scrollable Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === 'toc' && (
          <>
            {subChapters.length === 0 ? (
              <div className="text-xs text-[#9CA3AF] text-center py-6 border border-dashed border-current/15 rounded-xl px-3">
                Không phát hiện mục lục con trong chương này. Dùng thanh tiến độ hoặc nhấn vào từng đoạn để nhảy nhanh.
              </div>
            ) : (
              subChapters.map((sc, i) => {
                const active =
                  activeParagraph >= sc.paragraphIndex &&
                  (i === subChapters.length - 1 ||
                    activeParagraph < subChapters[i + 1].paragraphIndex);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      onJumpToChunk(sc.chunkIndex);
                      if (isMobile) onCloseMobile();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors ${
                      active
                        ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/60 text-[#F3F4F6] font-semibold'
                        : `${cardCls} text-[#9CA3AF] hover:text-[#F3F4F6]`
                    }`}
                  >
                    <div className="truncate">{sc.label}</div>
                  </button>
                );
              })
            )}
          </>
        )}

        {tab === 'bookshelf' && (
          <>
            {!isLoggedIn && (
              <div className="rounded-xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 p-2.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="opacity-85">Lưu cục bộ</span>
                <button
                  onClick={() => {
                    if (isMobile) onCloseMobile();
                    onOpenAuth();
                  }}
                  className="px-2.5 py-1 rounded-full bg-[#8B5CF6] text-white font-semibold inline-flex items-center gap-1 shrink-0"
                >
                  <LogIn size={10} /> Đồng bộ
                </button>
              </div>
            )}

            {bookshelfItems.length === 0 ? (
              <div className="text-xs text-[#9CA3AF] text-center py-6 border border-dashed border-current/15 rounded-xl">
                Chưa có truyện nào trong tủ.
              </div>
            ) : (
              bookshelfItems.map((item) => {
                const total = Math.max(1, item.totalChunks || 1);
                const pct = Math.min(100, Math.round(((item.chunkIndex + 1) / total) * 100));
                return (
                  <div key={item.seriesKey} className={`rounded-xl border p-2.5 space-y-1.5 ${cardCls}`}>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate">{item.seriesName}</div>
                        <div className="text-[11px] text-[#9CA3AF] truncate">{item.chapterTitle}</div>
                      </div>
                      <button
                        onClick={() => onDeleteBookshelf(item.seriesKey)}
                        className="p-1 rounded hover:bg-red-500/15 text-[#9CA3AF] hover:text-red-400 shrink-0"
                        title="Xóa"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#9CA3AF]">
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {pct}% • {formatRelTime(item.updatedAt)}
                      </span>
                      {(item.content || item.url) && (
                        <button
                          onClick={() => {
                            onResumeBookshelf(item);
                            if (isMobile) onCloseMobile();
                          }}
                          className="px-2.5 py-1 rounded-full bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold inline-flex items-center gap-1"
                        >
                          <Play size={10} /> Đọc
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {playlist.length === 0 ? (
              <div className="text-xs text-[#9CA3AF] text-center py-6 border border-dashed border-current/15 rounded-xl">
                Chưa có lịch sử chương trong phiên này.
              </div>
            ) : (
              playlist.map((item, idx) => {
                const isCurrent = item.url === currentUrl;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      onSelectHistoryUrl(item.url);
                      if (isMobile) onCloseMobile();
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors ${
                      isCurrent
                        ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/60 text-[#F3F4F6] font-semibold'
                        : `${cardCls} text-[#9CA3AF] hover:text-[#F3F4F6]`
                    }`}
                  >
                    <div className="truncate">
                      {idx + 1}. {item.title || item.url}
                    </div>
                  </button>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Docked Sidebar */}
      {desktopOpen && (
        <aside
          className={`hidden lg:flex flex-col w-[280px] xl:w-[300px] shrink-0 sticky top-[7.5rem] max-h-[calc(100vh-14rem)] rounded-2xl border overflow-hidden shadow-lg ${surfaceCls}`}
        >
          {body(false)}
        </aside>
      )}

      {/* Mobile Slide-Over Drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex bg-black/65 backdrop-blur-sm"
          onClick={onCloseMobile}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className={`w-[84vw] max-w-[320px] h-full border-r shadow-2xl ${surfaceCls}`}
          >
            {body(true)}
          </aside>
        </div>
      )}
    </>
  );
}
