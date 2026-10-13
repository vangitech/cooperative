import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import StatCard from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { initials } from '@/lib/format';
import {
  Users, Wallet, PiggyBank, HandCoins, TrendingUp,
  AlertCircle, ArrowUpRight, ArrowRight,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid,
  BarChart, Bar, Cell,
  PieChart, Pie, Legend,
} from 'recharts';

const PIE_COLORS = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const BAR_COLORS = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
};
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 12 };

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [txs, setTxs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/admin/stats'), api.get('/admin/transactions')])
      .then(([s, t]) => { setData(s); setTxs(t); })
      .catch((e) => setError(e.message));
  }, []);

  const loading = !data || !txs;

  const txMix = useMemo(() => {
    const map = new Map();
    for (const t of txs || []) {
      const key = t.type || 'other';
      map.set(key, (map.get(key) || 0) + Number(t.amount || 0));
    }
    return [...map.entries()]
      .map(([type, total]) => ({ type: type.replaceAll('_', ' '), total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [txs]);

  const portfolio = useMemo(() => {
    if (!data) return [];
    const s = data.stats || {};
    return [
      { name: 'Wallets', value: Number(s.total_wallet_balance || 0) },
      { name: 'Savings', value: Number(s.total_savings || 0) },
      { name: 'Loans out', value: Number(s.active_loans_amount || 0) },
      { name: 'Fixed deposits', value: Number(s.active_fixed_deposits || 0) },
    ].filter((d) => d.value > 0);
  }, [data]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load dashboard</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const s = data?.stats || {};
  const monthly = data?.monthlySavings || [];
  const recent = (txs || []).slice(0, 8);
  const maxMonth = Math.max(1, ...monthly.map((m) => m.total || 0));
  const best = monthly.length
    ? monthly.reduce((a, b) => (b.total > a.total ? b : a), monthly[0])
    : null;

  return (
    <div className="w-full space-y-6">
      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </CardContent></Card>
          ))
        ) : (
          <>
            <StatCard
              title="Total Members"
              value={s.total_members}
              icon={Users}
              hint={`${s.active_members} active`}
            />
            <StatCard
              title="Wallet Balances"
              value={formatCurrency(s.total_wallet_balance)}
              icon={Wallet}
              hint="Across all members"
            />
            <StatCard
              title="Total Savings"
              value={formatCurrency(s.total_savings)}
              icon={PiggyBank}
              hint="Cumulative deposits"
            />
            <StatCard
              title="Active Loans"
              value={formatCurrency(s.active_loans_amount)}
              icon={HandCoins}
              hint={`${s.pending_loans} pending approval`}
            />
            <StatCard
              title="Overdue Loans"
              value={s.overdue_loans}
              icon={AlertCircle}
              hint="Schedules past due"
            />
            <StatCard
              title="Locked Fixed Deposits"
              value={formatCurrency(s.active_fixed_deposits)}
              icon={Wallet}
              hint="Earning interest"
            />
          </>
        )}
      </div>

      {/* Savings trend + portfolio */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Savings — Last 6 Months</CardTitle>
            <CardDescription>Monthly savings inflow across members</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : monthly.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                No savings data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.75} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                  <YAxis tickLine={false} axisLine={false} width={72} tick={AXIS_TICK}
                    tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                  <RTooltip
                    formatter={(v) => formatCurrency(v)}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Area type="monotone" dataKey="total" stroke="var(--primary)"
                    strokeWidth={2} fill="url(#savingsGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Portfolio Mix</CardTitle>
            <CardDescription>Where member money sits</CardDescription>
          </CardHeader>
          <CardContent className="h-72 flex-1">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : portfolio.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                No balances yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={portfolio} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                    {portfolio.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip formatter={(v) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
          {best && (
            <div className="border-t px-6 py-4">
              <p className="text-xs text-muted-foreground">Best savings month</p>
              <div className="mt-1 flex items-center justify-between gap-4">
                <p className="text-lg font-bold">{formatCurrency(best.total)}</p>
                <span className="text-xs text-muted-foreground">{best.month}</span>
              </div>
              <Progress className="mt-2" value={(best.total / maxMonth) * 100} />
            </div>
          )}
        </Card>
      </div>

      {/* Transaction mix + operations */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Transactions by Type</CardTitle>
            <CardDescription>Volume per movement type (all time)</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : txMix.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                No transactions yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={txMix} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="type" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} angle={-12} dy={8} height={52} />
                  <YAxis tickLine={false} axisLine={false} width={72} tick={AXIS_TICK}
                    tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                  <RTooltip formatter={(v) => formatCurrency(v)} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--muted)' }} />
                  <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                    {txMix.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> Pending loans
                </span>
                <span className="text-sm font-semibold">{s.pending_loans ?? 0}</span>
              </div>
              <Progress value={Math.min(100, (s.pending_loans || 0) * 10)} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5" /> Dividends paid
                </span>
                <span className="text-sm font-semibold">{formatCurrency(s.total_dividends_paid)}</span>
              </div>
              <Progress value={Math.min(100, ((s.total_dividends_paid || 0) / Math.max(1, s.total_savings)) * 100)} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <ArrowUpRight className="h-3.5 w-3.5" /> Total transactions
                </span>
                <span className="text-sm font-semibold">{s.total_transactions ?? 0}</span>
              </div>
              <Progress value={Math.min(100, (s.total_transactions || 0) / 5)} />
            </div>
            <Button variant="outline" className="w-full" onClick={() => navigate('/admin/loans')}>
              Review pending loans <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Latest transactions across all members</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/transactions')}>
            View all <ArrowRight className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : recent.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No recent transactions</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {initials(t.first_name, t.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{t.first_name} {t.last_name}</p>
                          <p className="text-xs text-muted-foreground">{t.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {t.type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(t.amount)}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {formatDateTime(t.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
