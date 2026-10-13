import { useState } from 'react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  FileText, Users, PiggyBank, HandCoins, Coins, Receipt, ScrollText,
  Download, Printer, CalendarDays, Building2,
} from 'lucide-react';

const REPORTS = [
  { type: 'financial-summary', label: 'Financial Summary', icon: FileText, desc: 'Savings, loans, repayments, dividends & membership for the period.' },
  { type: 'member-register', label: 'Member Register', icon: Users, desc: 'Every member with status, join date, wallet and savings totals.' },
  { type: 'savings-ledger', label: 'Savings Ledger', icon: PiggyBank, desc: 'All savings entries booked in the period.' },
  { type: 'loan-book', label: 'Loan Book', icon: HandCoins, desc: 'All loans with disbursed, repaid and outstanding balances.' },
  { type: 'dividend-register', label: 'Dividend Register', icon: Coins, desc: 'Dividends declared and paid in the period.' },
  { type: 'transaction-ledger', label: 'Transaction Ledger', icon: Receipt, desc: 'Every wallet movement in the period.' },
  { type: 'audit-trail', label: 'Audit Trail', icon: ScrollText, desc: 'Who did what, when — system activity for the period.' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const now = new Date();

function buildQuery(type, sel) {
  const q = new URLSearchParams({ period: sel.period });
  if (sel.period === 'monthly') { q.set('year', sel.year); q.set('month', sel.month); }
  if (sel.period === 'quarterly') { q.set('year', sel.year); q.set('quarter', sel.quarter); }
  if (sel.period === 'yearly') { q.set('year', sel.year); }
  if (sel.period === 'custom') { q.set('from', sel.from); q.set('to', sel.to); }
  return `/admin/reports/${type}?${q}`;
}

function fmtCell(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v;
  const d = new Date(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(d.getTime())) {
    return d.toLocaleString();
  }
  return String(v);
}

export default function AdminReports() {
  const [type, setType] = useState('financial-summary');
  const [sel, setSel] = useState({
    period: 'monthly', year: String(now.getFullYear()),
    month: String(now.getMonth() + 1), quarter: String(Math.floor(now.getMonth() / 3) + 1),
    from: '', to: '',
  });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (k) => (v) => setSel((s) => ({ ...s, [k]: v }));
  const active = REPORTS.find((r) => r.type === type);

  const generate = async () => {
    setLoading(true);
    setReport(null);
    try {
      setReport(await api.get(buildQuery(type, sel)));
      toast.success('Report generated — logged to audit trail');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = () => {
    download(`${buildQuery(type, sel)}&format=csv`, `mpcs-${type}.csv`)
      .then(() => toast.success('CSV downloaded'))
      .catch((e) => toast.error(e.message));
  };

  const moneyCols = new Set(['Value', 'Amount', 'Wallet', 'Total savings', 'Repayable', 'Paid', 'Balance after']);
  const showRows = (report?.rows || []).slice(0, 100);

  return (
    <div className="w-full space-y-6">
      {/* Type picker */}
      <div>
        <h2 className="text-sm font-medium mb-2 flex items-center gap-1.5">
          <Building2 className="h-4 w-4 text-muted-foreground" /> 1 · Choose report
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {REPORTS.map(({ type: t, label, icon: Icon, desc }) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                'text-left rounded-lg border p-4 transition-colors',
                type === t
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'bg-card hover:border-primary/50',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon className={cn('h-4 w-4', type === t ? 'text-primary' : 'text-muted-foreground')} />
                {label}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Period picker */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" /> 2 · Choose period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            {['monthly', 'quarterly', 'yearly', 'custom'].map((p) => (
              <Button
                key={p} variant={sel.period === p ? 'default' : 'outline'} size="sm"
                onClick={() => setSel((s) => ({ ...s, period: p }))} className="capitalize"
              >
                {p}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3 max-w-2xl">
            {(sel.period === 'monthly' || sel.period === 'quarterly' || sel.period === 'yearly') && (
              <div>
                <Label>Year</Label>
                <Input type="number" min={2000} max={2100} value={sel.year} onChange={(e) => set('year')(e.target.value)} />
              </div>
            )}
            {sel.period === 'monthly' && (
              <div>
                <Label>Month</Label>
                <Select value={sel.month} onValueChange={set('month')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {sel.period === 'quarterly' && (
              <div>
                <Label>Quarter</Label>
                <Select value={sel.quarter} onValueChange={set('quarter')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'].map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {sel.period === 'custom' && (
              <>
                <div><Label>From</Label><Input type="date" value={sel.from} onChange={(e) => set('from')(e.target.value)} /></div>
                <div><Label>To</Label><Input type="date" value={sel.to} onChange={(e) => set('to')(e.target.value)} /></div>
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={generate} disabled={loading}>
              <FileText className="h-4 w-4" /> {loading ? 'Generating…' : `Generate ${active.label}`}
            </Button>
            {report && (
              <>
                <Button variant="outline" onClick={downloadCsv}>
                  <Download className="h-4 w-4" /> Download CSV
                </Button>
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print / PDF
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {loading && (
        <Card><CardContent className="p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent></Card>
      )}

      {report && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">MPCS · Regulatory report</p>
                <CardTitle className="text-lg">{active.label} — {report.label}</CardTitle>
                <CardDescription>
                  Generated {new Date(report.generatedAt).toLocaleString()} by {report.generatedBy} ·
                  {' '}{report.rows.length} row{report.rows.length !== 1 && 's'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {type === 'financial-summary' ? (
              <div className="grid gap-3 sm:grid-cols-2 p-4 md:p-6">
                {report.rows.map(([metric, value]) => (
                  <div key={metric} className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <span className="text-sm text-muted-foreground">{metric}</span>
                    <span className="text-sm font-bold">
                      {typeof value === 'number' && metric !== 'New members admitted' && metric !== 'Transactions processed'
                        ? formatCurrency(value) : value}
                    </span>
                  </div>
                ))}
              </div>
            ) : report.rows.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">No records in this period.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {report.columns.map((c) => (
                          <TableHead key={c} className={moneyCols.has(c) ? 'text-right' : ''}>{c}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {showRows.map((row, i) => (
                        <TableRow key={i}>
                          {row.map((v, j) => (
                            <TableCell
                              key={j}
                              className={cn(
                                'text-xs whitespace-nowrap',
                                moneyCols.has(report.columns[j]) && 'text-right font-medium',
                              )}
                            >
                              {moneyCols.has(report.columns[j]) && typeof v === 'number' && v !== null
                                ? formatCurrency(v) : fmtCell(v)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {report.rows.length > 100 && (
                  <p className="px-4 py-3 border-t text-sm text-muted-foreground">
                    Showing first 100 of {report.rows.length} rows — download the CSV for the full report.
                  </p>
                )}
              </>
            )}
            {/* Sign-off block for filings */}
            <div className="grid gap-6 sm:grid-cols-2 p-4 md:p-6 border-t text-sm">
              <div><p className="text-muted-foreground text-xs mb-6">Prepared by (name / signature / date)</p><div className="border-b" /></div>
              <div><p className="text-muted-foreground text-xs mb-6">Approved by (name / signature / date)</p><div className="border-b" /></div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
