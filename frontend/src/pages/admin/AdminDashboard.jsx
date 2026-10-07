import { useEffect, useState } from 'react';
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
} from 'recharts';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [txs, setTxs] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/admin/stats'), api.get('/admin/transactions')])
      .then(([s, t]) => { setData(s); setTxs(t.slice(0, 8)); })
      .catch((e) => setError(e.message));
  }, []);

  const loading = !data || !txs;

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
  const maxMonth = Math.max(1, ...monthly.map((m) => m.total || 0));

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
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

      {/* Secondary stats + alert */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Savings — Last 6 Months</CardTitle>
            <CardDescription>Monthly savings inflow across members</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : monthly.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                No savings data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly}>
                  <defs>
                    <linearGradient id="savingsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="hsl(160 84% 30%)" stopOpacity={0.75} />
                      <stop offset="95%" stopColor="hsl(160 84% 30%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} width={70}
                         tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                  <RTooltip
                    formatter={(v) => formatCurrency(v)}
                    contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                  />
                  <Area type="monotone" dataKey="total" stroke="hsl(160 84% 30%)"
                        strokeWidth={2} fill="url(#savingsGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
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

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Savings Spotlight</CardTitle>
              <CardDescription>Best month to date</CardDescription>
            </CardHeader>
            <CardContent>
              {loading || monthly.length === 0 ? (
                <Skeleton className="h-12 w-full" />
              ) : (
                (() => {
                  const best = monthly.reduce((a, b) => (b.total > a.total ? b : a), monthly[0]);
                  return (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{best.month}</p>
                        <p className="text-2xl font-bold">{formatCurrency(best.total)}</p>
                      </div>
                      <div className="w-24">
                        <Progress value={(best.total / maxMonth) * 100} />
                      </div>
                    </div>
                  );
                })()
              )}
            </CardContent>
          </Card>
        </div>
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
          ) : txs.length === 0 ? (
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
                {txs.map((t) => (
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