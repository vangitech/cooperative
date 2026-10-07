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

const statusVariant = { pending: 'warning', approved: 'secondary', disbursed: 'default', rejected: 'destructive', repaid: 'success' };

export default function Loans() {
  const { refresh } = useAuth();
  const [loans, setLoans] = useState([]);
  const [form, setForm] = useState({ amount: '', durationMonths: 6, purpose: '' });
  const [msg, setMsg] = useState(null);
  const [repay, setRepay] = useState(null);
  const [repayAmount, setRepayAmount] = useState('');

  const load = () => api.get('/loans').then(setLoans);
  useEffect(() => { load(); }, []);

  const apply = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.post('/loans', {
        amount: Number(form.amount),
        durationMonths: Number(form.durationMonths),
        purpose: form.purpose,
      });
      setForm({ amount: '', durationMonths: 6, purpose: '' });
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

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1 h-fit">
        <CardHeader><CardTitle>Apply for a Loan</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={apply} className="space-y-4">
            {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
            <div><Label>Amount</Label><Input type="number" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><Label>Duration (months)</Label><Input type="number" min="1" required value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })} /></div>
            <div><Label>Purpose</Label><Textarea rows={3} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">Interest rate: 10% flat per annum.</p>
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
                  <TableCell className="text-right">
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
    </div>
  );
}