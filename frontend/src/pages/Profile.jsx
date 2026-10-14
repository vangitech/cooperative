import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const ID_TYPES = [
  { value: 'nin', label: 'NIN' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'voters_card', label: "Voter's Card" },
  { value: 'passport', label: 'International Passport' },
];

const kycVariant = { pending: 'warning', approved: 'success', rejected: 'destructive' };

const DOC_OPTIONS = [
  { value: 'utility_bill', label: 'Utility bill — electricity / water / waste (within 3 months)' },
  { value: 'passport', label: 'International Passport' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'voters_card', label: "Voter's Card (PVC)" },
  { value: 'id_card', label: 'ID card / scan' },
  { value: 'proof_of_address', label: 'Proof of address (other)' },
  { value: 'passport_photo', label: 'Passport photo' },
  { value: 'other', label: 'Other document' },
];

const GOV_ID_TYPES = ['passport', 'drivers_license', 'voters_card', 'id_card'];
const UTILITY_TYPES = ['utility_bill', 'proof_of_address'];
const UTILITY_MAX_AGE_DAYS = 93;

function docIsRecent(d) {
  const ref = new Date(d.doc_date || d.created_at);
  if (Number.isNaN(ref.getTime())) return false;
  return (Date.now() - ref.getTime()) / 86400000 <= UTILITY_MAX_AGE_DAYS;
}

