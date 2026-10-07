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

  const load = async () => {
    const [s, l] = await Promise.all([api.get('/savings/summary'), api.get('/savings')]);
    setSummary(s); setList(l);
  };
  useEffect(() => { load(); }, []);

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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Today" value={formatCurrency(summary?.today)} icon={CalendarDays} />
        <StatCard title="This Week" value={formatCurrency(summary?.this_week)} icon={CalendarRange} />
        <StatCard title="This Month" value={formatCurrency(summary?.this_month)} icon={CalendarClock} />
        <StatCard title="Total Savings" value={formatCurrency(summary?.total)} icon={PiggyBank} hint={`${summary?.count || 0} deposits`} />
      </div>

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
    </div>
  );
}