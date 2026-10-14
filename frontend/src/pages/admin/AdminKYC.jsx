import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatDate, initials } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Search, Check, X, FileCheck, Download, ShieldCheck, Users } from 'lucide-react';

const kycVariant = { pending: 'warning', approved: 'success', rejected: 'destructive' };

async function downloadDoc(id, filename) {
  try {
    const token = localStorage.getItem('mpcs_token');
    const base = import.meta.env.VITE_API_URL || '/api';
    const res = await fetch(`${base}/kyc/documents/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `kyc-${id}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(e.message);
  }
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || '—'}</p>
    </div>
  );
}

export default function AdminKYC() {
  const [queue, setQueue] = useState(null);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [q, setQ] = useState('');
  const [file, setFile] = useState(null); // full member file
  const [loadingFile, setLoadingFile] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/kyc/queue').then(setQueue).catch((e) => toast.error(e.message));
    api.get('/admin/users').then((u) => setPendingUsers(u.filter((x) => x.status === 'pending'))).catch(() => setPendingUsers([]));
  };
  useEffect(() => { load(); }, []);

  const openFile = async (userId) => {
    setLoadingFile(true);
    setFile(null);
    setNote('');
    try {
      setFile(await api.get(`/kyc/user/${userId}`));
    } catch (e) { toast.error(e.message); }
    finally { setLoadingFile(false); }
  };

  const review = async (status) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.patch(`/kyc/${file.user.id}`, { status, note: note || undefined });
      if (status === 'approved') {
        if (r.virtualAccount) toast.success(`KYC approved — funding account ${r.virtualAccount.account_number} assigned`);
        else if (r.accountError) toast.warning(`KYC approved, account setup deferred: ${r.accountError}`);
        else toast.success('KYC approved');
      } else {
        toast.success('KYC rejected — member notified');
      }
      setFile(null);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  const match = (u) =>
    `${u.first_name} ${u.last_name} ${u.email} ${u.member_no || ''} ${u.org_name || ''}`
      .toLowerCase().includes(q.toLowerCase());

  const rows = (status) => (queue || []).filter((r) => (!status || r.status === status) && match(r));
  const pending = rows('pending');
  const approved = rows('approved');
  const rejected = rows('rejected');

  const QueueTable = ({ list }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead className="hidden md:table-cell">Group</TableHead>
          <TableHead className="hidden lg:table-cell">System score</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((r) => (
          <TableRow key={r.user_id} className="cursor-pointer" onClick={() => openFile(r.user_id)}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(r.first_name, r.last_name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">{r.first_name} {r.last_name}</p>
                  <p className="text-xs text-muted-foreground">{r.email} · {r.id_type} {r.id_number}</p>
                </div>
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell text-sm">
              {r.org_name ? `${r.org_name} (${r.org_code})` : 'General Members'}
            </TableCell>
            <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
              {r.verification_result ? `${r.verification_result.passed ? 'passed' : 'needs attention'} · ${r.verification_result.score}%` : '—'}
              <span className="block">{r.doc_count} doc(s) · {r.guarantor_count} guarantor(s)</span>
            </TableCell>
            <TableCell><Badge variant={kycVariant[r.status]} className="capitalize">{r.status}</Badge></TableCell>
          </TableRow>
        ))}
        {queue && list.length === 0 && (
          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nobody here</TableCell></TableRow>
        )}
      </TableBody>
    </Table>
  );

  const vr = file?.profile?.verification_result;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Awaiting review', value: pending.length },
          { label: 'Verified', value: approved.length },
          { label: 'Rejected', value: rejected.length },
          { label: 'New registrations waiting', value: pendingUsers.length },
        ].map((s) => (
          <Card key={s.label}><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-bold">{queue ? s.value : '…'}</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search name, email, member ID, group…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Tabs defaultValue="pending">
        <TabsList className="flex-wrap">
          <TabsTrigger value="pending">Pending {pending.length > 0 && <Badge variant="warning" className="ml-2">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="approved">Passed KYC</TabsTrigger>
          <TabsTrigger value="registrations">New registrations {pendingUsers.length > 0 && <Badge variant="warning" className="ml-2">{pendingUsers.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value="pending"><Card><CardContent className="p-0"><QueueTable list={pending} /></CardContent></Card></TabsContent>
        <TabsContent value="approved"><Card><CardContent className="p-0"><QueueTable list={approved} /></CardContent></Card></TabsContent>
        <TabsContent value="rejected"><Card><CardContent className="p-0"><QueueTable list={rejected} /></CardContent></Card></TabsContent>
        <TabsContent value="registrations">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Waiting for approval</CardTitle>
              <CardDescription>Every new registration lands here as pending — activate them from Members, review KYC here</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="hidden md:table-cell">Group</TableHead>
                  <TableHead className="hidden lg:table-cell">Registered</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pendingUsers.filter(match).map((u) => (
                    <TableRow key={u.id} className="cursor-pointer" onClick={() => openFile(u.id)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(u.first_name, u.last_name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{u.first_name} {u.last_name}</p>
                            <p className="text-xs text-muted-foreground">{u.email} · {u.member_no}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm">{u.org_name ? `${u.org_name} (${u.org_code})` : 'General Members'}</TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                      <TableCell><Badge variant="warning">waiting approval</Badge></TableCell>
                    </TableRow>
                  ))}
                  {pendingUsers.filter(match).length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No pending registrations</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Full member file */}
      <Dialog open={loadingFile || !!file} onOpenChange={(v) => { if (!v) setFile(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          {loadingFile || !file ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading member file…</p>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  {file.user.first_name} {file.user.last_name}
                </DialogTitle>
                <CardDescription>
                  {file.user.email} · {file.user.member_no} · {file.user.org_name ? `${file.user.org_name} (${file.user.org_code})` : 'General Members'}
                </CardDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={file.user.status === 'active' ? 'success' : 'warning'} className="capitalize">member: {file.user.status}</Badge>
                  {file.profile && <Badge variant={kycVariant[file.profile.status]} className="capitalize">kyc: {file.profile.status}</Badge>}
                  <Badge variant={file.user.email_verified ? 'success' : 'warning'}>{file.user.email_verified ? 'Email ✓' : 'Email?'}</Badge>
                </div>

                {file.profile ? (
                  <>
                    <div className="rounded-lg border p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <Field label="ID type" value={file.profile.id_type} />
                      <Field label="ID number" value={file.profile.id_number} />
                      <Field label="Date of birth" value={file.profile.dob?.slice(0, 10)} />
                      <Field label="Gender" value={file.profile.gender} />
                      <Field label="Occupation" value={file.profile.occupation} />
                      <Field label="Employer" value={file.profile.employer} />
                      <Field label="Next of kin" value={file.profile.next_of_kin_name} />
                      <Field label="Kin phone" value={file.profile.next_of_kin_phone} />
                      <Field label="Kin relationship" value={file.profile.next_of_kin_relationship} />
                    </div>
                    {file.profile.residential_address && (
                      <p className="text-sm"><span className="text-muted-foreground text-xs block uppercase tracking-wider">Address</span>{file.profile.residential_address}</p>
                    )}
                    {vr && (
                      <div className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">System checks: {vr.passed ? 'passed' : 'needs attention'} <span className="text-muted-foreground">({vr.score}%)</span></p>
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {(vr.checks || []).map((c) => (
                            <li key={c.key} className={c.passed ? 'text-muted-foreground' : 'text-destructive'}>
                              {c.passed ? '✓' : '✗'} {c.label}{c.detail ? ` — ${c.detail}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {file.profile.review_note && (
                      <p className="text-sm"><span className="text-muted-foreground text-xs block uppercase tracking-wider">Review note</span>{file.profile.review_note}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground rounded-lg border p-3">No KYC profile submitted yet.</p>
                )}

                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium flex items-center gap-1.5 mb-2"><FileCheck className="h-4 w-4 text-primary" /> Documents ({file.documents.length})</p>
                  {file.documents.length === 0 && <p className="text-xs text-muted-foreground">None uploaded.</p>}
                  {file.documents.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2 mb-1.5">
                      <div>
                        <p className="font-medium font-mono text-xs">{d.filename}</p>
                        <p className="text-muted-foreground text-xs">{d.doc_type} · {(d.size_bytes / 1024).toFixed(0)} KB</p>
                      </div>
                      <Button variant="ghost" size="icon" title="Download" onClick={() => downloadDoc(d.id, d.filename)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-2">Guarantors ({file.guarantors.length})</p>
                  {file.guarantors.length === 0 && <p className="text-xs text-muted-foreground">None added.</p>}
                  {file.guarantors.map((g) => (
                    <p key={g.id} className="text-sm">{g.full_name} <span className="text-muted-foreground">· {g.phone}{g.relationship ? ` · ${g.relationship}` : ''} · ${g.status}</span></p>
                  ))}
                </div>

                {file.profile && file.profile.status === 'pending' && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <Label>Review note (sent to the member on reject)</Label>
                    <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…" />
                    <DialogFooter className="gap-2">
                      <Button disabled={busy} onClick={() => review('approved')}><Check className="h-4 w-4" /> Approve KYC</Button>
                      <Button variant="destructive" disabled={busy} onClick={() => review('rejected')}><X className="h-4 w-4" /> Reject</Button>
                    </DialogFooter>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
