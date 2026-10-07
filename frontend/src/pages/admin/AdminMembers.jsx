import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, download } from '@/lib/api';
import { formatCurrency, formatDate, initials } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Search, UserX, UserCheck, Shield, ShieldOff, Wallet, Landmark } from 'lucide-react';
import {
  Dialog, DialogContent, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function AdminMembers() {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');
  const [fundTarget, setFundTarget] = useState(null);
  const [fundAmount, setFundAmount] = useState('');
  const [fundNote, setFundNote] = useState('');
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignNin, setAssignNin] = useState('');
  const [assignBvn, setAssignBvn] = useState('');

  const load = () => api.get('/admin/users').then(setUsers).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const changeStatus = async (u, status) => {
    try {
      await api.patch(`/admin/users/${u.id}/status`, { status });
      toast.success(`${u.first_name} ${status === 'active' ? 'activated' : 'suspended'}`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const changeRole = async (u, role) => {
    try {
      await api.patch(`/admin/users/${u.id}/role`, { role });
      toast.success(`${u.first_name} is now ${role}`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const reviewKyc = async (u, status) => {
    try {
      const r = await api.patch(`/kyc/${u.id}`, { status });
      if (status === 'approved') {
        if (r.virtualAccount) {
          toast.success(`KYC approved — funding account ${r.virtualAccount.account_number} assigned`);
        } else if (r.accountError) {
          toast.warning(`KYC approved, but account setup failed: ${r.accountError}`);
        } else {
          toast.success(`KYC approved for ${u.first_name} (no NIN on file — assign account manually)`);
        }
      } else {
        toast.success(`KYC rejected for ${u.first_name}`);
      }
      load();
    } catch (e) { toast.error(e.message); }
  };

  const submitFund = async () => {
    if (!fundTarget) return;
    try {
      await api.post('/admin/fund', {
        identifier: fundTarget.email,
        amount: Number(fundAmount),
        note: fundNote || undefined,
      });
      toast.success(`Funded ${fundTarget.first_name}'s wallet`);
      setFundTarget(null); setFundAmount(''); setFundNote('');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const submitAssign = async () => {
    if (!assignTarget) return;
    const clean = (v) => (/^\d{11}$/.test(v.trim()) ? v.trim() : undefined);
    try {
      await api.post('/virtual-accounts/assign', {
        userId: assignTarget.id,
        nin: clean(assignNin),
        bvn: clean(assignBvn),
      });
      toast.success(`Funding account assigned to ${assignTarget.first_name}`);
      setAssignTarget(null); setAssignNin(''); setAssignBvn('');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const filtered = (users || []).filter((u) =>
    `${u.first_name} ${u.last_name} ${u.email} ${u.phone || ''}`
      .toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <Card>
      <CardContent className="p-0">
        <div className="flex items-center gap-3 p-4 border-b">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search members…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ml-auto text-sm text-muted-foreground">{filtered.length} members</span>
          <Button
            variant="outline" size="sm"
            onClick={() => download('/admin/export/members.csv', 'mpcs-members.csv').then(() => toast.success('Exported members')).catch((e) => toast.error(e.message))}
          >
            Export CSV</Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="hidden md:table-cell">Funding Acct</TableHead>
                <TableHead className="hidden md:table-cell">Joined</TableHead>
              <TableHead className="text-right">Wallet</TableHead>
              <TableHead className="text-right hidden lg:table-cell">Savings</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!users ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                  No members found
                </TableCell>
              </TableRow>
            ) : filtered.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {initials(u.first_name, u.last_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">{u.first_name} {u.last_name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{u.phone || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm font-mono">
                  {u.funding_account || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {formatDate(u.created_at)}
                </TableCell>
                <TableCell className="text-right font-medium">{formatCurrency(u.balance)}</TableCell>
                <TableCell className="text-right hidden lg:table-cell">{formatCurrency(u.total_savings)}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => changeRole(u, v)}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge variant={u.status === 'active' ? 'success' : 'destructive'} className="capitalize">
                    {u.status}
                  </Badge>
                  {u.kyc_status && (
                    <Badge variant={u.kyc_status === 'approved' ? 'success' : u.kyc_status === 'pending' ? 'warning' : 'destructive'} className="capitalize ml-1">
                      KYC: {u.kyc_status}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {u.status === 'active' ? (
                        <DropdownMenuItem className="text-destructive focus:text-destructive"
                                          onClick={() => changeStatus(u, 'suspended')}>
                          <UserX className="h-4 w-4" /> Suspend
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => changeStatus(u, 'active')}>
                          <UserCheck className="h-4 w-4" /> Activate
                        </DropdownMenuItem>
                      )}
                      {u.kyc_status === 'pending' && (
                        <>
                          <DropdownMenuItem onClick={() => reviewKyc(u, 'approved')}>
                            <UserCheck className="h-4 w-4" /> Approve KYC
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive"
                                            onClick={() => reviewKyc(u, 'rejected')}>
                            <UserX className="h-4 w-4" /> Reject KYC
                          </DropdownMenuItem>
                        </>
                      )}
                      {u.role === 'member' ? (
                        <DropdownMenuItem onClick={() => changeRole(u, 'admin')}>
                          <Shield className="h-4 w-4" /> Promote to Admin
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => changeRole(u, 'member')}>
                          <ShieldOff className="h-4 w-4" /> Demote to Member
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => { setFundTarget(u); setFundAmount(''); setFundNote(''); }}>
                        <Wallet className="h-4 w-4" /> Fund Wallet
                      </DropdownMenuItem>
                      {!u.funding_account && (
                        <DropdownMenuItem onClick={() => { setAssignTarget(u); setAssignNin(''); setAssignBvn(''); }}>
                          <Landmark className="h-4 w-4" /> Assign Funding Acct
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!fundTarget} onOpenChange={(v) => { if (!v) setFundTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fund {fundTarget?.first_name} {fundTarget?.last_name}'s Wallet</DialogTitle>
          </DialogHeader>
          <div><Label>Amount (₦)</Label><Input type="number" min="1" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} placeholder="0.00" /></div>
          <div><Label>Note (optional)</Label><Textarea rows={2} value={fundNote} onChange={(e) => setFundNote(e.target.value)} placeholder="Reason for funding…" /></div>
          <DialogFooter><Button onClick={submitFund}>Confirm Funding</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignTarget} onOpenChange={(v) => { if (!v) setAssignTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Funding Account</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            For {assignTarget?.first_name} {assignTarget?.last_name} ({assignTarget?.email}).
            Static accounts need NIN or BVN — provide at least one.
          </p>
          <div><Label>NIN (11 digits, optional)</Label><Input inputMode="numeric" maxLength={11} value={assignNin} onChange={(e) => setAssignNin(e.target.value.replace(/\D/g, ''))} /></div>
          <div><Label>BVN (11 digits, optional)</Label><Input inputMode="numeric" maxLength={11} value={assignBvn} onChange={(e) => setAssignBvn(e.target.value.replace(/\D/g, ''))} /></div>
          <DialogFooter><Button onClick={submitAssign}>Assign Account</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}