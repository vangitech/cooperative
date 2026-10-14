import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { api, setToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Store, Landmark, CheckCircle2 } from 'lucide-react';
import coopTeam from '@/assets/Coop.jpg';

const STEPS = ['Work', 'ID', 'BVN', 'Email', 'Details'];

export default function Register() {
  const { setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [session, setSession] = useState(null);
  const [employmentType, setEmploymentType] = useState('private');
  const [orgs, setOrgs] = useState([]);
  const [orgId, setOrgId] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [bvn, setBvn] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', phone: '', address: '' });
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/orgs').then(setOrgs).catch(() => setOrgs([]));
  }, []);

  const run = async (fn) => {
    setError(''); setInfo(''); setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const start = () => run(async () => {
    const r = await api.post('/auth/register/start', {
      employmentType, orgId: orgId ? Number(orgId) : undefined,
    });
    setSession(r.sessionToken);
    setStep(1);
  });

  const verifyId = () => run(async () => {
    await api.post('/auth/register/verify-identity', { sessionToken: session, idNumber });
    setInfo(employmentType === 'private' ? 'NIN verified against the registry.' : 'IPPIS number accepted.');
    setStep(2);
  });

  const verifyBvn = () => run(async () => {
    await api.post('/auth/register/verify-bvn', { sessionToken: session, bvn });
    setInfo('BVN verified and matched.');
    setStep(3);
  });

  const sendCode = () => run(async () => {
    const r = await api.post('/auth/register/send-code', { sessionToken: session, email });
    setSentTo(r.to);
    setInfo(`Code sent to ${r.to} — check your inbox (10 min expiry).`);
  });

  const verifyCode = () => run(async () => {
    await api.post('/auth/register/verify-code', { sessionToken: session, email, code });
    setInfo('Email verified.');
    setStep(4);
  });

  const complete = () => run(async () => {
    const data = await api.post('/auth/register/complete', { sessionToken: session, ...form });
    if (data.user.status !== 'active') {
      logout();
      setPending({ virtualAccount: data.virtualAccount || null, memberNo: data.user.member_no });
    } else {
      setToken(data.token);
      setUser(data.user);
      navigate('/dashboard');
    }
  });

  const isPrivate = employmentType === 'private';

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-primary text-primary-foreground">
        <img
          src={coopTeam}
          alt="Cooperative team stacking hands together in unity"
          className="w-full max-w-md mx-auto mb-6 h-auto rounded-2xl shadow-lg object-cover"
          loading="eager"
        />
        <h1 className="text-4xl font-bold mb-3 text-center">Join the Cooperative</h1>
        <p className="text-lg opacity-90 text-center">
          Verified identity, verified email, member ID in minutes.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Create an account</CardTitle>
            <CardDescription>Step {Math.min(step + 1, 5)} of 5 — {STEPS[Math.min(step, 4)]}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* progress */}
            <div className="flex gap-1.5 mb-6">
              {STEPS.map((s, i) => (
                <div key={s} title={s} className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
              ))}
            </div>

            {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md mb-4">{error}</div>}
            {info && <div className="text-sm bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 p-3 rounded-md mb-4">{info}</div>}

            {pending ? (
              <div className="space-y-4 text-center py-4">
                <div className="text-sm bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 p-4 rounded-md">
                  Application received. An admin will review it shortly —
                  you'll be able to sign in once approved.
                  {pending.memberNo && (
                    <p className="mt-2 font-semibold">Your member ID: <span className="font-mono">{pending.memberNo}</span></p>
                  )}
                </div>
                {pending.virtualAccount ? (
                  <div className="text-sm border rounded-md p-4 space-y-1">
                    <p className="text-muted-foreground">Your funding account (bank transfer from any app):</p>
                    <p className="text-2xl font-mono font-bold tracking-wider">{pending.virtualAccount.account_number}</p>
                    <p className="text-muted-foreground">{pending.virtualAccount.bank_name}</p>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground border rounded-md p-4">
                    Your personal funding account is being set up — it will appear in your wallet after approval.
                  </div>
                )}
                <Button asChild variant="outline" className="w-full">
                  <Link to="/login">Back to Sign in</Link>
                </Button>
              </div>
            ) : step === 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEmploymentType('private')}
                    className={cn('rounded-lg border p-4 text-left transition-colors',
                      isPrivate ? 'border-primary bg-primary/5 shadow-sm' : 'hover:border-primary/50')}
                  >
                    <Store className={cn('h-5 w-5 mb-2', isPrivate ? 'text-primary' : 'text-muted-foreground')} />
                    <p className="font-semibold text-sm">Private worker</p>
                    <p className="text-xs text-muted-foreground mt-1">Market, church, mosque, private hospital & school staff</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmploymentType('civil_servant')}
                    className={cn('rounded-lg border p-4 text-left transition-colors',
                      !isPrivate ? 'border-primary bg-primary/5 shadow-sm' : 'hover:border-primary/50')}
                  >
                    <Landmark className={cn('h-5 w-5 mb-2', !isPrivate ? 'text-primary' : 'text-muted-foreground')} />
                    <p className="font-semibold text-sm">Civil servant</p>
                    <p className="text-xs text-muted-foreground mt-1">Government payroll (IPPIS) staff</p>
                  </button>
                </div>
                <div>
                  <Label>Unit / Branch / Department</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={orgId} onChange={(e) => setOrgId(e.target.value)}
                  >
                    <option value="">General Members</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                    ))}
                  </select>
                </div>
                <Button className="w-full" disabled={loading} onClick={start}>
                  {loading ? 'Starting…' : 'Continue'}
                </Button>
                <p className="text-sm text-center text-muted-foreground">
                  Already a member? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
                </p>
              </div>
            ) : step === 1 ? (
              <div className="space-y-4">
                <div>
                  <Label>{isPrivate ? 'NIN (11 digits)' : 'IPPIS number'}</Label>
                  <Input
                    value={idNumber}
                    onChange={(e) => setIdNumber(isPrivate ? e.target.value.replace(/\D/g, '') : e.target.value)}
                    inputMode="numeric" maxLength={isPrivate ? 11 : 12}
                    placeholder={isPrivate ? 'Your 11-digit NIN' : 'Your IPPIS number'}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {isPrivate
                      ? 'Checked live against the national registry.'
                      : 'Format + duplicate checked; payroll cross-check follows.'}
                  </p>
                </div>
                <Button className="w-full" disabled={loading || !idNumber} onClick={verifyId}>
                  {loading ? 'Verifying…' : `Verify ${isPrivate ? 'NIN' : 'IPPIS'}`}
                </Button>
              </div>
            ) : step === 2 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-4 w-4" /> ID verified — now your BVN
                </div>
                <div>
                  <Label>BVN (11 digits)</Label>
                  <Input value={bvn} onChange={(e) => setBvn(e.target.value.replace(/\D/g, ''))}
                         inputMode="numeric" maxLength={11} placeholder="Your 11-digit BVN" />
                  <p className="text-xs text-muted-foreground mt-1">Matched against the registry and your {isPrivate ? 'NIN' : 'identity'}.</p>
                </div>
                <Button className="w-full" disabled={loading || bvn.length !== 11} onClick={verifyBvn}>
                  {loading ? 'Verifying…' : 'Verify BVN'}
                </Button>
              </div>
            ) : step === 3 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-4 w-4" /> BVN verified — confirm your email
                </div>
                <div>
                  <Label>Email</Label>
                  <div className="flex gap-2">
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                    <Button variant="outline" disabled={loading || !email} onClick={sendCode}>Send code</Button>
                  </div>
                </div>
                {sentTo && (
                  <div>
                    <Label>6-digit code sent to {sentTo}</Label>
                    <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                           inputMode="numeric" maxLength={6} placeholder="••••••" />
                  </div>
                )}
                <Button className="w-full" disabled={loading || code.length !== 6} onClick={verifyCode}>
                  {loading ? 'Checking…' : 'Verify code'}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                  <CheckCircle2 className="h-4 w-4" /> Email verified — your details
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>First name</Label><Input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
                  <div><Label>Last name</Label><Input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
                </div>
                <div><Label>Password</Label><Input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" /></div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Address</Label><Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <Button className="w-full" disabled={loading || !form.firstName || !form.lastName || !form.password} onClick={complete}>
                  {loading ? 'Creating account…' : 'Create account'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
