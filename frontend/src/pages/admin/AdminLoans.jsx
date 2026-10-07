import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
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
import { MoreHorizontal, Check, X, CheckCircle2, XCircle } from 'lucide-react';

const variant = {
  pending: 'warning', disbursed: 'default',
  rejected: 'destructive', repaid: 'success', approved: 'secondary',
};

export default function AdminLoans() {
  const [loans, setLoans] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null); // { loan, action }
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState([]);
  const [pForm, setPForm] = useState({
    name: '', description: '', interestRate: '', penaltyRate: '5',
    minAmount: '', maxAmount: '', minDurationMonths: '1', maxDurationMonths: '12',
    requiredSavingsMultiple: '0', minMembershipMonths: '0',
    requiresGuarantors: false, guarantorCount: '0',
  });
  const [pOpen, setPOpen] = useState(false);

  const load = () => {
    api.get('/admin/loans').then(setLoans).catch((e) => toast.error(e.message));
    api.get('/admin/loan-products').then(setProducts).catch(() => setProducts([]));
  };
  useEffect(() => { load(); }, []);

  const submitReview = async () => {
    if (!reviewTarget) return;
    setSubmitting(true);
    try {
      await api.patch(`/admin/loans/${reviewTarget.loan.id}`, {
        status: reviewTarget.action,
        note: note || undefined,
      });
      toast.success(`Loan #${reviewTarget.loan.id} ${reviewTarget.action}`);
      setReviewTarget(null); setNote(''); load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const LoansTable = ({ rows, showActions }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right hidden md:table-cell">Repayable</TableHead>
          <TableHead className="text-right hidden md:table-cell">Paid</TableHead>
          <TableHead className="hidden lg:table-cell">Duration</TableHead>
          <TableHead className="hidden lg:table-cell">Date</TableHead>
          <TableHead>Status</TableHead>
          {showActions && <TableHead className="w-12"></TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {!loans ? (
          Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: showActions ? 8 : 7 }).map((__, j) => (
                <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={showActions ? 8 : 7} className="text-center py-10 text-muted-foreground">
              No loans in this list
            </TableCell>
          </TableRow>
        ) : rows.map((l) => (
          <TableRow key={l.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {initials(l.first_name, l.last_name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">{l.first_name} {l.last_name}</p>
                  <p className="text-xs text-muted-foreground">{l.email}</p>
                </div>
              </div>
            </TableCell>
            <TableCell className="text-right font-medium">{formatCurrency(l.amount)}</TableCell>
            <TableCell className="text-right hidden md:table-cell">{formatCurrency(l.total_repayable)}</TableCell>
            <TableCell className="text-right hidden md:table-cell">{formatCurrency(l.amount_paid)}</TableCell>
            <TableCell className="hidden lg:table-cell text-sm">{l.duration_months} mo</TableCell>
            <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
              {formatDate(l.created_at)}
            </TableCell>
            <TableCell>
              <Badge variant={variant[l.status]} className="capitalize">{l.status}</Badge>
            </TableCell>
            {showActions && (
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Review</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => { setReviewTarget({ loan: l, action: 'approved' }); setNote(''); }}>
                      <Check className="h-4 w-4 text-green-600" /> Approve & Disburse
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive"
                                      onClick={() => { setReviewTarget({ loan: l, action: 'rejected' }); setNote(''); }}>
                      <X className="h-4 w-4" /> Reject
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const pending = (loans || []).filter((l) => l.status === 'pending');
  const others = (loans || []).filter((l) => l.status !== 'pending');

  const num = (v, d = 0) => (v === '' || v === undefined ? d : Number(v));

  const createProduct = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/loan-products', {
        name: pForm.name,
        description: pForm.description || undefined,
        interestRate: Number(pForm.interestRate),
        penaltyRate: Number(pForm.penaltyRate),
        minAmount: num(pForm.minAmount),
        maxAmount: num(pForm.maxAmount) || null,
        minDurationMonths: num(pForm.minDurationMonths, 1),
        maxDurationMonths: num(pForm.maxDurationMonths, 12),
        requiredSavingsMultiple: Number(pForm.requiredSavingsMultiple),
        minMembershipMonths: num(pForm.minMembershipMonths),
        requiresGuarantors: pForm.requiresGuarantors,
        guarantorCount: num(pForm.guarantorCount),
      });
      toast.success('Loan product created');
      setPOpen(false);
      setPForm({
        name: '', description: '', interestRate: '', penaltyRate: '5',
        minAmount: '', maxAmount: '', minDurationMonths: '1', maxDurationMonths: '12',
        requiredSavingsMultiple: '0', minMembershipMonths: '0',
        requiresGuarantors: false, guarantorCount: '0',
      });
      load();
    } catch (e) { toast.error(e.message); }
  };

  const toggleProduct = async (p) => {
    const status = p.status === 'active' ? 'archived' : 'active';
    try {
      await api.patch(`/admin/loan-products/${p.id}`, { status });
      toast.success(`${p.name} ${status}`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button
          variant="outline" size="sm"
          onClick={() => download('/admin/export/loans.csv', 'mpcs-loans.csv').then(() => toast.success('Exported loans')).catch((e) => toast.error(e.message))}
        >
          Export CSV</Button>
      </div>
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending {pending.length > 0 && <Badge variant="warning" className="ml-2">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="all">All Loans</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <Card><CardContent className="p-0"><LoansTable rows={pending} showActions /></CardContent></Card>
        </TabsContent>
        <TabsContent value="all">
          <Card><CardContent className="p-0"><LoansTable rows={others} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="products">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-4 border-b">
                <p className="text-sm text-muted-foreground">{products.length} products</p>
                <Button size="sm" onClick={() => setPOpen(true)}>New Product</Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Range</TableHead>
                    <TableHead className="hidden lg:table-cell">Terms</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.description || '—'}</p>
                      </TableCell>
                      <TableCell className="text-right">{p.interest_rate}%</TableCell>
                      <TableCell className="text-right hidden md:table-cell text-sm">
                        {formatCurrency(p.min_amount)}{p.max_amount ? ` – ${formatCurrency(p.max_amount)}` : '+'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {p.min_duration_months}–{p.max_duration_months} mo
                        {Number(p.required_savings_multiple) > 0 && ` · ${p.required_savings_multiple}× savings`}
                        {p.requires_guarantors && ` · ${p.guarantor_count} guarantor(s)`}
                      </TableCell>
                      <TableCell><Badge variant={p.status === 'active' ? 'success' : 'outline'} className="capitalize">{p.status}</Badge></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => toggleProduct(p)}>
                          {p.status === 'active' ? 'Archive' : 'Activate'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {products.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No products</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={pOpen} onOpenChange={setPOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Loan Product</DialogTitle></DialogHeader>
          <form onSubmit={createProduct} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name</Label><Input required value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} /></div>
            <div className="col-span-2"><Label>Description</Label><Textarea rows={2} value={pForm.description} onChange={(e) => setPForm({ ...pForm, description: e.target.value })} /></div>
            <div><Label>Interest % p.a.</Label><Input type="number" step="0.01" required value={pForm.interestRate} onChange={(e) => setPForm({ ...pForm, interestRate: e.target.value })} /></div>
            <div><Label>Penalty % (late)</Label><Input type="number" step="0.01" value={pForm.penaltyRate} onChange={(e) => setPForm({ ...pForm, penaltyRate: e.target.value })} /></div>
            <div><Label>Min amount</Label><Input type="number" value={pForm.minAmount} onChange={(e) => setPForm({ ...pForm, minAmount: e.target.value })} /></div>
            <div><Label>Max amount (blank = ∞)</Label><Input type="number" value={pForm.maxAmount} onChange={(e) => setPForm({ ...pForm, maxAmount: e.target.value })} /></div>
            <div><Label>Min months</Label><Input type="number" value={pForm.minDurationMonths} onChange={(e) => setPForm({ ...pForm, minDurationMonths: e.target.value })} /></div>
            <div><Label>Max months</Label><Input type="number" value={pForm.maxDurationMonths} onChange={(e) => setPForm({ ...pForm, maxDurationMonths: e.target.value })} /></div>
            <div><Label>Required savings ×</Label><Input type="number" step="0.1" value={pForm.requiredSavingsMultiple} onChange={(e) => setPForm({ ...pForm, requiredSavingsMultiple: e.target.value })} /></div>
            <div><Label>Min membership mo</Label><Input type="number" value={pForm.minMembershipMonths} onChange={(e) => setPForm({ ...pForm, minMembershipMonths: e.target.value })} /></div>
            <div><Label>Guarantors needed</Label><Input type="number" value={pForm.guarantorCount} onChange={(e) => setPForm({ ...pForm, guarantorCount: e.target.value, requiresGuarantors: Number(e.target.value) > 0 })} /></div>
            <div className="col-span-2"><DialogFooter><Button type="submit">Create Product</Button></DialogFooter></div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={(v) => { if (!v) setReviewTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {reviewTarget?.action === 'approved' ? (
                <><CheckCircle2 className="h-5 w-5 text-green-600" /> Approve Loan</>
              ) : (
                <><XCircle className="h-5 w-5 text-destructive" /> Reject Loan</>
              )}
            </DialogTitle>
            <DialogDescription>
              Loan #{reviewTarget?.loan.id} — {formatCurrency(reviewTarget?.loan.amount)} for{' '}
              {reviewTarget?.loan.first_name} {reviewTarget?.loan.last_name}.
              {reviewTarget?.action === 'approved' && ' Funds will be credited to the member\'s wallet immediately.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Textarea rows={3} placeholder="Add context for the member…"
                      value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button
              variant={reviewTarget?.action === 'rejected' ? 'destructive' : 'default'}
              onClick={submitReview} disabled={submitting}
            >
              {submitting ? 'Processing…' : reviewTarget?.action === 'approved' ? 'Approve & Disburse' : 'Reject Loan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}