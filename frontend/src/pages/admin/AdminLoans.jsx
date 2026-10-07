import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
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

  const load = () => api.get('/admin/loans').then(setLoans).catch((e) => toast.error(e.message));
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

  return (
    <>
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">
            Pending {pending.length > 0 && <Badge variant="warning" className="ml-2">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="all">All Loans</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          <Card><CardContent className="p-0"><LoansTable rows={pending} showActions /></CardContent></Card>
        </TabsContent>
        <TabsContent value="all">
          <Card><CardContent className="p-0"><LoansTable rows={others} /></CardContent></Card>
        </TabsContent>
      </Tabs>

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