import { useEffect, useState } from 'react';
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

function KycTab() {
  const [data, setData] = useState(null);
  const [vaccount, setVaccount] = useState(null);
  const [form, setForm] = useState({
    dob: '', gender: '', occupation: '', employer: '', idType: 'nin', idNumber: '',
    residentialAddress: '', nextOfKinName: '', nextOfKinPhone: '', nextOfKinRelationship: '',
  });
  const [g, setG] = useState({ fullName: '', phone: '', email: '', relationship: '' });
  const [msg, setMsg] = useState(null);

  const load = () => {
    api.get('/kyc/me').then(setData).catch((e) => setMsg({ type: 'err', text: e.message }));
    api.get('/virtual-accounts/me').then(setVaccount).catch(() => setVaccount(null));
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

  const profile = data?.profile;
  const guarantors = data?.guarantors || [];

  return (
    <div className="space-y-6 max-w-2xl">
      {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}

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
    <Tabs defaultValue="profile" className="max-w-2xl">
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
              {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>First name</Label><Input value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} /></div>
                <div><Label>Last name</Label><Input value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} /></div>
              </div>
              <div><Label>Email</Label><Input value={user?.email || ''} disabled /></div>
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
              {msg && <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
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