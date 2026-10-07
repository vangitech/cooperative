import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/* eslint-disable react-refresh/only-export-components -- shared balance-visibility utilities (hook + presentational bits) */

const KEY = 'mpcs_hide_balance';

// Persisted balance-visibility toggle (shared across pages via localStorage).
export function useBalanceHidden() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setHidden((h) => {
      try {
        localStorage.setItem(KEY, h ? '0' : '1');
      } catch { /* private mode — session only */ }
      return !h;
    });
  return [hidden, toggle];
}

export const masked = () => `₦ ••••••`;

export function BalanceEye({ hidden, onToggle, className }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={hidden ? 'Show balance' : 'Hide balance'}
      title={hidden ? 'Show balance' : 'Hide balance'}
      className={cn(
        'inline-flex items-center justify-center h-6 w-6 rounded-md hover:bg-muted transition-colors',
        className
      )}
    >
      {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}
