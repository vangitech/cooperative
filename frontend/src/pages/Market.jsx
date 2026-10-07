import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const CATS = [
  { value: 'all', label: 'All' },
  { value: 'farm', label: 'Farm Produce' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'groceries', label: 'Groceries' },
];

const statusVariant = { pending: 'warning', collected: 'default', completed: 'success', rejected: 'destructive', cancelled: 'outline' };

export default function Market() {
  const { refresh } = useAuth();
  const [cat, setCat] = useState('all');
  const [products, setProducts] = useState([]);
  const [mine, setMine] = useState([]);
  const [req, setReq] = useState(null); // product being requested
  const [form, setForm] = useState({ qty: 1, months: 3, autoDebit: true });
  const [msg, setMsg] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [repay, setRepay] = useState(null);
  const [repayAmount, setRepayAmount] = useState('');

  const load = async () => {
    const [p, m] = await Promise.all([
      api.get(`/store/products${cat === 'all' ? '' : `?category=${cat}`}`),
      api.get('/store/mine').catch(() => []),
    ]);
    setProducts(p); setMine(m);
  };
  useEffect(() => { load(); }, [cat]);

  const preview = (p) => {
    if (!p) return null;
    const qty = Math.max(1, Number(form.qty) || 1);
    const months = Math.max(1, Number(form.months) || 1);
    const gross = qty * Number(p.price);
    const down = (gross * Number(p.min_down_pct)) / 100;
    const financed = gross - down;
    const total = down + financed * (1 + (Number(p.markup_pct) / 100) * (months / 12));
    return { gross, down, monthly: total / months, months };
  };
  const pv = req ? preview(req) : null;

  const submitRequest = async () => {
    setMsg(null);
    try {
      await api.post('/store/request', {
        productId: req.id,
        quantity: Number(form.qty) || 1,
        durationMonths: Number(form.months) || 1,
        autoDebit: form.autoDebit,
      });
      setReq(null); setForm({ qty: 1, months: 3, autoDebit: true });
      await load(); await refresh();
      setMsg({ type: 'ok', text: 'Request submitted. Collect after admin approval.' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const viewSchedule = async (c) => {
    try {
      setSchedule({ loading: true });
      setSchedule(await api.get(`/store/collections/${c.id}/schedule`));
    } catch (e) { alert(e.message); setSchedule(null); }
  };

  const submitRepay = async () => {
    try {
      await api.post(`/store/collections/${repay.id}/repay`, { amount: Number(repayAmount) });
      setRepay(null); setRepayAmount(''); await load(); await refresh();
    } catch (e) { alert(e.message); }
  };

  const toggleAuto = async (c) => {
    try {
      await api.patch(`/store/collections/${c.id}/auto-debit`, { enabled: !c.auto_debit });
      await load();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      <Tabs value={cat} onValueChange={setCat}>
        <TabsList>
          {CATS.map((c) => <TabsTrigger key={c.value} value={c.value}>{c.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value={cat}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <Card key={p.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <Badge variant="outline" className="capitalize shrink-0">{p.category}</Badge>
                  </div>
                  <CardDescription>{p.description || 'Pay later in installments'}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-3">
                  <p className="text-2xl font-bold">{formatCurrency(p.price)}</p>
                  <p className="text-xs text-muted-foreground">
                    From {formatCurrency((Number(p.price) * Number(p.min_down_pct)) / 100)} down · up to {p.max_months} mo · {p.stock} in stock
                  </p>
                  <Button className="w-full mt-auto" onClick={() => setReq(p)}>Collect Now, Pay Later</Button>
                </CardContent>
              </Card>
            ))}
            {products.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 col-span-full text-center">Nothing here yet</p>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle>My Collections</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Auto-debit</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mine.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{c.product_name || `Collection #${c.id}`}</p>
                    <p className="text-xs text-muted-foreground">×{c.quantity} · {c.duration_months} mo</p>
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(c.total_repayable)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(c.amount_paid)}</TableCell>
                  <TableCell><Badge variant={statusVariant[c.status]} className="capitalize">{c.status}</Badge></TableCell>
                  <TableCell>
                    {c.status === 'collected' && (
                      <button onClick={() => toggleAuto(c)} className="text-xs text-primary hover:underline">
                        {c.auto_debit ? 'On — turn off' : 'Off — turn on'}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.status === 'collected' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => viewSchedule(c)}>Schedule</Button>
                        <Button size="sm" variant="outline" onClick={() => setRepay(c)}>Repay</Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {mine.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No collections yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!req} onOpenChange={(v) => !v && setReq(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Collect: {req?.name}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Quantity</Label><Input type="number" min="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></div>
            <div><Label>Months (max {req?.max_months})</Label><Input type="number" min="1" value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} /></div>
          </div>
          {pv && (
            <div className="text-sm border rounded-md p-3 space-y-1">
              <p>Total: <span className="font-semibold">{formatCurrency(pv.gross)}</span></p>
              <p>Down payment due on approval: <span className="font-semibold">{formatCurrency(pv.down)}</span></p>
              <p>Monthly: <span className="font-semibold">{formatCurrency(pv.monthly)}</span> × {pv.months} mo</p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.autoDebit} onChange={(e) => setForm({ ...form, autoDebit: e.target.checked })} />
            Auto-debit installments from my wallet when money arrives
          </label>
          <DialogFooter><Button onClick={submitRequest}>Submit Request</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!schedule} onOpenChange={(v) => !v && setSchedule(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Schedule — Collection #{schedule?.collection?.id}</DialogTitle></DialogHeader>
          {schedule?.loading ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : schedule && (
            <div className="space-y-3">
              <p className="text-sm">
                Outstanding: <span className="font-semibold">{formatCurrency(schedule.collection.outstanding)}</span>
                {Number(schedule.collection.penalty_accrued) > 0 && (
                  <span className="text-destructive"> (incl. {formatCurrency(schedule.collection.penalty_accrued)} penalties)</span>
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

      <Dialog open={!!repay} onOpenChange={(v) => !v && setRepay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Repay Collection #{repay?.id}</DialogTitle></DialogHeader>
          <div><Label>Amount</Label><Input type="number" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} /></div>
          <DialogFooter><Button onClick={submitRepay}>Confirm Repayment</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
