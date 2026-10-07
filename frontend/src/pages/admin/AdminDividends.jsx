import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
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
import { MoreHorizontal, Send, CheckCircle2, Coins } from 'lucide-react';

export default function AdminDividends() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ period: '', totalAmount: '' });
  const [submitting, setSubmitting] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [paying, setPaying] = useState(false);

  const load = () => api.get('/admin/dividends').then(setList).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const declare = async (e) => {
    e.preventDefault();
    if (!form.period || !form.totalAmount) return;
    setSubmitting(true);
    try {
      const r = await api.post('/admin/dividends', {
        period: form.period,
        totalAmount: Number(form.totalAmount),
      });
      toast.success(`Dividend declared for ${r.count} members`);
      setForm({ period: '', totalAmount: '' });
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
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

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
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
              <Separator />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Pending payouts</span>
                <span className="font-medium text-foreground">
                  {pendingCount} · {formatCurrency(pendingTotal)}
                </span>
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                <Send className="h-4 w-4" />
                {submitting ? 'Declaring…' : 'Declare Dividend'}
              </Button>
            </form>
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
                      <Badge variant={d.status === 'paid' ? 'success' : 'warning'} className="capitalize">
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.status === 'pending' ? (
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
                              <CheckCircle2 className="h-4 w-4 text-green-600" /> Pay to Wallet
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
              <CheckCircle2 className="h-5 w-5 text-green-600" /> Confirm Dividend Payout
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