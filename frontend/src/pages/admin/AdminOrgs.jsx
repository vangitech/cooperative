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
import { Building2, Plus, Users, Crown, UserPlus, UserMinus, ChevronDown, ChevronRight, ArrowRightLeft, Pencil, Trash2 } from 'lucide-react';

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
  const [expanded, setExpanded] = useState({});
  const [moveTarget, setMoveTarget] = useState(null); // member row being moved
  const [moveOrgId, setMoveOrgId] = useState('');
  const [q, setQ] = useState('');
  // Seat dialog: seat a new grantor (phone required, email optional) or
  // edit an existing seat's official contact.
  const [seatTarget, setSeatTarget] = useState(null); // { member } or { seat, isEdit }
  const [seatPhone, setSeatPhone] = useState('');
  const [seatEmail, setSeatEmail] = useState('');
  // Creation-time grantor picker: up to 3 leaders with union contacts.
  const [allMembers, setAllMembers] = useState([]);
  const [gSearch, setGSearch] = useState('');
  const [gPicks, setGPicks] = useState([]);

  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !(e[id] ?? true) }));

  const load = () => api.get('/orgs/all').then(setOrgs).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openCreate = () => {
    setEditing(null); setForm(emptyForm); setOpen(true);
    setGPicks([]); setGSearch('');
    api.get('/admin/users').then(setAllMembers).catch(() => setAllMembers([]));
  };
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
        for (const p of gPicks) {
          if (!p.seatPhone.trim()) throw new Error(`Union phone is required for ${p.name}`);
        }
        const r = await api.post('/orgs', {
          ...form,
          parentId: form.parentId || null,
          grantors: gPicks.map((p) => ({
            userId: p.id,
            phone: p.seatPhone.trim(),
            email: p.seatEmail.trim() || undefined,
          })),
        });
        toast.success(
          gPicks.length
            ? `Organisation created with ${r.grantors?.length ?? gPicks.length} grantor${gPicks.length === 1 ? '' : 's'}`
            : 'Organisation created — seat 3 grantors from its members next'
        );
      }
      setOpen(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const gMatches = gSearch.trim()
    ? allMembers
        .filter((u) => u.role !== 'super_admin' && u.status === 'active' && !gPicks.some((p) => p.id === u.id))
        .filter((u) => `${u.first_name} ${u.last_name} ${u.email} ${u.member_no || ''}`.toLowerCase().includes(gSearch.toLowerCase()))
        .slice(0, 6)
    : [];

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

  const openSeat = (member) => {
    setSeatTarget({ member });
    setSeatPhone(member.phone || '');
    setSeatEmail('');
  };

  const openSeatEdit = (seat) => {
    setSeatTarget({ seat, isEdit: true });
    setSeatPhone(seat.contact_phone || seat.phone || '');
    setSeatEmail(seat.contact_email || '');
  };

  const submitSeat = async () => {
    if (!seatTarget || !seatPhone.trim()) return;
    try {
      if (seatTarget.isEdit) {
        await api.patch(`/orgs/${grantorsOrg.id}/grantors/${seatTarget.seat.id}`, {
          phone: seatPhone.trim(),
          email: seatEmail.trim() || null,
        });
        toast.success('Grantor contact updated');
      } else {
        await api.post(`/orgs/${membersOrg.id}/grantors`, {
          userId: seatTarget.member.id,
          phone: seatPhone.trim(),
          email: seatEmail.trim() || undefined,
        });
        toast.success(`${seatTarget.member.first_name} ${seatTarget.member.last_name} seated as union grantor`);
        viewMembers(membersOrg);
      }
      setSeatTarget(null);
      if (membersOrg) viewMembers(membersOrg);
      if (grantorsOrg) viewGrantors(grantorsOrg);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const deleteOrg = async (o) => {
    if (!window.confirm(`Delete ${o.name} (${o.code}) permanently? Only empty, never-used organisations can be deleted.`)) return;
    try {
      await api.del(`/orgs/${o.id}`);
      toast.success(`${o.name} deleted`);
      load();
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

  const submitMove = async () => {
    if (!moveTarget || !moveOrgId) return;
    try {
      const r = await api.patch(`/orgs/members/${moveTarget.id}/move`, { orgId: Number(moveOrgId) });
      toast.success(`${moveTarget.first_name} moved to ${r.to} — new ID ${r.newMemberNo}${r.grantorSeatReleased ? ' (grantor seat released)' : ''}`);
      setMoveTarget(null);
      setMoveOrgId('');
      viewMembers(membersOrg);
      load();
    } catch (e) { toast.error(e.message); }
  };

  const totals = (members || []).reduce(
    (s, m) => ({ balance: s.balance + Number(m.balance), savings: s.savings + Number(m.total_savings) }),
    { balance: 0, savings: 0 }
  );

  // Hierarchy: markets on top, unions nested underneath. Member counts
  // roll up so a market shows its whole trading community. Orphans (a
  // parent_id with no matching row) pin to the top level so no union can
  // ever vanish from the table.
  const childrenOf = {};
  const byId = {};
  (orgs || []).forEach((o) => {
    byId[o.id] = o;
    const k = o.parent_id || 0;
    (childrenOf[k] = childrenOf[k] || []).push(o);
  });
  const roots = (childrenOf[0] || []).slice();
  (orgs || []).forEach((o) => {
    if (o.parent_id && !byId[o.parent_id] && !roots.includes(o)) roots.push(o);
  });
  const rolled = {};
  const rollup = (o) => {
    if (rolled[o.id] !== undefined) return rolled[o.id];
    let s = Number(o.members) || 0;
    for (const c of childrenOf[o.id] || []) s += rollup(c);
    rolled[o.id] = s;
    return s;
  };
  (childrenOf[0] || []).forEach(rollup);
  roots.forEach((o) => { if (rolled[o.id] === undefined) rollup(o); });

  const matchQ = (o) =>
    !q.trim() || `${o.name} ${o.code} ${o.type} ${o.parent_name || ''}`.toLowerCase().includes(q.toLowerCase());

  const coverage = (o) => {
    const n = Number(o.grantors || 0);
    if (n >= 3) return <Badge variant="success">3/3 ready</Badge>;
    if (n === 2) return <Badge variant="warning" title="Quorum possible but fragile — any rejection stalls loans">2/3 fragile</Badge>;
    return <Badge variant="destructive" title="Quorum impossible — loans from here stall at the grantor stage">{n}/3 blocked</Badge>;
  };

  const orgRow = (o, depth) => {
    const kids = childrenOf[o.id] || [];
    const open = expanded[o.id] ?? true;
    return (
      <TableRow key={o.id}>
        <TableCell>
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 22 }}>
            {kids.length > 0 && !q.trim() ? (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggle(o.id)} title={open ? 'Collapse' : 'Expand'}>
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            ) : (
              <span className="w-6" />
            )}
            <div>
              <p className="font-medium text-sm">{o.name}</p>
              {o.contact_phone && <p className="text-xs text-muted-foreground">{o.contact_phone}</p>}
            </div>
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs">{o.code}</TableCell>
        <TableCell className="text-sm capitalize">{o.type.replaceAll('_', ' ')}</TableCell>
        <TableCell className="text-right font-medium" title={kids.length ? `Own: ${o.members} · with unions: ${rolled[o.id]}` : undefined}>
          {kids.length ? rolled[o.id] : o.members}
        </TableCell>
        <TableCell>{coverage(o)}</TableCell>
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
            {canSeat && (
              <Button variant="ghost" size="sm" className="text-destructive" title="Delete (only empty, never-used)" onClick={() => deleteOrg(o)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const renderOrgRows = (list, depth) => list.filter(matchQ).flatMap((o) => {
    const open = expanded[o.id] ?? true;
    const kids = childrenOf[o.id] || [];
    return open ? [orgRow(o, depth), ...renderOrgRows(kids, depth + 1)] : [orgRow(o, depth)];
  });

  return (
    <div className="w-full space-y-6">
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4 border-b">
            <span className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Organisations
            </span>
            <span className="text-sm text-muted-foreground">{(orgs || []).length} total</span>
            <div className="relative w-full max-w-xs ml-auto">
              <Input placeholder="Search markets, unions, codes…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
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
                    {!editing && (
                      <div className="col-span-2 rounded-md border p-3 space-y-2">
                        <Label>Union grantors ({gPicks.length}/3) — leaders with union phone (required) + email (optional)</Label>
                        <p className="text-xs text-muted-foreground">
                          Pick the 3 leaders now (any active, fully-registered member — they&rsquo;re affiliated automatically)
                          or seat them later from the union&rsquo;s members.
                        </p>
                        {gPicks.map((p) => (
                          <div key={p.id} className="rounded-md border px-3 py-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">{p.name} <span className="text-xs font-normal text-muted-foreground">{p.email}</span></p>
                              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setGPicks(gPicks.filter((x) => x.id !== p.id))}>Remove</Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div><Label>Union phone *</Label><Input required value={p.seatPhone} onChange={(e) => setGPicks(gPicks.map((x) => x.id === p.id ? { ...x, seatPhone: e.target.value } : x))} placeholder="0803…" /></div>
                              <div><Label>Union email (optional)</Label><Input type="email" value={p.seatEmail} onChange={(e) => setGPicks(gPicks.map((x) => x.id === p.id ? { ...x, seatEmail: e.target.value } : x))} placeholder="union@example.com" /></div>
                            </div>
                          </div>
                        ))}
                        {gPicks.length < 3 && (
                          <div>
                            <Input placeholder="Search members by name, email or ID…" value={gSearch} onChange={(e) => setGSearch(e.target.value)} />
                            {gMatches.map((u) => (
                              <div key={u.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-1.5 mt-1.5">
                                <span>{u.first_name} {u.last_name} <span className="text-xs text-muted-foreground">{u.email}</span></span>
                                <Button type="button" variant="ghost" size="sm" onClick={() => {
                                  setGPicks([...gPicks, {
                                    id: u.id, name: `${u.first_name} ${u.last_name}`, email: u.email,
                                    seatPhone: u.phone || '', seatEmail: '',
                                  }]);
                                  setGSearch('');
                                }}>Add</Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
                <TableHead>Organisation (market → unions)</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>Grantors</TableHead>
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
              ) : q.trim() ? (
                (orgs || []).filter(matchQ).map((o) => orgRow(o, 0))
              ) : (
                renderOrgRows(roots, 0)
              )}
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
                    {canSeat && <TableHead className="w-24" title="Seat as grantor / move union"></TableHead>}
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
                          <div className="flex gap-1 items-center">
                            {m.role && m.role !== 'member' && (
                              <Badge variant="outline" className="capitalize text-[10px]">{m.role.replace('_', ' ')}</Badge>
                            )}
                            <Button variant="ghost" size="sm" title="Seat as union grantor (must be fully registered)" onClick={() => openSeat(m)}>
                              <UserPlus className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" title="Move to another union" onClick={() => { setMoveTarget(m); setMoveOrgId(''); }}>
                              <ArrowRightLeft className="h-4 w-4" />
                            </Button>
                          </div>
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
                    <TableHead className="hidden md:table-cell">Union contact</TableHead>
                    <TableHead className="hidden md:table-cell">Seated</TableHead>
                    {canSeat && <TableHead className="w-20"></TableHead>}
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
                      <TableCell className="hidden md:table-cell text-xs">
                        <p className="font-medium">{g.contact_phone || g.phone || '—'}</p>
                        <p className="text-muted-foreground">{g.contact_email || 'no union email'}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                        {g.assigned_at?.slice(0, 10)}{g.assigned_by_first ? ` by ${g.assigned_by_first} ${g.assigned_by_last || ''}` : ''}
                      </TableCell>
                      {canSeat && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" title="Edit union contact" onClick={() => openSeatEdit(g)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" title="Remove seat" onClick={() => unseatGrantor(g)}>
                              <UserMinus className="h-4 w-4" />
                            </Button>
                          </div>
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

      <Dialog open={!!moveTarget} onOpenChange={(v) => { if (!v) setMoveTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move {moveTarget?.first_name} {moveTarget?.last_name} to another union</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Currently in <span className="font-semibold text-foreground">{membersOrg?.name}</span> ({moveTarget?.member_no}).
            The new union issues a fresh member ID; wallet, savings, loans and KYC travel untouched.
            Any grantor seat held here is released automatically.
          </p>
          <div>
            <Label>Destination union</Label>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={moveOrgId} onChange={(e) => setMoveOrgId(e.target.value)}
            >
              <option value="">Choose…</option>
              {(orgs || []).filter((o) => o.id !== membersOrg?.id && o.status === 'active').map((o) => (
                <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)}>Cancel</Button>
            <Button disabled={!moveOrgId} onClick={submitMove}>Move member</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!seatTarget} onOpenChange={(v) => { if (!v) setSeatTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {seatTarget?.isEdit
                ? `Union contact — ${seatTarget.seat.first_name} ${seatTarget.seat.last_name}`
                : `Seat grantor — ${seatTarget?.member.first_name} ${seatTarget?.member.last_name}`}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Official union contact for this leader. Phone is required; email is optional
            {!seatTarget?.isEdit && seatTarget?.member.phone && (
              <> (member phone <span className="font-mono">{seatTarget.member.phone}</span> pre-filled)</>
            )}.
          </p>
          <div><Label>Contact phone *</Label><Input required value={seatPhone} onChange={(e) => setSeatPhone(e.target.value)} placeholder="0803…" /></div>
          <div><Label>Contact email (optional)</Label><Input type="email" value={seatEmail} onChange={(e) => setSeatEmail(e.target.value)} placeholder="union@example.com" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeatTarget(null)}>Cancel</Button>
            <Button disabled={!seatPhone.trim()} onClick={submitSeat}>
              {seatTarget?.isEdit ? 'Save contact' : 'Seat grantor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
