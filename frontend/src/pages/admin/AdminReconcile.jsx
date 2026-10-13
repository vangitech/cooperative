import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Scale, Play, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function AdminReconcile() {
  const [runs, setRuns] = useState(null);
  const [suspense, setSuspense] = useState(null);
  const [floats, setFloats] = useState({ '1001': '', '1002': '' });
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [resolveTarget, setResolveTarget] = useState(null);
  const [resolution, setResolution] = useState('');

  const load = async () => {
    try {
      const [r, s] = await Promise.all([
        api.get('/admin/ledger/reconcile/runs'),
        api.get('/admin/ledger/suspense'),
      ]);
      setRuns(r);
      setSuspense(s);
    } catch (e) {
      toast.error(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const run = async () => {
    setRunning(true);
    try {
      const statements = Object.entries(floats)
        .filter(([, v]) => v !== '' && Number(v) >= 0)
        .map(([code, v]) => ({ code, balance: Number(v) }));
      const r = await api.post('/admin/ledger/reconcile/run', { statements });
      setLastRun(r);
      toast[r.passed ? 'success' : 'warning'](
        r.passed ? 'Reconciliation passed — books tie' : 'Mismatches filed to suspense'
      );
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  const resolve = async () => {
    if (!resolveTarget || !resolution.trim()) return;
    try {
      await api.patch(`/admin/ledger/suspense/${resolveTarget.id}/resolve`, { resolution });
      toast.success('Suspense item resolved');
      setResolveTarget(null);
      setResolution('');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const open = (suspense || []).filter((s) => s.status === 'open');

  return (
    <div className="w-full space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4 text-primary" /> Run Reconciliation
          </CardTitle>
          <CardDescription>
            Trial balance · wallets vs control · negative guards · settlement floats vs provider statements
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
            <div>
              <Label>Float 1001 statement (optional)</Label>
              <Input type="number" placeholder="MFB settlement balance" value={floats['1001']}
                     onChange={(e) => setFloats({ ...floats, '1001': e.target.value })} />
            </div>
            <div>
              <Label>Float 1002 statement (optional)</Label>
              <Input type="number" placeholder="Flutterwave balance" value={floats['1002']}
                     onChange={(e) => setFloats({ ...floats, '1002': e.target.value })} />
            </div>
          </div>
          <Button onClick={run} disabled={running}>
            <Play className="h-4 w-4" /> {running ? 'Running…' : 'Run checks'}
          </Button>
          {lastRun && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p className="font-medium flex items-center gap-2">
                {lastRun.passed
                  ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  : <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />}
                {lastRun.passed ? 'All checks passed' : 'Mismatches found'} · {formatDateTime(lastRun.runAt)}
              </p>
              {lastRun.checks.map((c) => (
                <p key={c.kind} className="text-xs text-muted-foreground">
                  {c.passed ? '✓' : '✗'} {c.label}
                  {!c.passed && ` — expected ${formatCurrency(c.expected)}, actual ${formatCurrency(c.actual)}`}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Suspense Queue ({open.length} open)</CardTitle>
          <CardDescription>Mismatches are never auto-adjusted — resolve with a note</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!suspense ? (
            <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : suspense.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No suspense items — books are clean.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Raised</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suspense.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm font-mono">{s.kind}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(s.expected)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(s.actual)}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'open' ? 'destructive' : 'success'} className="capitalize">
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {formatDateTime(s.created_at)}
                    </TableCell>
                    <TableCell>
                      {s.status === 'open' && (
                        <Button variant="ghost" size="sm" onClick={() => setResolveTarget(s)}>Resolve</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Run History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!runs ? (
            <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : runs.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Checks</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(r.run_at)}</TableCell>
                    <TableCell>
                      <Badge variant={r.passed ? 'success' : 'destructive'}>
                        {r.passed ? 'Passed' : 'Mismatches'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{(r.checks || []).length}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {r.run_by_email || 'system'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resolveTarget} onOpenChange={(v) => !v && setResolveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {resolveTarget?.kind}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Resolution note (required — part of the permanent record)</Label>
              <Input value={resolution} onChange={(e) => setResolution(e.target.value)}
                     placeholder="e.g. matched to MFB Oct statement line 12" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setResolveTarget(null)}>Cancel</Button>
            <Button onClick={resolve} disabled={!resolution.trim()}>Resolve</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
