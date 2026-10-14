import { useState } from 'react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, Printer, CalendarDays } from 'lucide-react';

function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function defaultRange(period) {
  const now = new Date();
  if (period === 'weekly') {
    const s = startOfWeek(now);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    return { from: toISO(s), to: toISO(e > now ? now : e) };
  }
  if (period === 'monthly') {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: toISO(now) };
  }
  if (period === 'quarterly') {
    const q = Math.floor(now.getMonth() / 3);
    const sm = q * 3 + 1;
    return { from: `${now.getFullYear()}-${String(sm).padStart(2, '0')}-01`, to: toISO(now) };
  }
  return { from: `${now.getFullYear()}-01-01`, to: toISO(now) };
}

export default function Statement() {
  const [period, setPeriod] = useState('monthly');
  const [range, setRange] = useState(() => defaultRange('monthly'));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const pick = (p) => {
    setPeriod(p);
    setRange(defaultRange(p));
    setReport(null);
  };

  const generate = async () => {
    if (!range.from || !range.to) return toast.error('Pick from and to dates');
    if (range.from > range.to) return toast.error('From must be before To');
    setLoading(true);
    setReport(null);
    try {
      const r = await api.get(`/wallet/statement?from=${range.from}&to=${range.to}`);
      setReport({ ...r, period });
      toast.success('Statement generated');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = () => {
    download(`/wallet/statement.csv?from=${range.from}&to=${range.to}`, `mpcs-statement-${range.from}-to-${range.to}.csv`)
      .then(() => toast.success('CSV downloaded'))
      .catch((e) => toast.error(e.message));
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" /> Report — Statement of Account
          </CardTitle>
          <CardDescription>
            Generate your own statement for any week, month, quarter or year. Choose a period, pick dates, then preview, download or print.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {['weekly', 'monthly', 'quarterly', 'annually'].map((p) => (
              <Button key={p} variant={period === p ? 'default' : 'outline'} size="sm" onClick={() => pick(p)} className="capitalize">
                {p === 'annually' ? 'Annually' : p}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 max-w-xl">
            <div><Label className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> From</Label><Input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
            <div><Label>To</Label><Input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
            <div className="flex items-end"><Button onClick={generate} disabled={loading} className="w-full">{loading ? 'Generating…' : 'Generate'}</Button></div>
          </div>
          {report && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadCsv}><Download className="h-4 w-4" /> Download CSV</Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / PDF</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {report.member ? `${report.member.first_name} ${report.member.last_name} — ` : ''}Statement {report.from} → {report.to}
            </CardTitle>
            <CardDescription className="capitalize">
              {report.period} report · generated {formatDateTime(report.generatedAt)} · {report.summary.count} transaction(s)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                { label: 'Opening balance', value: formatCurrency(report.openingBalance) },
                { label: 'Inflow', value: formatCurrency(report.summary.inflow) },
                { label: 'Outflow', value: formatCurrency(report.summary.outflow) },
                { label: 'Closing balance', value: formatCurrency(report.closingBalance) },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border px-3 py-2">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="font-bold text-sm">{s.value}</p>
                </div>
              ))}
            </div>
            {report.transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No transactions in this period.</p>
            ) : (
              <div className="overflow-x-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.transactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTime(t.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize text-[11px]">{String(t.type).replace(/_/g, ' ')}</Badge></TableCell>
                        <TableCell className="text-xs">{t.description || '—'}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{formatCurrency(t.amount)}</TableCell>
                        <TableCell className="text-right text-xs">{formatCurrency(t.balance_after)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="grid gap-6 sm:grid-cols-2 pt-4 border-t text-sm">
              <div><p className="text-muted-foreground text-xs mb-6">Member signature / date</p><div className="border-b" /></div>
              <div><p className="text-muted-foreground text-xs mb-6">Authorised signatory / date</p><div className="border-b" /></div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
