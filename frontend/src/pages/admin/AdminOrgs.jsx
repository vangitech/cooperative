import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Building2, Plus, Users, Crown, UserPlus, UserMinus } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';

const ORG_TYPES = [
  'general', 'cooperative_branch', 'employer', 'department',
  'unit', 'trade_association', 'market', 'government_mda', 'private_sector',
];

// Union helper text per type: a market holds trade unions as children.
const TYPE_HINTS = {
  market: 'A market (e.g. Utako Market) holds trade unions as children — create each union as a trade association with this market as parent.',
  trade_association: 'A union (e.g. Trader Union, Cloth Union) — set its parent to the market it trades in. Seats 3 grantors (union leaders).',
};

const emptyForm = {
  name: '', code: '', type: 'cooperative_branch', parentId: '', contactName: '',
  contactPhone: '', address: '', status: 'active',
};

export default function AdminOrgs() {
  const { user } = useAuth();
  const canSeat = ['admin', 'super_admin'].includes(user?.role);
  const [orgs, setOrgs] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState(null);
  const [membersOrg, setMembersOrg] = useState(null);
  const [grantors, setGrantors] = useState(null);
  const [grantorsOrg, setGrantorsOrg] = useState(null);

  const load = () => api.get('/orgs/all').then(setOrgs).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (o) => {
    setEditing(o);
    setForm({
      name: o.name, code: o.code, type: o.type, parentId: o.parent_id || '',
      contactName: o.contact_name || '', contactPhone: o.contact_phone || '',
      address: o.address || '', status: o.status,
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        const rest = { ...form };
        delete rest.code; // codes are frozen — existing member IDs embed them
        await api.patch(`/orgs/${editing.id}`, { ...rest, parentId: rest.parentId || null });
        toast.success('Organisation updated');
      } else {
        await api.post('/orgs', { ...form, parentId: form.parentId || null });
        toast.success('Organisation created');
      }
      setOpen(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const viewMembers = async (o) => {
    setMembersOrg(o);
    setMembers(null);
    try {
      setMembers(await api.get(`/orgs/${o.id}/members`));
    } catch (e) { toast.error(e.message); }
  };

  const viewGrantors = async (o) => {
    setGrantorsOrg(o);
    setGrantors(null);
    try {
      setGrantors(await api.get(`/orgs/${o.id}/grantors`));
    } catch (e) { toast.error(e.message); }
  };

  const seatGrantor = async (member) => {
    try {
      await api.post(`/orgs/${membersOrg.id}/grantors`, { userId: member.id });
      toast.success(`${member.first_name} ${member.last_name} seated as union grantor`);
      viewMembers(membersOrg);
      if (grantorsOrg?.id === membersOrg.id) viewGrantors(grantorsOrg);
    } catch (e) { toast.error(e.message); }
  };

  const unseatGrantor = async (g) => {
    if (!window.confirm(`Remove ${g.first_name} ${g.last_name} as grantor?`)) return;
    try {
      await api.del(`/orgs/${grantorsOrg.id}/grantors/${g.id}`);
      toast.success('Grantor seat removed');
      viewGrantors(grantorsOrg);
    } catch (e) { toast.error(e.message); }
  };

  const totals = (members || []).reduce(
    (s, m) => ({ balance: s.balance + Number(m.balance), savings: s.savings + Number(m.total_savings) }),
    { balance: 0, savings: 0 }
  );

  return (
    <div className="w-full space-y-6">
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4 border-b">
            <span className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Organisations
            </span>
            <span className="text-sm text-muted-foreground">{(orgs || []).length} total</span>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="ml-auto" onClick={openCreate}>
                  <Plus className="h-4 w-4" /> New organisation
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editing ? 'Edit organisation' : 'New organisation'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><Label>Name</Label><Input required value={form.name} onChange={update('name')} placeholder="e.g. Lagos Main Market" /></div>
                    <div>
                      <Label>Code {editing && '(frozen — in member IDs)'}</Label>
                      <Input required={!editing} disabled={!!editing} value={form.code} onChange={update('code')} placeholder="LAG-MKT" className="font-mono uppercase" />
                    </div>
                    <div>
                      <Label>Type</Label>
                      <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm capitalize" value={form.type} onChange={update('type')}>
                        {ORG_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label>Parent (market / head organisation — unions sit under their market)</Label>
                      <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.parentId} onChange={update('parentId')}>
                        <option value="">None — top level (e.g. a market)</option>
                        {(orgs || []).filter((o) => !editing || o.id !== editing.id).map((o) => (
                          <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                        ))}
                      </select>
                    </div>
                    {TYPE_HINTS[form.type] && (
                      <p className="col-span-2 text-xs text-muted-foreground">{TYPE_HINTS[form.type]}</p>
                    )}
                    <div><Label>Contact name</Label><Input value={form.contactName} onChange={update('contactName')} /></div>
                    <div><Label>Contact phone</Label><Input value={form.contactPhone} onChange={update('contactPhone')} /></div>
                    <div className="col-span-2"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={update('address')} /></div>
                    {editing && (
                      <div>
                        <Label>Status</Label>
                        <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.status} onChange={update('status')}>
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button type="submit">{editing ? 'Save changes' : 'Create organisation'}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Parent</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!orgs ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              ) : orgs.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{o.name}</p>
                    {o.contact_phone && <p className="text-xs text-muted-foreground">{o.contact_phone}</p>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{o.code}</TableCell>
                  <TableCell className="text-sm capitalize">{o.type.replaceAll('_', ' ')}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{o.parent_name || '—'}</TableCell>
                  <TableCell className="text-right font-medium">{o.members}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === 'active' ? 'success' : 'outline'} className="capitalize">{o.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" title="Members" onClick={() => viewMembers(o)}>
                        <Users className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" title="Union grantors (3 seats, 2-of-3 agree on loans)" onClick={() => viewGrantors(o)}>
                        <Crown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(o)}>Edit</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {membersOrg && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-3 p-4 border-b">
              <span className="text-sm font-medium">{membersOrg.name} — members</span>
              <span className="text-sm text-muted-foreground">
                {(members || []).length} members · {formatCurrency(totals.balance)} wallets · {formatCurrency(totals.savings)} savings
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setMembersOrg(null)}>Close</Button>
            </div>
            {!members ? (
              <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : members.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No members in this organisation yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Member ID</TableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="text-right">Wallet</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Savings</TableHead>
                    <TableHead>Status</TableHead>
                    {canSeat && <TableHead className="w-12" title="Seat as grantor"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{m.first_name} {m.last_name}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.member_no}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm">{m.phone || '—'}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(m.balance)}</TableCell>
                      <TableCell className="text-right hidden lg:table-cell">{formatCurrency(m.total_savings)}</TableCell>
                      <TableCell><Badge variant={m.status === 'active' ? 'success' : 'destructive'} className="capitalize">{m.status}</Badge></TableCell>
                      {canSeat && (
                        <TableCell>
                          <Button variant="ghost" size="sm" title="Seat as union grantor (must be fully registered)" onClick={() => seatGrantor(m)}>
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {grantorsOrg && (
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-3 p-4 border-b">
              <span className="text-sm font-medium flex items-center gap-2">
                <Crown className="h-4 w-4 text-primary" /> {grantorsOrg.name} — union grantors ({(grantors?.grantors || []).length}/3)
              </span>
              <span className="text-sm text-muted-foreground">2-of-3 must agree before a loan moves</span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setGrantorsOrg(null)}>Close</Button>
            </div>
            {!grantors ? (
              <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : grantors.grantors.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No grantors seated yet — open the members list above and seat 3 fully-registered union leaders.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Grantor</TableHead>
                    <TableHead>Member ID</TableHead>
                    <TableHead className="hidden md:table-cell">Seated</TableHead>
                    {canSeat && <TableHead className="w-12"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grantors.grantors.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{g.first_name} {g.last_name}</p>
                        <p className="text-xs text-muted-foreground">{g.email}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{g.member_no}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {g.assigned_at?.slice(0, 10)}{g.assigned_by_first ? ` by ${g.assigned_by_first} ${g.assigned_by_last || ''}` : ''}
                      </TableCell>
                      {canSeat && (
                        <TableCell>
                          <Button variant="ghost" size="sm" className="text-destructive" title="Remove seat" onClick={() => unseatGrantor(g)}>
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
