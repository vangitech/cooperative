import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const SEEN_KEY = 'mpcs_admin_seen';

// Where each audited entity lives in the console.
const ENTITY_ROUTES = {
  loan: '/admin/loans',
  loan_product: '/admin/loans',
  user: '/admin/members',
  kyc: '/admin/members',
  guarantor: '/admin/members',
  dividend: '/admin/dividends',
  payment_intent: '/admin/transactions',
  virtual_account: '/admin/transactions',
  transaction: '/admin/transactions',
  store_product: '/admin/store',
  collection: '/admin/store',
  announcement: '/admin/notices',
  savings_plan: '/admin/members',
  fixed_deposit: '/admin/transactions',
};

const actionLabel = (a) => a.action.replace(/\./g, ' · ').replace(/_/g, ' ');
const actorLabel = (a) =>
  a.email || (a.actor_id ? `user #${a.actor_id}` : 'system');

export default function AdminActivityBell() {
  const navigate = useNavigate();
  const [activity, setActivity] = useState([]);
  const [txs, setTxs] = useState([]);
  const [seen, setSeen] = useState(() => {
    try {
      return Number(localStorage.getItem(SEEN_KEY) || 0);
    } catch {
      return 0;
    }
  });

  const load = async () => {
    const [logs, recent] = await Promise.all([
      api.get('/admin/audit-logs?limit=10').catch(() => []),
      api.get('/admin/transactions').then((t) => t.slice(0, 5)).catch(() => []),
    ]);
    setActivity(Array.isArray(logs) ? logs : []);
    setTxs(Array.isArray(recent) ? recent : []);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const hasNew =
    [...activity, ...txs].some((x) => new Date(x.created_at).getTime() > seen);

  const markSeen = () => {
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(SEEN_KEY, String(now));
    } catch { /* ignore */ }
  };

  const openActivity = (a) => {
    markSeen();
    navigate(ENTITY_ROUTES[a.entity] || '/admin/activity');
  };

  const openTx = () => {
    markSeen();
    navigate('/admin/transactions');
  };

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) markSeen(); }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {hasNew && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <DropdownMenuLabel>Latest activity</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-auto">
          {activity.length === 0 && txs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
          )}
          {activity.slice(0, 8).map((a) => (
            <DropdownMenuItem key={`a-${a.id}`} onClick={() => openActivity(a)} className="flex-col items-start gap-0.5 py-2">
              <span className="text-sm font-medium capitalize">{actionLabel(a)}</span>
              <span className="text-xs text-muted-foreground">
                {actorLabel(a)} · {formatDateTime(a.created_at)}
              </span>
            </DropdownMenuItem>
          ))}
          {txs.length > 0 && (
            <>
              <DropdownMenuLabel className="pt-3">Latest transactions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {txs.map((t) => (
                <DropdownMenuItem key={`t-${t.id}`} onClick={openTx} className="flex-col items-start gap-0.5 py-2">
                  <span className="text-sm font-medium capitalize">{t.type.replace(/_/g, ' ')} · {t.amount}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.first_name} {t.last_name} · {formatDateTime(t.created_at)}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
