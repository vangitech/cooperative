import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, Upload, Download, RefreshCw, Trash2, BellRing, FileCheck } from 'lucide-react';

const TYPES = [
  { value: 'pcidss', label: 'PCI-DSS' },
  { value: 'iso', label: 'ISO' },
  { value: 'financial_audit', label: 'Financial Audit' },
  { value: 'license', label: 'Licence' },
  { value: 'tax', label: 'Tax' },
  { value: 'other', label: 'Other' },
];

const statusVariant = { valid: 'success', expiring: 'warning', expired: 'destructive' };

function fileToBase64(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(f);
  });
}

export default function AdminCompliance() {
  const [data, setData] = useState({ items: [], summary: { total: 0, expired: 0, expiring: 0, valid: 0 } });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '', docType: 'pcidss', issuer: '', licenseNo: '',
    issueDate: '', renewedDate: '', expiryDate: '', notes: '',
  });
  const [file, setFile] = useState(null);
  const [renewId, setRenewId] = useState(null);
  const [renewDate, setRenewDate] = useState('');
  const [renewExpiry, setRenewExpiry] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.get('/admin/compliance'));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const set = (k) => (eOrV) => {
    const v = eOrV?.target ? eOrV.target.value : eOrV;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      let payloadFile = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds 5MB`);
        if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
          throw new Error(`${file.name}: jpg, png or pdf only`);
        }
        payloadFile = { filename: file.name, mime: file.type, data: await fileToBase64(file) };
      }
      await api.post('/admin/compliance', {
        title: form.title,
        docType: form.docType,
        issuer: form.issuer || undefined,
        licenseNo: form.licenseNo || undefined,
        issueDate: form.issueDate || undefined,
        renewedDate: form.renewedDate || undefined,
        expiryDate: form.expiryDate,
        notes: form.notes || undefined,
        file: payloadFile || undefined,
      });
      toast.success('Compliance document logged — expiry countdown started');
      setOpen(false);
      setForm({ title: '', docType: 'pcidss', issuer: '', licenseNo: '', issueDate: '', renewedDate: '', expiryDate: '', notes: '' });
      setFile(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const downloadDoc = async (id, filename) => {
    try {
      const token = localStorage.getItem('mpcs_token');
      const base = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${base}/admin/compliance/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `compliance-${id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const renew = async () => {
    if (!renewId || !renewExpiry) return toast.error('Pick the new expiry date');
    try {
      await api.patch(`/admin/compliance/${renewId}`, { renewedDate: renewDate || undefined, expiryDate: renewExpiry });
      toast.success('Document renewed — countdown reset');
      setRenewId(null);
      setRenewDate('');
      setRenewExpiry('');
      await load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this compliance record?')) return;
    try {
      await api.del(`/admin/compliance/${id}`);
      toast.success('Deleted');
      await load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const checkNow = async () => {
    try {
      const r = await api.post('/admin/compliance/check');
      toast.success(`Checked ${r.checked} docs — ${r.notified} reminder(s) sent`);
      await load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const { items, summary } = data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Total documents', value: summary.total },
          { label: 'Valid', value: summary.valid },
          { label: 'Expiring ≤ 60 days', value: summary.expiring },
          { label: 'Expired', value: summary.expired },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold">{s.value ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className={summary.expiring + summary.expired > 0 ? 'border-amber-500/40' : ''}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Compliance & Regulations
            </CardTitle>
            <CardDescription>
              Upload a licence/certificate — the system logs the renewed date + expiry date and notifies admins from 2 months out with a daily countdown.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={checkNow}>
              <BellRing className="h-4 w-4" /> Run expiry check
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Upload className="h-4 w-4" /> Log document</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Log compliance document</DialogTitle></DialogHeader>
                <form onSubmit={submit} className="space-y-3">
                  <div><Label>Title *</Label><Input required value={form.title} onChange={set('title')} placeholder="e.g. PCI-DSS Certificate 2026" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Type *</Label>
                      <Select value={form.docType} onValueChange={set('docType')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Issuer</Label><Input value={form.issuer} onChange={set('issuer')} placeholder="e.g. ISO body" /></div>
                  </div>
                  <div><Label>Licence / certificate no.</Label><Input value={form.licenseNo} onChange={set('licenseNo')} /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Issued</Label><Input type="date" value={form.issueDate} onChange={set('issueDate')} /></div>
                    <div><Label>Renewed</Label><Input type="date" value={form.renewedDate} onChange={set('renewedDate')} /></div>
                    <div><Label>Expires *</Label><Input type="date" required value={form.expiryDate} onChange={set('expiryDate')} /></div>
                  </div>
                  <div>
                    <Label>Licence file (jpg/png/pdf ≤ 5MB)</Label>
                    <Input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </div>
                  <div><Label>Notes</Label><Input value={form.notes} onChange={set('notes')} placeholder="Optional note" /></div>
                  <DialogFooter><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save document'}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No compliance documents yet — log PCI-DSS, ISO or your financial audit certificate above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Renewed</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Countdown</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <p className="font-medium text-sm flex items-center gap-1.5">
                          <FileCheck className="h-4 w-4 text-muted-foreground" /> {d.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[d.issuer, d.license_no, d.filename].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="uppercase text-[11px]">{String(d.doc_type).replace('_', ' ')}</Badge></TableCell>
                      <TableCell className="text-xs">{d.renewed_date ? String(d.renewed_date).slice(0, 10) : d.issue_date ? String(d.issue_date).slice(0, 10) : '—'}</TableCell>
                      <TableCell className="text-xs font-medium">{String(d.expiry_date).slice(0, 10)}</TableCell>
                      <TableCell className="text-xs font-semibold">
                        {d.days_left < 0 ? `Expired ${Math.abs(d.days_left)}d ago` : d.days_left === 0 ? 'Expires today' : `${d.days_left}d left`}
                      </TableCell>
                      <TableCell><Badge variant={statusVariant[d.status] || 'outline'} className="capitalize">{d.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {d.filename && (
                            <Button variant="ghost" size="icon" title="Download licence" onClick={() => downloadDoc(d.id, d.filename)}>
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          <Dialog open={renewId === d.id} onOpenChange={(v) => { if (!v) { setRenewId(null); } }}>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon" title="Renew" onClick={() => setRenewId(d.id)}>
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader><DialogTitle>Renew — {d.title}</DialogTitle></DialogHeader>
                              <div className="space-y-3">
                                <div><Label>Renewed date</Label><Input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} /></div>
                                <div><Label>New expiry date *</Label><Input type="date" value={renewExpiry} onChange={(e) => setRenewExpiry(e.target.value)} /></div>
                              </div>
                              <DialogFooter><Button onClick={renew}>Save renewal</Button></DialogFooter>
                            </DialogContent>
                          </Dialog>
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => remove(d.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
