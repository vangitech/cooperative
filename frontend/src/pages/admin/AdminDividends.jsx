import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, initials } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { MoreHorizontal, Send, CheckCircle2, Coins, ShieldCheck, Layers } from 'lucide-react';

const statusVariant = { pending: 'warning', approved: 'default', paid: 'success' };

export default function AdminDividends() {
  const { user } = useAuth();
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ period: '', totalAmount: '' });
  const [submitting, setSubmitting] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [paying, setPaying] = useState(false);
  const [capMonth, setCapMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [surplus, setSurplus] = useState(null);
  const [payPeriod, setPayPeriod] = useState('');
  const [payingPeriod, setPayingPeriod] = useState(false);

  const load = () => api.get('/admin/dividends').then(setList).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const loadSurplus = async (month) => {
    try {
      setSurplus(await api.get(`/admin/dividends/surplus?month=${month}`));
    } catch {
      setSurplus(null);
    }
  };
  useEffect(() => { loadSurplus(capMonth); }, [capMonth]);

  const declare = async (e) => {
    e.preventDefault();
    if (!form.period || !form.totalAmount) return;
    setSubmitting(true);
    try {
      const r = await api.post('/admin/dividends', {
        period: form.period,
        totalAmount: Number(form.totalAmount),
        capMonth,
      });
      toast.success(`Dividend declared for ${r.count} members`);
      setForm({ period: '', totalAmount: '' });
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const approve = async (d) => {
    try {
      await api.patch(`/admin/dividends/${d.id}/approve`);
      toast.success(`Approved ${formatCurrency(d.amount)} for ${d.first_name}`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const payWholePeriod = async () => {
    if (!payPeriod) return;
    setPayingPeriod(true);
    try {
      const r = await api.post('/admin/dividends/pay-period', { period: payPeriod });
      toast.success(`Paid ${r.count} dividends for ${r.period}`);
      setPayPeriod('');
      load();
    } catch (e) { toast.error(e.message); }
    finally { setPayingPeriod(false); }
  };

  const pay = async () => {
    if (!payTarget) return;
    setPaying(true);
    try {
      await api.patch(`/admin/dividends/${payTarget.id}/pay`);
      toast.success(`Paid ${formatCurrency(payTarget.amount)} to ${payTarget.first_name}`);
      setPayTarget(null); load();
    } catch (e) { toast.error(e.message); }
    finally { setPaying(false); }
  };

  const pendingCount = (list || []).filter((d) => d.status === 'pending').length;
  const pendingTotal = (list || []).filter((d) => d.status === 'pending')
    .reduce((s, d) => s + Number(d.amount), 0);
  const approvedCount = (list || []).filter((d) => d.status === 'approved').length;
  const approvedTotal = (list || []).filter((d) => d.status === 'approved')
    .reduce((s, d) => s + Number(d.amount), 0);
  const isAdmin = user?.role === 'admin';

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Declare form */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4" /> Declare Dividend
            </CardTitle>
            <CardDescription>Split equally among active members</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={declare} className="space-y-4">
              <div>
                <Label>Period</Label>
                <Input placeholder="e.g. 2025 Q1" value={form.period}
                       onChange={(e) => setForm({ ...form, period: e.target.value })} required />
              </div>
              <div>
                <Label>Total Amount to Distribute</Label>
                <Input type="number" placeholder="0.00" value={form.totalAmount}
                       onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} required />
              </div>
              <div>
                <Label>Cap against surplus month</Label>
                <Input type="month" value={capMonth} onChange={(e) => setCapMonth(e.target.value)} />
                {surplus ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    Surplus {formatCurrency(surplus.surplus)} · max distributable{' '}
                    <span className="font-semibold text-foreground">{formatCurrency(surplus.maxDistributable)}</span>{' '}
                    ({Math.round(surplus.payoutRatio * 100)}%)
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Surplus unavailable — declaration uncapped</p>
                )}
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Pending approval</span>
                <span className="font-medium text-foreground">
                  {pendingCount} · {formatCurrency(pendingTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Approved, unpaid</span>
                <span className="font-medium text-foreground">
                  {approvedCount} · {formatCurrency(approvedTotal)}
                </span>
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                <Send className="h-4 w-4" />
                {submitting ? 'Declaring…' : 'Declare Dividend'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Pay whole period */}
        <Card className="h-fit lg:col-span-3">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <Label>Pay approved period (atomic — all or nothing)</Label>
              <Input placeholder="e.g. 2025 Q1" value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)} />
            </div>
            <Button onClick={payWholePeriod} disabled={payingPeriod || !payPeriod} variant="outline">
              <Layers className="h-4 w-4" />
              {payingPeriod ? 'Paying…' : 'Pay Period'}
            </Button>
          </CardContent>
        </Card>

        {/* Records */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dividend Records</CardTitle>
            <CardDescription>Track declared and paid dividends</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!list ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                      No dividends declared yet
                    </TableCell>
                  </TableRow>
                ) : list.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {initials(d.first_name, d.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{d.first_name} {d.last_name}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(d.created_at)}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{d.period}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(d.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[d.status] || 'warning'} className="capitalize">
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.status === 'pending' && isAdmin ? (
                        <Button variant="ghost" size="sm" onClick={() => approve(d)}>
                          <ShieldCheck className="h-4 w-4" /> Approve
                        </Button>
                      ) : d.status === 'approved' ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setPayTarget(d)}>
                              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" /> Pay to Wallet
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : d.status === 'pending' ? (
                        <span className="text-xs text-muted-foreground">Awaiting admin approval</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Settled</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Confirm pay dialog */}
      <Dialog open={!!payTarget} onOpenChange={(v) => !v && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" /> Confirm Dividend Payout
            </DialogTitle>
            <DialogDescription>
              Pay {formatCurrency(payTarget?.amount)} to{' '}
              {payTarget?.first_name} {payTarget?.last_name} for period {payTarget?.period}?
              Funds will be credited to their wallet instantly.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button onClick={pay} disabled={paying}>
              {paying ? 'Processing…' : 'Confirm Payout'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}