function KycTab() {
  const [data, setData] = useState(null);
  const [vaccount, setVaccount] = useState(null);
  const [docs, setDocs] = useState([]);
  const [form, setForm] = useState({
    dob: '', gender: '', occupation: '', employer: '', idType: 'nin', idNumber: '',
    residentialAddress: '', nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelationship: '',
  });
  const [g, setG] = useState({ fullName: '', phone: '', email: '', relationship: '' });
  const [docType, setDocType] = useState('utility_bill');
  const [docDate, setDocDate] = useState('');
  const [msg, setMsg] = useState(null);

  const load = () => {
    api.get('/kyc/me').then((d) => {
      setData(d);
      // /kyc/me now also embeds documents; keep the standalone list in sync.
      if (d?.documents) setDocs(d.documents);
      // Pre-fill the NIN verified at signup so the member sees it as PASSED.
      setForm((f) => ({
        ...f,
        idType: f.idType !== 'nin' || !d?.profile?.id_number ? f.idType : f.idType,
        idNumber: f.idNumber || d?.profile?.id_number || '',
      }));
    }).catch((e) => setMsg({ type: 'err', text: e.message }));
    api.get('/virtual-accounts/me').then(setVaccount).catch(() => setVaccount(null));
    api.get('/kyc/documents').then(setDocs).catch(() => setDocs([]));
  };
  useEffect(() => { load(); }, []);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submitProfile = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.post('/kyc', form);
      await load();
      setMsg({ type: 'ok', text: 'KYC submitted for review' });
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  };

  const addGuarantor = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.post('/kyc/guarantors', g);
      setG({ fullName: '', phone: '', email: '', relationship: '' });
      await load();
      setMsg({ type: 'ok', text: 'Guarantor added' });
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  };

  const uploadDoc = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setMsg(null);
    try {
      if (f.size > 5 * 1024 * 1024) throw new Error(`${f.name} exceeds 5MB`);
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(f.type)) {
        throw new Error(`${f.name}: jpg, png or pdf only`);
      }
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error('Could not read file'));
        r.readAsDataURL(f);
      });
      await api.post('/kyc/documents', {
        docType, filename: f.name, mime: f.type, data: base64,
        docDate: UTILITY_TYPES.includes(docType) ? docDate || undefined : undefined,
      });
      e.target.value = '';
      setDocDate('');
      await load();
      setMsg({ type: 'ok', text: 'Document uploaded' });
    } catch (err) { setMsg({ type: 'err', text: err.message }); }
  };

  const profile = data?.profile;
  const guarantors = data?.guarantors || [];
  let vr = profile?.verification_result || null;
  if (typeof vr === 'string') {
    try { vr = JSON.parse(vr); } catch { vr = null; }
  }
  // NIN/BVN passed at signup (registration snapshot) — shown as PASSED
  // badges so the member sees signup identity is done; only address docs
  // remain as additional verification.
  const ninPassed = Boolean(
    vr?.nin?.verified || (vr?.checks || []).some((c) => ['nin', 'reg_nin'].includes(c.key) && c.passed) || profile?.id_number
  );
  const bvnPassed = Boolean(
    vr?.bvn?.verified || (vr?.checks || []).some((c) => ['bvn_match', 'reg_bvn_match'].includes(c.key) && c.passed) || profile?.bvn_verified
  );
  const ninHolder = vr?.nin?.holder || vr?.identity?.nin?.holder || null;
  const bvnHolder = vr?.bvn?.holder || vr?.identity?.bvn?.holder || null;
  const ninDob = vr?.nin?.dob || vr?.identity?.nin?.dob || null;
  const bvnDob = vr?.bvn?.dob || vr?.identity?.bvn?.dob || null;
  // Loan pre-conditions (both sectors): recent utility bill + gov ID.
  const govDoc = docs.find((d) => GOV_ID_TYPES.includes(d.doc_type)) || null;
  const utilityDoc = docs
    .filter((d) => UTILITY_TYPES.includes(d.doc_type))
    .sort((a, b) => new Date(b.doc_date || b.created_at) - new Date(a.doc_date || a.created_at))[0] || null;
  const utilityRecent = utilityDoc ? docIsRecent(utilityDoc) : false;
  const loanReady = Boolean(govDoc) && utilityRecent;

  return (
    <div className="space-y-6 max-w-2xl">
      {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>{msg.text}</div>}

      {(ninPassed || bvnPassed) && (
        <div className="flex flex-wrap gap-2">
          {ninPassed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 px-2.5 py-1 text-xs font-semibold">
              ✓ NIN PASSED{ninHolder ? ` — ${ninHolder}` : ''}{ninDob ? ` · DOB ${ninDob}` : ''}
            </span>
          )}
          {bvnPassed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 px-2.5 py-1 text-xs font-semibold">
              ✓ BVN PASSED{bvnHolder ? ` — ${bvnHolder}` : ''}{bvnDob ? ` · DOB ${bvnDob}` : ''}
            </span>
          )}
        </div>
      )}

      <Card className={loanReady ? 'border-green-500/40' : 'border-amber-500/40'}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Loan eligibility — additional documents</CardTitle>
              <CardDescription>Upload both items below before you can apply for a loan (private & public sector)</CardDescription>
            </div>
            <Badge variant={loanReady ? 'success' : 'warning'}>{loanReady ? 'eligible' : 'incomplete'}</Badge>
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <p className={utilityRecent ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground'}>
            {utilityRecent ? '✓' : '○'} Recent utility bill (electricity, water or waste — within 3 months)
            {utilityDoc && <span className="text-muted-foreground"> — {utilityRecent ? `dated ${String(utilityDoc.doc_date || utilityDoc.created_at).slice(0, 10)}` : `dated ${String(utilityDoc.doc_date || utilityDoc.created_at).slice(0, 10)} (too old — upload a newer one)`}</span>}
          </p>
          <p className={govDoc ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground'}>
            {govDoc ? '✓' : '○'} Valid government ID (international passport, driver&rsquo;s license or voter&rsquo;s card)
            {govDoc && <span className="text-muted-foreground"> — {govDoc.doc_type.replaceAll('_', ' ')}</span>}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Identity Verification</CardTitle>
              <CardDescription>Submit a valid ID and next of kin</CardDescription>
            </div>
            {profile && <Badge variant={kycVariant[profile.status]} className="capitalize">{profile.status}</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          {profile?.status === 'approved' ? (
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">ID:</span> {ID_TYPES.find((t) => t.value === profile.id_type)?.label} — {profile.id_number}</p>
              <p><span className="text-muted-foreground">Next of kin:</span> {profile.next_of_kin_name} ({profile.next_of_kin_phone})</p>
              {profile.review_note && <p><span className="text-muted-foreground">Review note:</span> {profile.review_note}</p>}
              {vaccount ? (
                <p><span className="text-muted-foreground">Funding account:</span>{' '}
                  <span className="font-mono font-semibold">{vaccount.account_number}</span> · {vaccount.bank_name}</p>
              ) : (
                <p className="text-muted-foreground">Funding account pending — an admin will assign it shortly.</p>
              )}
            </div>
          ) : (
            <form onSubmit={submitProfile} className="space-y-4">
              {profile?.status === 'rejected' && profile.review_note && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">Rejected: {profile.review_note}. Update and resubmit.</div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Date of birth</Label><Input type="date" value={form.dob} onChange={update('dob')} /></div>
                <div>
                  <Label>Gender</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.gender} onChange={update('gender')}>
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Occupation</Label><Input value={form.occupation} onChange={update('occupation')} /></div>
                <div><Label>Employer</Label><Input value={form.employer} onChange={update('employer')} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>ID type</Label>
                  <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={form.idType} onChange={update('idType')}>
                    {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div><Label>ID number</Label><Input required value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: form.idType === 'nin' ? e.target.value.replace(/\D/g, '') : e.target.value })} inputMode={form.idType === 'nin' ? 'numeric' : undefined} maxLength={form.idType === 'nin' ? 11 : undefined} placeholder={form.idType === 'nin' ? '11-digit NIN' : ''} /></div>
              </div>
              <div><Label>Residential address</Label><Textarea rows={2} value={form.residentialAddress} onChange={update('residentialAddress')} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Next of kin name</Label><Input required value={form.nextOfKinName} onChange={update('nextOfKinName')} /></div>
                <div><Label>Next of kin phone</Label><Input required value={form.nextOfKinPhone} onChange={update('nextOfKinPhone')} /></div>
              </div>
              <div><Label>Relationship</Label><Input value={form.nextOfKinRelationship} onChange={update('nextOfKinRelationship')} placeholder="e.g. Spouse, Brother" /></div>
              <Button type="submit">Submit for verification</Button>
            </form>
          )}
          {vr && (
            <div className="mt-4 rounded-md border p-3 text-sm">
              <p className="font-medium">
                System checks: {vr.passed ? 'passed' : 'needs attention'}{' '}
                <span className="text-muted-foreground">({vr.score}%)</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {vr.checks.map((c) => (
                  <li key={c.key} className={c.passed ? 'text-muted-foreground' : 'text-destructive'}>
                    {c.passed ? '✓' : '✗'} {c.label}{c.detail ? ` — ${c.detail}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identity Documents ({docs.length}/5)</CardTitle>
          <CardDescription>Utility bill (with bill date), government ID — passport / license / PVC (jpg, png, pdf ≤ 5MB)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
              <div>
                <p className="font-medium font-mono text-xs">{d.filename}</p>
                <p className="text-muted-foreground text-xs">
                  {(d.size_bytes / 1024).toFixed(0)} KB
                  {d.doc_date ? ` · dated ${String(d.doc_date).slice(0, 10)}` : ''}
                </p>
              </div>
              <Badge variant="outline">{d.doc_type.replaceAll('_', ' ')}</Badge>
            </div>
          ))}
          {docs.length < 5 && (
            <div className="space-y-2">
              <div>
                <Label>Document type</Label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={docType} onChange={(e) => setDocType(e.target.value)}
                >
                  {DOC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              {UTILITY_TYPES.includes(docType) && (
                <div>
                  <Label>Bill date (printed on the bill — within 3 months)</Label>
                  <Input
                    type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </div>
              )}
              <label className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:border-primary">
                Upload {DOC_OPTIONS.find((o) => o.value === docType)?.label.toLowerCase()}…
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={uploadDoc} />
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Guarantors ({guarantors.length}/2)</CardTitle>
          <CardDescription>Members who vouch for you</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {guarantors.map((x) => (
            <div key={x.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
              <div>
                <p className="font-medium">{x.full_name}</p>
                <p className="text-muted-foreground">{x.phone}{x.relationship ? ` · ${x.relationship}` : ''}</p>
              </div>
              <Badge variant="outline" className="capitalize">{x.status}</Badge>
            </div>
          ))}
          {guarantors.length < 2 && (
            <form onSubmit={addGuarantor} className="grid grid-cols-2 gap-3">
              <div><Label>Name</Label><Input required value={g.fullName} onChange={(e) => setG({ ...g, fullName: e.target.value })} /></div>
              <div><Label>Phone</Label><Input required value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} /></div>
              <div><Label>Email (optional)</Label><Input value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></div>
              <div><Label>Relationship</Label><Input value={g.relationship} onChange={(e) => setG({ ...g, relationship: e.target.value })} /></div>
              <div className="col-span-2"><Button type="submit" variant="outline" className="w-full">Add guarantor</Button></div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const [searchParams] = useSearchParams();
  const initialTab = ['profile', 'kyc', 'security'].includes(searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'profile';
  const [profile, setProfile] = useState({
    firstName: user?.first_name || '',
    lastName: user?.last_name || '',
    phone: user?.phone || '',
    address: user?.address || '',
  });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState(null);

  const saveProfile = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      const updated = await api.patch('/auth/me', profile);
      setUser({ ...user, ...updated });
      setMsg({ type: 'ok', text: 'Profile updated' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const savePassword = async (e) => {
    e.preventDefault(); setMsg(null);
    try {
      await api.patch('/auth/password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      setMsg({ type: 'ok', text: 'Password changed' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  return (
    <Tabs defaultValue={initialTab} key={initialTab} className="max-w-2xl">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="kyc">KYC</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Update your account details</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="space-y-4">
              {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>{msg.text}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>First name</Label><Input value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} /></div>
                <div><Label>Last name</Label><Input value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} /></div>
              </div>
              <div><Label>Email</Label><Input value={user?.email || ''} disabled /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Member ID</Label><Input value={user?.member_no || '—'} disabled className="font-mono" /></div>
                <div><Label>Unit / Branch</Label><Input value={user?.org_name ? `${user.org_name} (${user.org_code})` : 'General Members'} disabled /></div>
              </div>
              <div><Label>Phone</Label><Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></div>
              <div><Label>Address</Label><Textarea value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></div>
              <Button type="submit">Save Changes</Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="kyc">
        <KycTab />
      </TabsContent>

      <TabsContent value="security">
        <Card>
          <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={savePassword} className="space-y-4">
              {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>{msg.text}</div>}
              <div><Label>Current password</Label><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
              <div><Label>New password</Label><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></div>
              <Button type="submit">Update Password</Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}