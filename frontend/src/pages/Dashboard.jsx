import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import StatCard from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wallet, PiggyBank, HandCoins, TrendingUp, Megaphone } from 'lucide-react';
import { useBalanceHidden, masked, BalanceEye } from '@/components/balance';

export default function Dashboard() {
  const [data, setData] = useState({ wallet: null, savings: null, loans: [], transactions: [], dividends: null });
  const [vaccount, setVaccount] = useState(null);
  const [notices, setNotices] = useState([]);
  const [hidden, toggleHidden] = useBalanceHidden();

  useEffect(() => {
    (async () => {
      const [wallet, savings, loans, transactions, dividends] = await Promise.all([
        api.get('/wallet'),
        api.get('/savings/summary'),
        api.get('/loans'),
        api.get('/wallet/transactions?limit=6'),
        api.get('/dividends/summary'),
      ]);
      setData({ wallet, savings, loans, transactions, dividends });
      api.get('/virtual-accounts/me').then(setVaccount).catch(() => setVaccount(null));
      api.get('/announcements').then((n) => setNotices(n.slice(0, 3))).catch(() => setNotices([]));
    })().catch(console.error);
  }, []);

  const activeLoans = data.loans.filter((l) => ['disbursed', 'approved'].includes(l.status));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5 flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                Wallet Balance
                <BalanceEye hidden={hidden} onToggle={toggleHidden} />
              </p>
              <p className="mt-1 text-2xl font-bold">
                {hidden ? masked() : formatCurrency(data.wallet?.balance)}
              </p>
              {vaccount && (
                <p className="mt-1 text-xs text-muted-foreground font-mono tracking-wider">
                  {vaccount.account_number} · {vaccount.bank_name}
                </p>
              )}
            </div>
            <div className="p-2 rounded-lg bg-muted text-primary shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <StatCard title="Total Savings" value={formatCurrency(data.savings?.total)} icon={PiggyBank}
          hint={`Today: ${formatCurrency(data.savings?.today)}`} />
        <StatCard title="Active Loans" value={activeLoans.length} icon={HandCoins}
          hint={formatCurrency(activeLoans.reduce((s, l) => s + Number(l.total_repayable) - Number(l.amount_paid), 0)) + ' outstanding'} />
        <StatCard title="Dividends Earned" value={formatCurrency(data.dividends?.total_paid)} icon={TrendingUp} />
      </div>

      {notices.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" /> Notices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {notices.map((n) => (
              <div key={n.id} className="border-l-2 border-primary pl-3">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-sm text-muted-foreground line-clamp-2">{n.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Recent Transactions</CardTitle></CardHeader>        <CardContent className="p-0">
          {data.transactions.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <ul className="divide-y">
              {data.transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{t.description || t.type}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(t.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className={['withdrawal', 'loan_repayment', 'transfer_out', 'collection_repayment'].includes(t.type) ? 'text-destructive font-semibold' : 'text-green-600 font-semibold'}>
                      {['withdrawal', 'loan_repayment', 'transfer_out', 'collection_repayment'].includes(t.type) ? '-' : '+'}{formatCurrency(t.amount)}
                    </p>
                    <Badge variant="outline" className="mt-1 text-xs capitalize">{t.type.replace('_', ' ')}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}