import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import StatCard from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarDays, CalendarRange, CalendarClock, PiggyBank } from 'lucide-react';

export default function Savings() {
  const { refresh } = useAuth();
  const [summary, setSummary] = useState(null);
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ amount: '', savingsType: 'daily', note: '' });
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rates, setRates] = useState([]);
  const [fds, setFds] = useState([]);
  const [fdForm, setFdForm] = useState({ amount: '', tenureMonths: '' });
  const [plans, setPlans] = useState([]);
  const [planForm, setPlanForm] = useState({ amount: '', dayOfMonth: '1' });

  const load = async () => {
    const [s, l] = await Promise.all([api.get('/savings/summary'), api.get('/savings')]);
    setSummary(s); setList(l);
  };
  const loadFd = async () => {
    const [r, m] = await Promise.all([
      api.get('/fixed/rates').catch(() => []),
      api.get('/fixed/mine').catch(() => []),
    ]);
    setRates(r); setFds(m);
  };
  const loadPlans = () => api.get('/plans/mine').then(setPlans).catch(() => setPlans([]));
  useEffect(() => { load(); loadFd(); loadPlans(); }, []);

  const submit = async (e) => {
    e.preventDefault(); setMsg(null); setSaving(true);
    try {
      await api.post('/savings', { ...form, amount: Number(form.amount) });
      setForm({ amount: '', savingsType: form.savingsType, note: '' });
      await load(); await refresh();
      setMsg({ type: 'ok', text: 'Savings deposited successfully!' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setSaving(false); }
  };

  const lockFd = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.post('/fixed', { amount: Number(fdForm.amount), tenureMonths: Number(fdForm.tenureMonths) });
      setFdForm({ amount: '', tenureMonths: '' });
      await loadFd(); await refresh();
      setMsg({ type: 'ok', text: 'Fixed deposit locked in!' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const claimFd = async (id) => {
    try {
      await api.post(`/fixed/${id}/claim`);
      await loadFd(); await refresh();
      setMsg({ type: 'ok', text: 'Matured deposit claimed with interest!' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const breakFd = async (id) => {
    if (!window.confirm('Break this deposit early? Interest will be forfeited.')) return;
    try {
      await api.post(`/fixed/${id}/break`);
      await loadFd(); await refresh();
      setMsg({ type: 'ok', text: 'Deposit broken — principal refunded.' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const createPlan = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.post('/plans', { amount: Number(planForm.amount), dayOfMonth: Number(planForm.dayOfMonth) });
      setPlanForm({ amount: '', dayOfMonth: '1' });
      await loadPlans();
      setMsg({ type: 'ok', text: 'Recurring plan created — runs automatically each month.' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const setPlanStatus = async (id, status) => {
    try {
      await api.patch(`/plans/${id}`, { status });
      await loadPlans();
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Today" value={formatCurrency(summary?.today)} icon={CalendarDays} />
        <StatCard title="This Week" value={formatCurrency(summary?.this_week)} icon={CalendarRange} />
        <StatCard title="This Month" value={formatCurrency(summary?.this_month)} icon={CalendarClock} />
        <StatCard title="Total Savings" value={formatCurrency(summary?.total)} icon={PiggyBank} hint={`${summary?.count || 0} deposits`} />
      </div>

      {msg && (
        <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Recurring Plans</CardTitle></CardHeader>
        <CardContent>
          {msg && (
            <div className={`text-sm p-3 rounded-md mb-4 ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {msg.text}
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-3">
            <form onSubmit={createPlan} className="space-y-4">
              <div><Label>Amount per month</Label><Input type="number" min="1" required value={planForm.amount} onChange={(e) => setPlanForm({ ...planForm, amount: e.target.value })} placeholder="0.00" /></div>
              <div>
                <Label>Debit day</Label>
                <Select value={String(planForm.dayOfMonth)} onValueChange={(v) => setPlanForm({ ...planForm, dayOfMonth: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 28 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>Day {i + 1}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Debited from your wallet each month when funded. Top up to stay on track.</p>
              <Button type="submit" className="w-full">Create Plan</Button>
            </form>
            <div className="lg:col-span-2 space-y-3">
              {plans.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 border rounded-md px-3 py-2.5 text-sm">
                  <div className="flex-1 min-w-40">
                    <p className="font-semibold">{formatCurrency(p.amount)} / month</p>
                    <p className="text-muted-foreground text-xs">
                      Day {p.day_of_month} · next {formatDate(p.next_run)}
                      {p.last_run && ` · last ${formatDate(p.last_run)}`}
                    </p>
                  </div>
                  <Badge variant={p.status === 'active' ? 'success' : 'outline'} className="capitalize">{p.status}</Badge>
                  {p.status === 'active' ? (
                    <Button size="sm" variant="outline" onClick={() => setPlanStatus(p.id, 'paused')}>Pause</Button>
                  ) : p.status === 'paused' ? (
                    <Button size="sm" variant="outline" onClick={() => setPlanStatus(p.id, 'active')}>Resume</Button>
                  ) : null}
                  {p.status !== 'cancelled' && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPlanStatus(p.id, 'cancelled')}>Cancel</Button>
                  )}
                </div>
              ))}
              {plans.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No recurring plans — create one to save automatically.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Make a Deposit</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
              <div><Label>Amount</Label><Input type="number" min="1" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></div>
              <div>
                <Label>Savings Type</Label>
                <Select value={form.savingsType} onValueChange={(v) => setForm({ ...form, savingsType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="target">Target Savings</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Note (optional)</Label><Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Processing…' : 'Save Now'}</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Savings History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{formatDate(s.savings_date)}</TableCell>
                    <TableCell className="capitalize text-sm">{s.savings_type}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.note || '—'}</TableCell>
                    <TableCell className="text-right font-semibold text-green-600">{formatCurrency(s.amount)}</TableCell>
                  </TableRow>
                ))}
                {list.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No savings yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Lock a Fixed Deposit</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={lockFd} className="space-y-4">
              <div><Label>Amount</Label><Input type="number" min="1" required value={fdForm.amount} onChange={(e) => setFdForm({ ...fdForm, amount: e.target.value })} placeholder="0.00" /></div>
              <div>
                <Label>Tenure</Label>
                <Select value={String(fdForm.tenureMonths)} onValueChange={(v) => setFdForm({ ...fdForm, tenureMonths: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose tenure…" /></SelectTrigger>
                  <SelectContent>
                    {rates.map((r) => (
                      <SelectItem key={r.id} value={String(r.tenure_months)}>
                        {r.tenure_months} months @ {r.annual_rate}% p.a. (min {formatCurrency(r.min_amount)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full">Lock Deposit</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>My Fixed Deposits</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead>Matures</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {fds.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-right font-medium">{formatCurrency(f.amount)}</TableCell>
                    <TableCell className="text-sm">{f.tenure_months} mo @ {f.annual_rate}%</TableCell>
                    <TableCell className="text-sm">{formatDate(f.matures_at)}</TableCell>
                    <TableCell className="text-right text-green-600">{formatCurrency(f.expected_payout)}</TableCell>
                    <TableCell className="capitalize text-sm">{f.status}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {f.status === 'active' && (
                        f.claimable ? (
                          <Button size="sm" onClick={() => claimFd(f.id)}>Claim</Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => breakFd(f.id)}>Break</Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {fds.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No fixed deposits yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}