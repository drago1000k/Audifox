'use client';

import React, { useState } from 'react';
import { X, Mail, Lock, LogIn, UserPlus, AlertCircle, Loader2 } from 'lucide-react';
import {
  isFirebaseConfigured,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
} from '@/lib/firebase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'sepia' | 'light';
}

function mapFirebaseError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
  const msg = err instanceof Error ? err.message : '';

  if (code.includes('wrong-password') || code.includes('invalid-credential')) {
    return 'Email hoặc mật khẩu không đúng.';
  }
  if (code.includes('user-not-found')) {
    return 'Không tìm thấy tài khoản với email này.';
  }
  if (code.includes('email-already-in-use')) {
    return 'Email này đã được đăng ký. Vui lòng đăng nhập.';
  }
  if (code.includes('weak-password')) {
    return 'Mật khẩu quá yếu (cần ít nhất 6 ký tự).';
  }
  if (code.includes('invalid-email')) {
    return 'Địa chỉ email không hợp lệ.';
  }
  if (code.includes('popup-closed-by-user')) {
    return 'Cửa sổ đăng nhập Google đã bị đóng.';
  }
  if (code.includes('popup-blocked')) {
    return 'Trình duyệt đã chặn popup đăng nhập Google. Vui lòng cho phép popup.';
  }
  return msg || 'Đăng nhập thất bại. Vui lòng thử lại.';
}

export default function AuthModal({ isOpen, onClose, theme }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  async function handleGoogle() {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
      }
      onClose();
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setLoading(false);
    }
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
        className={`w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl p-5 sm:p-6 shadow-2xl border ${
          theme === 'dark'
            ? 'bg-gray-900 border-gray-800 text-white'
            : theme === 'sepia'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg">Đăng nhập & Đồng bộ Tủ truyện</h3>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 p-1">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs sm:text-sm opacity-75 mb-4">
          Lưu tiến độ đọc & tủ truyện lên đám mây để đồng bộ giữa điện thoại và máy tính.
        </p>

        {!isFirebaseConfigured ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs sm:text-sm space-y-2">
            <div className="font-semibold text-amber-400">Chế độ Khách (Local)</div>
            <p className="opacity-85">
              Firebase chưa được cấu hình (<code className="px-1 bg-black/20 rounded">NEXT_PUBLIC_FIREBASE_*</code>).
              Tiến độ của bạn vẫn được lưu an toàn trong IndexedDB trên thiết bị này.
            </p>
          </div>
        ) : (
          <>
            {/* Google Sign-In */}
            <button
              onClick={handleGoogle}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-white text-gray-900 border border-gray-300 hover:bg-gray-100 font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-sm disabled:opacity-50 mb-4"
            >
              <span className="font-bold text-base text-indigo-600">G</span>
              Tiếp tục với Google
            </button>

            <div className="relative flex items-center justify-center mb-4">
              <div className="border-t border-current/15 w-full" />
              <span className="px-3 text-xs opacity-50 whitespace-nowrap">hoặc dùng Email</span>
              <div className="border-t border-current/15 w-full" />
            </div>

            {/* Email/Password Tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/15 mb-4">
              <button
                type="button"
                onClick={() => { setMode('login'); setError(''); }}
                className={`py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  mode === 'login' ? 'bg-indigo-600 text-white' : 'opacity-70 hover:opacity-100'
                }`}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                onClick={() => { setMode('register'); setError(''); }}
                className={`py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                  mode === 'register' ? 'bg-indigo-600 text-white' : 'opacity-70 hover:opacity-100'
                }`}
              >
                Đăng ký tài khoản mới
              </button>
            </div>

            <form onSubmit={handleEmailSubmit} className="space-y-3">
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email của bạn"
                  className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputCls}`}
                />
              </div>

              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mật khẩu (tối thiểu 6 ký tự)"
                  className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputCls}`}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : mode === 'login' ? (
                  <LogIn size={16} />
                ) : (
                  <UserPlus size={16} />
                )}
                {mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
