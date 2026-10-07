import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function NotificationsBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [txs, setTxs] = useState([]);

  const load = async () => {
    try {
      const [list, count] = await Promise.all([
        api.get('/notifications'),
        api.get('/notifications/unread-count'),
      ]);
      setItems(list);
      setUnread(count.unread);
    } catch {
      /* not logged in or offline — stay quiet */
    }
    try {
      const recent = await api.get('/wallet/transactions?limit=5');
      setTxs(Array.isArray(recent) ? recent : []);
    } catch {
      /* stay quiet */
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const open = async (n) => {
    if (!n.is_read) {
      try {
        await api.patch(`/notifications/${n.id}/read`);
        setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
        setUnread((u) => Math.max(0, u - 1));
      } catch { /* ignore */ }
    }
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try {
      await api.patch('/notifications/read-all');
      setItems((xs) => xs.map((x) => ({ ...x, is_read: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] grid place-items-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {unread > 0 && (
            <button onClick={markAll} className="text-xs font-normal text-primary hover:underline">
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">You're all caught up</p>
        )}
        <div className="max-h-80 overflow-auto">
          {items.slice(0, 15).map((n) => (
            <DropdownMenuItem key={n.id} onClick={() => open(n)} className="flex-col items-start gap-1 py-2.5">
              <span className={`text-sm ${n.is_read ? 'font-normal' : 'font-semibold'}`}>{n.title}</span>
              {n.body && <span className="text-xs text-muted-foreground line-clamp-2">{n.body}</span>}
            </DropdownMenuItem>
          ))}
          {txs.length > 0 && (
            <>
              <DropdownMenuLabel className="pt-3">Recent transactions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {txs.map((t) => (
                <DropdownMenuItem key={`t-${t.id}`} onClick={() => navigate('/wallet')} className="flex-col items-start gap-1 py-2">
                  <span className="text-sm capitalize">{t.type.replace(/_/g, ' ')} · {t.amount}</span>
                  <span className="text-xs text-muted-foreground line-clamp-1">{t.description || t.reference}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          {items.length === 0 && txs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">You're all caught up</p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
