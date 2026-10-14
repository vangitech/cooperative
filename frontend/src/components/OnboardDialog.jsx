import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { UserPlus, Upload } from 'lucide-react';

const ID_TYPES = [
  { value: 'nin', label: 'NIN' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'voters_card', label: "Voter's Card" },
  { value: 'passport', label: 'International Passport' },
];

const emptyForm = {
  firstName: '', lastName: '', email: '', phone: '', address: '', password: '',
  orgId: '', status: 'pending', autoApproveKyc: false, employmentType: 'private',
  ippisNumber: '', bvn: '',
  dob: '', gender: '', occupation: '', employer: '', idType: 'nin', idNumber: '',
  residentialAddress: '', nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelationship: '',
};
const emptyKin = { fullName: '', phone: '', email: '', relationship: '' };

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('Could not read file'));
  reader.readAsDataURL(file);
});

export default function OnboardDialog({ onDone }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [kins, setKins] = useState([{ ...emptyKin }]);
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) api.get('/orgs/all').then(setOrgs).catch(() => setOrgs([]));
  }, [open ]);

  const update = (k) => (e) => {
    const v = e?.target !== undefined ? e.target.value : e;
    setForm({ ...form, [k]: v });
  };
  const updateKin = (i, k) => (e) => {
    const next = [...kins];
    next[i] = { ...next[i], [k]: e.target.value };
    setKins(next);
  };

  const pickFiles = async (e) => {
    const chosen = [...e.target.files].slice(0, 5 - files.length);
    const out = [];
    for (const f of chosen) {
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`${f.name} exceeds 5MB`);
        continue;
      }
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)) {
        toast.error(`${f.name}: jpg, png or pdf only`);
        continue;
      }
      out.push({ docType: 'id_card', filename: f.name, mime: f.type, data: await fileToBase64(f) });
    }
    setFiles([...files, ...out].slice(0, 5));
  };

  const reset = () => {
    setForm(emptyForm);
    setKins([{ ...emptyKin }]);
    setFiles([]);
    setResult(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const guarantors = kins.filter((k) => k.fullName.trim() && k.phone.trim());
      const r = await api.post('/admin/users', {
        ...form,
        orgId: form.orgId ? Number(form.orgId) : undefined,
        password: form.password || undefined,
        ippisNumber: form.ippisNumber || undefined,
        bvn: form.bvn || undefined,
        kyc: {
          dob: form.dob || undefined, gender: form.gender || undefined,
          occupation: form.occupation || undefined, employer: form.employer || undefined,
          idType: form.idType, idNumber: form.idNumber || undefined,
          residentialAddress: form.residentialAddress || undefined,
          nextOfKinName: form.nextOfKinName || undefined,
          nextOfKinPhone: form.nextOfKinPhone || undefined,
          nextOfKinRelationship: form.nextOfKinRelationship || undefined,
        },
        guarantors,
        documents: files,
      });
      setResult(r);
      toast.success(`Member ${r.memberNo} onboarded`);
      onDone?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> Onboard member
      </Button>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Onboard member + KYC</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-4 space-y-1">
              <p><span className="text-muted-foreground">Member ID:</span>{' '}
                <span className="font-mono font-bold text-base">{result.memberNo}</span></p>
              <p><span className="text-muted-foreground">Status:</span> <span className="capitalize">{result.user.status}</span></p>
              {result.kyc && (
                <p><span className="text-muted-foreground">KYC:</span> <span className="capitalize">{result.kyc.status}</span>
                  {result.verification && (
                    <span className="text-muted-foreground"> · system checks {result.verification.passed ? 'passed' : 'flagged'} ({result.verification.score}%)</span>
                  )}
                </p>
              )}
              {result.verification && !result.verification.passed && (
                <ul className="text-xs text-muted-foreground list-disc pl-5">
                  {result.verification.checks.filter((c) => !c.passed).map((c) => (
                    <li key={c.key}>{c.label}{c.detail ? ` — ${c.detail}` : ''}</li>
                  ))}
                </ul>
              )}
              <p><span className="text-muted-foreground">Guarantors / documents:</span> {result.guarantors.length} / {result.docCount}</p>
              {result.tempPassword && (
                <p className="pt-2"><span className="text-muted-foreground">One-time temp password (hand to member now):</span>{' '}
                  <span className="font-mono font-bold">{result.tempPassword}</span></p>
              )}
              {result.virtualAccount && (
                <p><span className="text-muted-foreground">Funding account:</span>{' '}
                  <span className="font-mono font-bold">{result.virtualAccount.account_number}</span></p>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Personal</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>First name</Label><Input required value={form.firstName} onChange={update('firstName')} /></div>
                <div><Label>Last name</Label><Input required value={form.lastName} onChange={update('lastName')} /></div>
                <div><Label>Email</Label><Input required type="email" value={form.email} onChange={update('email')} /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={update('phone')} /></div>
                <div className="col-span-2"><Label>Address</Label><Textarea rows={2} value={form.address} onChange={update('address')} /></div>
                <div>
                  <Label>Temp password (blank = auto)</Label>
                  <Input type="text" value={form.password} onChange={update('password')} placeholder="Min 6 chars" />
                </div>
                <div>
                  <Label>Status</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.status} onChange={update('status')}>
                    <option value="pending">Pending approval</option>
                    <option value="active">Active immediately</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <Label>Unit / Branch / Department</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.orgId} onChange={update('orgId')}>
                    <option value="">General Members</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
                  </select>
                </div>
                <div>
                  <Label>Employment</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.employmentType} onChange={update('employmentType')}>
                    <option value="private">Private worker</option>
                    <option value="civil_servant">Civil servant</option>
                  </select>
                </div>
                {form.employmentType === 'civil_servant' ? (
                  <div><Label>IPPIS number *</Label><Input required value={form.ippisNumber} onChange={update('ippisNumber')} inputMode="numeric" placeholder="4–12 digits" /></div>
                ) : (
                  <div><Label>BVN (11 digits) *</Label><Input required value={form.bvn} onChange={(e) => setForm({ ...form, bvn: e.target.value.replace(/\D/g, '') })} inputMode="numeric" maxLength={11} /></div>
                )}
                {form.employmentType === 'civil_servant' && (
                  <div className="col-span-2"><Label>BVN (11 digits) *</Label><Input required value={form.bvn} onChange={(e) => setForm({ ...form, bvn: e.target.value.replace(/\D/g, '') })} inputMode="numeric" maxLength={11} /></div>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">KYC + ID (mandatory)</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date of birth *</Label><Input required type="date" value={form.dob} onChange={update('dob')} /></div>
                <div>
                  <Label>Gender</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.gender} onChange={update('gender')}>
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div><Label>Occupation</Label><Input value={form.occupation} onChange={update('occupation')} /></div>
                <div><Label>Employer</Label><Input value={form.employer} onChange={update('employer')} /></div>
                <div>
                  <Label>ID type</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.idType} onChange={update('idType')}>
                    {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div><Label>ID number *</Label><Input required value={form.idNumber} onChange={update('idNumber')} placeholder="11-digit NIN" /></div>
                <div className="col-span-2"><Label>Residential address</Label><Textarea rows={2} value={form.residentialAddress} onChange={update('residentialAddress')} /></div>
                <div><Label>Next of kin name *</Label><Input required value={form.nextOfKinName} onChange={update('nextOfKinName')} /></div>
                <div><Label>Next of kin phone *</Label><Input required value={form.nextOfKinPhone} onChange={update('nextOfKinPhone')} /></div>
                <div className="col-span-2"><Label>Kin relationship</Label><Input value={form.nextOfKinRelationship} onChange={update('nextOfKinRelationship')} /></div>
                <div className="col-span-2">
                  <Label>ID scans (jpg/png/pdf ≤ 5MB, max 5)</Label>
                  <label className="mt-1 flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:border-primary">
                    <Upload className="h-4 w-4" /> {files.length ? `${files.length} file(s) attached` : 'Choose files…'}
                    <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={pickFiles} />
                  </label>
                  {files.map((f, i) => (
                    <p key={i} className="text-xs text-muted-foreground mt-1 flex justify-between">
                      <span className="font-mono">{f.filename}</span>
                      <button type="button" className="text-destructive" onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button>
                    </p>
                  ))}
                </div>
                {['admin', 'super_admin'].includes(user?.role) && (
                  <label className="col-span-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.autoApproveKyc} onChange={(e) => setForm({ ...form, autoApproveKyc: e.target.checked })} />
                    Auto-approve KYC if system checks pass
                  </label>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Guarantors ({kins.length}/2)</p>
                {kins.length < 2 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setKins([...kins, { ...emptyKin }])}>+ Add</Button>
                )}
              </div>
              {kins.map((k, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 mb-3">
                  <div><Label>Name</Label><Input value={k.fullName} onChange={updateKin(i, 'fullName')} /></div>
                  <div><Label>Phone</Label><Input value={k.phone} onChange={updateKin(i, 'phone')} /></div>
                  <div><Label>Email (optional)</Label><Input value={k.email} onChange={updateKin(i, 'email')} /></div>
                  <div><Label>Relationship</Label><Input value={k.relationship} onChange={updateKin(i, 'relationship')} /></div>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={sending}>{sending ? 'Onboarding…' : 'Onboard member'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
