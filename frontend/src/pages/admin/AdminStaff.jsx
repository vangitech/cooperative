import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatDate, initials } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { MoreHorizontal, Crown, ShieldCheck } from 'lucide-react';

const STAFF_ROLES = ['admin', 'officer', 'accountant', 'grantor'];

const roleVariant = { super_admin: 'default', admin: 'secondary', officer: 'outline', accountant: 'outline', grantor: 'success' };

export default function AdminStaff() {
  const { user } = useAuth();
  const [staff, setStaff] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', phone: '', role: 'officer', orgId: '' });

  const isSuper = user?.role === 'super_admin';

  const load = () => {
    api.get('/admin/staff').then(setStaff).catch((e) => toast.error(e.message));
    api.get('/orgs/all').then(setOrgs).catch(() => api.get('/orgs').then(setOrgs).catch(() => setOrgs([])));
  };
  useEffect(() => { load(); }, []);

  if (!isSuper) {
    return (
      <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
        <Crown className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
        Only the super-admin can staff admins and assign roles.
      </CardContent></Card>
    );
  }

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/staff', {
        firstName: form.firstName, lastName: form.lastName, email: form.email,
        password: form.password, phone: form.phone || undefined,
        role: form.role, orgId: form.orgId ? Number(form.orgId) : undefined,
      });
      toast.success(`${form.email} staffed as ${form.role}`);
      setOpen(false);
      setForm({ firstName: '', lastName: '', email: '', password: '', phone: '', role: 'officer', orgId: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const assign = async (u, role) => {
    try {
      await api.patch(`/admin/users/${u.id}/role`, { role });
      toast.success(`${u.first_name} is now ${role}`);
      load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Crown className="h-5 w-5 text-primary" /> Staff & Roles</CardTitle>
            <CardDescription>
              Super-admin console — staff admins, officers, accountants and grantors, and assign anyone to a role.
              Admins keep operational rights but cannot grant roles.
            </CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm">Staff member</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Staff a new admin/officer/accountant/grantor</DialogTitle></DialogHeader>
              <form onSubmit={create} className="grid grid-cols-2 gap-3">
                <div><Label>First name</Label><Input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
                <div><Label>Last name</Label><Input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
                <div className="col-span-2"><Label>Email</Label><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div><Label>Password (min 6)</Label><Input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div>
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAFF_ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Organisation</Label>
                  <Select value={form.orgId} onValueChange={(v) => setForm({ ...form, orgId: v })}>
                    <SelectTrigger><SelectValue placeholder="General…" /></SelectTrigger>
                    <SelectContent>
                      {(orgs || []).map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name} ({o.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <DialogFooter><Button type="submit">Create staff</Button></DialogFooter>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden md:table-cell">Organisation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Since</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(staff || []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(u.first_name, u.last_name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm flex items-center gap-1.5">
                          {u.first_name} {u.last_name}
                          {u.role === 'super_admin' && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                        </p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={roleVariant[u.role] || 'outline'} className="capitalize">{u.role.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{u.org_name ? `${u.org_name} (${u.org_code})` : '—'}</TableCell>
                  <TableCell><Badge variant={u.status === 'active' ? 'success' : 'destructive'} className="capitalize">{u.status}</Badge></TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                  <TableCell>
                    {u.id !== user.id && u.role !== 'super_admin' && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Assign role</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {['member', ...STAFF_ROLES, 'admin'].map((r) => (
                            <DropdownMenuItem key={r} onClick={() => assign(u, r)} className="capitalize">
                              {r.replace('_', ' ')}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {staff && staff.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No staff yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
