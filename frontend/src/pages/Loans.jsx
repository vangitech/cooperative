import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import KycRequiredModal from '@/components/KycRequiredModal';
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

const statusVariant = { pending: 'warning', grantor_approved: 'secondary', kyc_failed: 'destructive', kyc_verified: 'default', approved: 'secondary', disbursed: 'default', rejected: 'destructive', repaid: 'success' };

const STAGE_HINT = {
  pending: 'Awaiting union grantors (2-of-3 must agree)',
  grantor_approved: 'Grantors agreed — officer verifying documents',
  kyc_failed: 'Documents need attention — check notifications',
  kyc_verified: 'Verified — awaiting payment approval',
  disbursed: 'Paid out',
  repaid: 'Fully repaid',
  rejected: 'Not approved',
};

export default function Loans() {
  const { refresh } = useAuth();
  const [loans, setLoans] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ amount: '', durationMonths: 6, purpose: '', productId: '' });
  const [msg, setMsg] = useState(null);
  const [repay, setRepay] = useState(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [schedule, setSchedule] = useState(null);
  // Loan pre-conditions (both sectors): recent utility bill + gov ID.
  // The server re-checks on submit — attempting without them pops the
  // styled KYC modal instead of failing silently.
  const [docGate, setDocGate] = useState(null);
  const [gateOpen, setGateOpen] = useState(false);

  const missingDocs = () => {
    if (!docGate) return [];
    return [
      !docGate.utilityRecent && 'A recent utility bill (electricity, water or waste — within 3 months)',
      !docGate.hasGovId && 'A valid government ID (passport, driver’s license or voter’s card)',
    ].filter(Boolean);
  };

  const load = () => Promise.all([
    api.get('/loans').then(setLoans),
    api.get('/loans/products').then(setProducts).catch(() => setProducts([])),
    api.get('/kyc/me').then((d) => {
      const docs = d?.documents || [];
      const gov = docs.find((x) => ['passport', 'drivers_license', 'voters_card', 'id_card'].includes(x.doc_type));
      const util = docs
        .filter((x) => ['utility_bill', 'proof_of_address'].includes(x.doc_type))
        .sort((a, b) => new Date(b.doc_date || b.created_at) - new Date(a.doc_date || a.created_at))[0] || null;
      const recent = util ? (Date.now() - new Date(util.doc_date || util.created_at).getTime()) / 86400000 <= 93 : false;
      setDocGate({ hasGovId: Boolean(gov), hasUtility: Boolean(util), utilityRecent: recent });
    }).catch(() => setDocGate(null)),
  ]);
  useEffect(() => { load(); }, []);

  const product = products.find((p) => String(p.id) === String(form.productId));

  const apply = async (e) => {
    e.preventDefault(); setMsg(null);
    if (docGate && (!docGate.hasGovId || !docGate.utilityRecent)) {
      setGateOpen(true);
      return;
    }
    try {
      await api.post('/loans', {
        amount: Number(form.amount),
        durationMonths: Number(form.durationMonths),
        purpose: form.purpose,
        productId: Number(form.productId),
      });
      setForm({ amount: '', durationMonths: 6, purpose: '', productId: '' });
      await load();
      setMsg({ type: 'ok', text: 'Loan application submitted. Your grantor will review it first.' });
    } catch (e) {
      if (/KYC|verification|Upload/i.test(e.message)) setGateOpen(true);
      else setMsg({ type: 'err', text: e.message });
    }
  };

  const submitRepay = async () => {
    try {
      await api.post(`/loans/${repay.id}/repay`, { amount: Number(repayAmount) });
      setRepay(null); setRepayAmount(''); await load(); await refresh();
    } catch (e) { alert(e.message); }
  };

  const toggleAutoDebit = async (loan) => {
    try {
      await api.patch(`/loans/${loan.id}/auto-debit`, { autoDebit: !loan.auto_debit });
      await load();
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
              {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>{msg.text}</div>}
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
                  {` · needs an active savings plan + ${product.min_savings_months ?? 2} months of savings history`}
                  {` · needs 2-of-3 union grantor agreement`}
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
                  <TableCell><Badge variant={statusVariant[l.status]} className="capitalize">{String(l.status).replace('_', ' ')}</Badge>
                    {STAGE_HINT[l.status] && <p className="text-[11px] text-muted-foreground mt-0.5">{STAGE_HINT[l.status]}</p>}
                    {l.status === 'pending' && l.grantor_votes && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Union votes: {l.grantor_votes.approvals} approve · {l.grantor_votes.rejections} reject (needs 2 approvals)
                      </p>
                    )}
                    {l.status === 'repaid' && l.closed_at && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">Closed {formatDate(l.closed_at)}</p>
                    )}
                    {['disbursed', 'approved'].includes(l.status) && (
                      <button
                        onClick={() => toggleAutoDebit(l)}
                        title={l.auto_debit ? 'Auto-debit is ON — click to turn off' : 'Auto-debit is OFF — click to turn on'}
                        className="mt-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        Auto-debit: {l.auto_debit === false ? 'OFF' : 'ON'}
                      </button>
                    )}
                  </TableCell>
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
                    <TableHead className="text-right hidden sm:table-cell">Principal</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Interest</TableHead>
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
                      <TableCell className="text-right hidden sm:table-cell text-xs text-muted-foreground">
                        {formatCurrency(s.principal_due)}
                        {Number(s.principal_paid) > 0 && <span className="block">paid {formatCurrency(s.principal_paid)}</span>}
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell text-xs text-muted-foreground">
                        {formatCurrency(s.interest_due)}
                        {Number(s.interest_paid) > 0 && <span className="block">paid {formatCurrency(s.interest_paid)}</span>}
                      </TableCell>
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

      <KycRequiredModal
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        missing={missingDocs()}
        title="Complete verification to borrow"
      />
    </div>
  );
}