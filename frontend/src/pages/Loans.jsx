import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const statusVariant = { pending: 'warning', approved: 'secondary', disbursed: 'default', rejected: 'destructive', repaid: 'success' };

export default function Loans() {
  const { refresh } = useAuth();
  const [loans, setLoans] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ amount: '', durationMonths: 6, purpose: '', productId: '' });
  const [msg, setMsg] = useState(null);
  const [repay, setRepay] = useState(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [schedule, setSchedule] = useState(null);

  const load = () => Promise.all([
    api.get('/loans').then(setLoans),
    api.get('/loans/products').then(setProducts).catch(() => setProducts([])),
  ]);
  useEffect(() => { load(); }, []);

  const product = products.find((p) => String(p.id) === String(form.productId));

  const apply = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.post('/loans', {
        amount: Number(form.amount),
        durationMonths: Number(form.durationMonths),
        purpose: form.purpose,
        productId: Number(form.productId),
      });
      setForm({ amount: '', durationMonths: 6, purpose: '', productId: '' });
      await load();
      setMsg({ type: 'ok', text: 'Loan application submitted. Awaiting approval.' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const submitRepay = async () => {
    try {
      await api.post(`/loans/${repay.id}/repay`, { amount: Number(repayAmount) });
      setRepay(null); setRepayAmount(''); await load(); await refresh();
    } catch (e) { alert(e.message); }
  };

  const viewSchedule = async (loan) => {
    try {
      setSchedule({ loan, loading: true });
      const data = await api.get(`/loans/${loan.id}/schedule`);
      setSchedule({ ...data, loading: false });
    } catch (e) { alert(e.message); setSchedule(null); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1 h-fit">
        <CardHeader><CardTitle>Apply for a Loan</CardTitle></CardHeader>
        <CardContent>
            <form onSubmit={apply} className="space-y-4">
              {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
              <div>
                <Label>Loan Product</Label>
                <Select value={String(form.productId)} onValueChange={(v) => setForm({ ...form, productId: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose a product…" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} — {p.interest_rate}% p.a.
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {product && (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(product.min_amount)}–{product.max_amount ? formatCurrency(product.max_amount) : '∞'} ·{' '}
                  {product.min_duration_months}–{product.max_duration_months} mo
                  {Number(product.required_savings_multiple) > 0 && ` · needs ${product.required_savings_multiple}× in savings`}
                  {product.requires_guarantors && ` · ${product.guarantor_count} guarantor(s) required`}
                </p>
              )}
              <div><Label>Amount</Label><Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>Duration (months)</Label><Input type="number" min="1" required value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })} /></div>
              <div><Label>Purpose</Label><Textarea rows={3} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
              <Button type="submit" className="w-full">Submit Application</Button>
            </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>My Loans</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Repayable</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm">{formatDate(l.created_at)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(l.amount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(l.total_repayable)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(l.amount_paid)}</TableCell>
                  <TableCell><Badge variant={statusVariant[l.status]} className="capitalize">{l.status}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {['disbursed', 'approved'].includes(l.status) && (
                      <Button size="sm" variant="ghost" onClick={() => viewSchedule(l)}>Schedule</Button>
                    )}
                    {['disbursed', 'approved'].includes(l.status) && Number(l.amount_paid) < Number(l.total_repayable) && (
                      <Button size="sm" variant="outline" onClick={() => setRepay(l)}>Repay</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {loans.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No loans yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!repay} onOpenChange={(v) => !v && setRepay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Repay Loan #{repay?.id}</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">
            Outstanding: {formatCurrency(repay ? Number(repay.total_repayable) - Number(repay.amount_paid) : 0)}
          </div>
          <div><Label>Amount</Label><Input type="number" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} /></div>
          <DialogFooter><Button onClick={submitRepay}>Confirm Repayment</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!schedule} onOpenChange={(v) => !v && setSchedule(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Repayment Schedule — Loan #{schedule?.loan?.id}</DialogTitle>
          </DialogHeader>
          {schedule?.loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading schedule…</p>
          ) : schedule && (
            <div className="space-y-3">
              <p className="text-sm">
                Outstanding: <span className="font-semibold">{formatCurrency(schedule.loan.outstanding)}</span>
                {Number(schedule.loan.penalty_accrued) > 0 && (
                  <span className="text-destructive"> (incl. {formatCurrency(schedule.loan.penalty_accrued)} penalties)</span>
                )}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.schedule.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.due_number}</TableCell>
                      <TableCell className="text-sm">{formatDate(s.due_date)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.amount_due)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.amount_paid)}</TableCell>
                      <TableCell>
                        {Number(s.amount_paid) >= Number(s.amount_due) ? (
                          <Badge variant="success">paid</Badge>
                        ) : s.overdue ? (
                          <Badge variant="destructive">overdue</Badge>
                        ) : (
                          <Badge variant="outline">due</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}