import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, initials } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MoreHorizontal, Check, X, ShieldCheck, FileSearch, Send, Wallet, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

const variant = {
  pending: 'warning', grantor_approved: 'secondary', kyc_failed: 'destructive',
  kyc_verified: 'default', disbursed: 'default', approved: 'secondary',
  rejected: 'destructive', repaid: 'success',
};

const STAGE_LABEL = {
  pending: '1 · Union vote (2-of-3)',
  grantor_approved: '2 · Officer KYC check',
  kyc_failed: '2 · KYC failed — retry',
  kyc_verified: '3 · Payment approval',
  disbursed: '4 · Disbursed',
  repaid: 'Repaid',
  rejected: 'Rejected',
};

function StageTracker({ status }) {
  const steps = ['Grantor', 'Officer KYC', 'Payment', 'Disbursed'];
  const idx = status === 'pending' ? 0
    : ['grantor_approved', 'kyc_failed'].includes(status) ? 1
    : status === 'kyc_verified' ? 2
    : ['disbursed', 'repaid'].includes(status) ? 4 : -1;
  if (idx === -1) return <Badge variant="destructive" className="capitalize">{status}</Badge>;
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <span className={cn(
            'text-[11px] px-2 py-0.5 rounded-full font-medium',
            i < idx ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
            : i === idx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}>
            {i + 1} · {s}
          </span>
          {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function AdminLoans() {
  const { user } = useAuth();
  const [loans, setLoans] = useState(null);
  const [detail, setDetail] = useState(null); // full file { loan, kyc, documents, guarantors, reviews }
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [kycResult, setKycResult] = useState(null);
  const [products, setProducts] = useState([]);
  const [pForm, setPForm] = useState({
    name: '', description: '', interestRate: '', penaltyRate: '5',
    minAmount: '', maxAmount: '', minDurationMonths: '1', maxDurationMonths: '12',
    requiredSavingsMultiple: '0', minMembershipMonths: '0', minSavingsMonths: '2',
    requiresGuarantors: false, guarantorCount: '0',
  });
  const [pOpen, setPOpen] = useState(false);

  const role = user?.role;
  const canGrantor = ['grantor', 'super_admin'].includes(role);
  const canOfficer = ['officer', 'admin', 'super_admin'].includes(role);
  const canPay = ['accountant', 'super_admin'].includes(role);

  const load = () => {
    api.get('/admin/loans').then(setLoans).catch((e) => toast.error(e.message));
    api.get('/admin/loan-products').then(setProducts).catch(() => setProducts([]));
  };
  useEffect(() => { load(); }, []);

  const openDetail = async (loan) => {
    setLoadingDetail(true);
    setDetail(null);
    setKycResult(null);
    setNote('');
    setMsg('');
    try {
      setDetail(await api.get(`/admin/loans/${loan.id}`));
    } catch (e) { toast.error(e.message); }
    finally { setLoadingDetail(false); }
  };

  const refreshDetail = async (id) => {
    try {
      setDetail(await api.get(`/admin/loans/${id}`));
      setKycResult(null);
      setNote('');
      setMsg('');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const call = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(okMsg);
      if (r?.kyc) setKycResult(r.kyc);
      if (detail) await refreshDetail(detail.loan.id);
      else load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const L = detail?.loan;

  const LoansTable = ({ rows }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="hidden lg:table-cell">Stage</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-12"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {!loans ? (
          Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}>{Array.from({ length: 5 }).map((__, j) => (
              <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
            ))}</TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No loans in this list</TableCell></TableRow>
        ) : rows.map((l) => (
          <TableRow key={l.id} className="cursor-pointer" onClick={() => openDetail(l)}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(l.first_name, l.last_name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">{l.first_name} {l.last_name}</p>
                  <p className="text-xs text-muted-foreground">{l.email}{l.org_code ? ` · ${l.org_code}` : ''}</p>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-right font-medium">{formatCurrency(l.amount)}</TableCell>
            <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{STAGE_LABEL[l.status] || l.status}</TableCell>
            <TableCell><Badge variant={variant[l.status]} className="capitalize">{String(l.status).replace('_', ' ')}</Badge></TableCell>
            <TableCell onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>File #{l.id}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => openDetail(l)}><FileSearch className="h-4 w-4" /> Open file</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const pending = (loans || []).filter((l) => l.status === 'pending');
  const kycQueue = (loans || []).filter((l) => ['grantor_approved', 'kyc_failed'].includes(l.status));
  const payQueue = (loans || []).filter((l) => l.status === 'kyc_verified');
  const done = (loans || []).filter((l) => ['disbursed', 'repaid', 'rejected'].includes(l.status));

  const num = (v, d = 0) => (v === '' || v === undefined ? d : Number(v));
  const createProduct = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/loan-products', {
        name: pForm.name, description: pForm.description || undefined,
        interestRate: Number(pForm.interestRate), penaltyRate: Number(pForm.penaltyRate),
        minAmount: num(pForm.minAmount), maxAmount: num(pForm.maxAmount) || null,
        minDurationMonths: num(pForm.minDurationMonths, 1), maxDurationMonths: num(pForm.maxDurationMonths, 12),
        requiredSavingsMultiple: Number(pForm.requiredSavingsMultiple),
        minMembershipMonths: num(pForm.minMembershipMonths),
        minSavingsMonths: Math.max(1, num(pForm.minSavingsMonths, 2)),
        requiresGuarantors: pForm.requiresGuarantors, guarantorCount: num(pForm.guarantorCount),
      });
      toast.success('Loan product created');
      setPOpen(false);
      setPForm({ name: '', description: '', interestRate: '', penaltyRate: '5', minAmount: '', maxAmount: '', minDurationMonths: '1', maxDurationMonths: '12', requiredSavingsMultiple: '0', minMembershipMonths: '0', minSavingsMonths: '2', requiresGuarantors: false, guarantorCount: '0' });
      load();
    } catch (e) { toast.error(e.message); }
  };
  const toggleProduct = async (p) => {
    try {
      await api.patch(`/admin/loan-products/${p.id}`, { status: p.status === 'active' ? 'archived' : 'active' });
      toast.success(`${p.name} updated`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm"
          onClick={() => download('/admin/export/loans.csv', 'mpcs-loans.csv').then(() => toast.success('Exported loans')).catch((e) => toast.error(e.message))}>
          Export CSV</Button>
      </div>
      <Tabs defaultValue="pending">
        <TabsList className="flex-wrap">
          <TabsTrigger value="pending">Grantor {pending.length > 0 && <Badge variant="warning" className="ml-2">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="kyc">Officer KYC {kycQueue.length > 0 && <Badge variant="warning" className="ml-2">{kycQueue.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="pay">Payment {payQueue.length > 0 && <Badge variant="warning" className="ml-2">{payQueue.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
        </TabsList>
        <TabsContent value="pending"><Card><CardContent className="p-0"><LoansTable rows={pending} /></CardContent></Card></TabsContent>
        <TabsContent value="kyc"><Card><CardContent className="p-0"><LoansTable rows={kycQueue} /></CardContent></Card></TabsContent>
        <TabsContent value="pay"><Card><CardContent className="p-0"><LoansTable rows={payQueue} /></CardContent></Card></TabsContent>
        <TabsContent value="all"><Card><CardContent className="p-0"><LoansTable rows={done} /></CardContent></Card></TabsContent>
        <TabsContent value="products">
          <Card><CardContent className="p-0">
            <div className="flex items-center justify-between p-4 border-b">
              <p className="text-sm text-muted-foreground">{products.length} products</p>
              <Button size="sm" onClick={() => setPOpen(true)}>New Product</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right hidden md:table-cell">Range</TableHead>
                <TableHead className="hidden lg:table-cell">Terms</TableHead>
                <TableHead>Status</TableHead><TableHead className="w-12"></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell><p className="font-medium text-sm">{p.name}</p><p className="text-xs text-muted-foreground">{p.description || '—'}</p></TableCell>
                    <TableCell className="text-right">{p.interest_rate}%</TableCell>
                    <TableCell className="text-right hidden md:table-cell text-sm">{formatCurrency(p.min_amount)}{p.max_amount ? ` – ${formatCurrency(p.max_amount)}` : '+'}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{p.min_duration_months}–{p.max_duration_months} mo · {p.min_savings_months ?? 2} mo savings</TableCell>
                    <TableCell><Badge variant={p.status === 'active' ? 'success' : 'outline'} className="capitalize">{p.status}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={() => toggleProduct(p)}>{p.status === 'active' ? 'Archive' : 'Activate'}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={pOpen} onOpenChange={setPOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Loan Product</DialogTitle></DialogHeader>
          <form onSubmit={createProduct} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name</Label><Input required value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} /></div>
            <div><Label>Interest % p.a.</Label><Input type="number" step="0.01" required value={pForm.interestRate} onChange={(e) => setPForm({ ...pForm, interestRate: e.target.value })} /></div>
            <div><Label>Penalty % (late)</Label><Input type="number" step="0.01" value={pForm.penaltyRate} onChange={(e) => setPForm({ ...pForm, penaltyRate: e.target.value })} /></div>
            <div><Label>Min amount</Label><Input type="number" value={pForm.minAmount} onChange={(e) => setPForm({ ...pForm, minAmount: e.target.value })} /></div>
            <div><Label>Max amount (blank = ∞)</Label><Input type="number" value={pForm.maxAmount} onChange={(e) => setPForm({ ...pForm, maxAmount: e.target.value })} /></div>
            <div><Label>Savings history (months, 2–3)</Label><Input type="number" min="1" value={pForm.minSavingsMonths} onChange={(e) => setPForm({ ...pForm, minSavingsMonths: e.target.value })} /></div>
            <div className="col-span-2"><DialogFooter><Button type="submit">Create Product</Button></DialogFooter></div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Loan file */}
      <Dialog open={loadingDetail || !!detail} onOpenChange={(v) => { if (!v) { setDetail(null); setKycResult(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          {loadingDetail || !detail ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading loan file…</p>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Loan #{L.id} — {formatCurrency(L.amount)}</DialogTitle>
                <DialogDescription>
                  {L.first_name} {L.last_name} · {L.email} · {L.employment_type || '—'}
                  {L.org_name ? ` · ${L.org_name} (${L.org_code})` : ''} · repayable {formatCurrency(L.total_repayable)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <StageTracker status={L.status} />
                {L.pushed_at && <p className="text-xs text-muted-foreground">Pushed to payment {formatDate(L.pushed_at)}</p>}

                {/* Borrower KYC snapshot */}
                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <p className="font-medium">Borrower KYC</p>
                  <p className="text-muted-foreground text-xs">
                    Profile: {detail.kyc ? `${detail.kyc.id_type} · ${detail.kyc.status}` : 'none on file'} ·{' '}
                    Documents: {detail.documents.length} · Guarantors: {detail.guarantors.length} ·{' '}
                    Email: {L.email_verified ? 'verified' : 'UNVERIFIED'}
                  </p>
                  {detail.kyc?.status !== 'approved' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">KYC profile is not approved — verification will likely fail until approved.</p>
                  )}
                </div>

                {/* Stage 1: grantor (2-of-3 union vote) */}
                {L.status === 'pending' && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-primary" /> Stage 1 · Union grantor vote (needs 2-of-3)</p>
                    {!canGrantor && <p className="text-xs text-muted-foreground">Only a seated grantor of {L.org_name || 'the member’s organisation'} (or super-admin override) can vote — one vote each, borrower excluded.</p>}
                    {(() => {
                      const seen = new Map();
                      for (const r of (detail.reviews || [])) {
                        if (r.stage === 'grantor' && ['approve', 'reject'].includes(r.action) && !seen.has(Number(r.reviewer_id))) {
                          seen.set(Number(r.reviewer_id), r.action);
                        }
                      }
                      const approvals = [...seen.values()].filter((v) => v === 'approve').length;
                      const rejections = [...seen.values()].filter((v) => v === 'reject').length;
                      return (
                        <p className="text-xs text-muted-foreground">
                          Votes so far: {approvals} approve · {rejections} reject
                          {seen.size > 0 && (
                            <span> ({(detail.reviews || []).filter((r) => r.stage === 'grantor' && ['approve', 'reject'].includes(r.action)).map((r) => `${r.first_name} ${r.last_name}: ${r.action}`).join('; ')})</span>
                          )}
                        </p>
                      );
                    })()}
                    <div><Label>Note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note…" /></div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy || !canGrantor} onClick={() => call(() => api.patch(`/admin/loans/${L.id}/grantor`, { decision: 'approve', note: note || undefined }), 'Vote recorded')}>
                        <Check className="h-4 w-4" /> Approve
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy || !canGrantor} onClick={() => call(() => api.patch(`/admin/loans/${L.id}/grantor`, { decision: 'reject', note: note || undefined }), 'Vote recorded')}>
                        <X className="h-4 w-4" /> Reject
                      </Button>
                    </div>
                  </div>
                )}

                {/* Stage 2: officer KYC */}
                {['grantor_approved', 'kyc_failed'].includes(L.status) && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5"><FileSearch className="h-4 w-4 text-primary" /> Stage 2 · Officer document verification</p>
                    {L.status === 'kyc_failed' && L.kyc_result && (
                      <div className="rounded-md bg-destructive/10 p-2.5 text-xs space-y-1">
                        <p className="font-semibold text-destructive">Failed checks (score {(typeof L.kyc_result === 'string' ? JSON.parse(L.kyc_result) : L.kyc_result)?.score ?? '—'}%):</p>
                        <ul className="list-disc pl-4">
                          {((typeof L.kyc_result === 'string' ? JSON.parse(L.kyc_result) : L.kyc_result)?.checks || []).filter((c) => !c.passed).map((c) => (
                            <li key={c.key}>{c.label} — {c.detail}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(kycResult || (L.status === 'kyc_failed' && L.kyc_result)) && kycResult && (
                      <div className={cn('rounded-md p-2.5 text-xs', kycResult.passed ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-destructive/10 text-destructive')}>
                        <p className="font-semibold">{kycResult.passed ? `Passed (${kycResult.score}%)` : `Failed (${kycResult.score}%): ${kycResult.failed.join('; ')}`}</p>
                      </div>
                    )}
                    <div><Label>Note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Verification note…" /></div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy || !canOfficer} onClick={() => call(() => api.post(`/admin/loans/${L.id}/verify-kyc`, { note: note || undefined }), 'KYC check complete')}>
                        <FileSearch className="h-4 w-4" /> Run full KYC check
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy || !canOfficer} onClick={() => {
                        const failed = kycResult && !kycResult.passed ? kycResult.failed.join('; ') : 'see loan file';
                        setMsg(`Loan #${L.id} documents failed: ${failed}. `);
                      }}>
                        <MessageSquare className="h-4 w-4" /> Message grantor
                      </Button>
                    </div>
                    {msg !== '' && (
                      <div className="space-y-2">
                        <Label>Message to grantor (goes to 1:1 chat + notification)</Label>
                        <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
                        <Button size="sm" variant="outline" disabled={busy || !msg.trim()} onClick={() => call(() => api.post(`/admin/loans/${L.id}/message-grantor`, { body: msg }), 'Message sent to grantor')}>
                          <Send className="h-4 w-4" /> Send to grantor
                        </Button>
                      </div>
                    )}
                    {!canOfficer && <p className="text-xs text-muted-foreground">Account-officer (officer/admin) stage.</p>}
                  </div>
                )}

                {/* kyc_verified awaiting push (officer) */}
                {L.status === 'kyc_verified' && !L.pushed_at && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5"><Send className="h-4 w-4 text-primary" /> KYC passed — push to payment</p>
                    <p className="text-xs text-muted-foreground">The officer pushes the verified file; the accountant can only disburse after the push.</p>
                    <div><Label>Note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Handover note for the payment approver…" /></div>
                    <Button size="sm" disabled={busy || !canOfficer} onClick={() => call(() => api.post(`/admin/loans/${L.id}/push`, { note: note || undefined }), 'Pushed — payment approver notified')}>
                      <Send className="h-4 w-4" /> Push to payment approval
                    </Button>
                    {!canOfficer && <p className="text-xs text-muted-foreground">Account-officer action.</p>}
                  </div>
                )}

                {/* Stage 3: payment */}
                {L.status === 'kyc_verified' && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1.5"><Wallet className="h-4 w-4 text-primary" /> Stage 3 · Payment approval {L.pushed_at ? '(pushed)' : '(awaiting officer push)'}</p>
                    <div><Label>Note</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Payment note…" /></div>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy || !canPay || !L.pushed_at} onClick={() => call(() => api.patch(`/admin/loans/${L.id}/disburse`, { note: note || undefined }), 'Disbursed — member notified')}>
                        <Check className="h-4 w-4" /> Approve & disburse {formatCurrency(L.amount)}
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy || !(canPay || canOfficer)} onClick={() => call(() => api.patch(`/admin/loans/${L.id}/reject`, { note: note || undefined }), 'Loan rejected')}>
                        <X className="h-4 w-4" /> Reject
                      </Button>
                    </div>
                    {!L.pushed_at && <p className="text-xs text-muted-foreground">Disburse unlocks after the officer pushes.</p>}
                    {!canPay && <p className="text-xs text-muted-foreground">Accountant (payment approver) stage.</p>}
                  </div>
                )}

                {/* Reviews timeline */}
                <div className="rounded-lg border p-3 text-sm">
                  <p className="font-medium mb-2">Trail</p>
                  <ul className="space-y-1.5">
                    {(detail.reviews || []).map((r) => (
                      <li key={r.id} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground capitalize">{r.stage.replace('_', ' ')} · {r.action.replace('_', ' ')}</span>
                        {' '}— {r.first_name ? `${r.first_name} ${r.last_name} (${r.role})` : 'member'} · {formatDate(r.created_at)}
                        {r.note && <span className="block italic">“{r.note}”</span>}
                      </li>
                    ))}
                    {(detail.reviews || []).length === 0 && <li className="text-xs text-muted-foreground">No reviews yet.</li>}
                  </ul>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
