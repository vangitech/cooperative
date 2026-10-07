import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Register() {
  const { register, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', phone: '', address: '', nin: '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null); // { virtualAccount } on approval-pending signup
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await register(form);
      if (data.user.status !== 'active') {
        // Membership needs admin approval — don't enter the app yet.
        logout();
        setPending({ virtualAccount: data.virtualAccount || null });
      } else {
        navigate('/dashboard');
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-primary text-primary-foreground">
        <img
          src="/hero-unity.jpg"
          alt="Diverse cooperative members joining hands together in unity"
          className="w-full max-w-md mx-auto mb-6 h-auto rounded-2xl shadow-lg object-cover"
          loading="eager"
        />
        <h1 className="text-4xl font-bold mb-3 text-center">Join the Cooperative</h1>
        <p className="text-lg opacity-90 text-center">
          Create your account, get a wallet, start saving and unlock loans & dividends.
        </p>
        <p className="text-xs opacity-60 text-center mt-4">Photo by Alex Levis on Pexels</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Create an account</CardTitle>
            <CardDescription>Register to become a member</CardDescription>
          </CardHeader>
          <CardContent>
            {pending ? (
              <div className="space-y-4 text-center py-4">
                <div className="text-sm bg-green-50 text-green-700 p-4 rounded-md">
                  Application received. An admin will review it shortly —
                  you'll be able to sign in once approved.
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
            ) : (
            <form onSubmit={submit} className="space-y-4">
              {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>First name</Label><Input required value={form.firstName} onChange={update('firstName')} /></div>
                <div><Label>Last name</Label><Input required value={form.lastName} onChange={update('lastName')} /></div>
              </div>
              <div><Label>Email</Label><Input type="email" required value={form.email} onChange={update('email')} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={update('phone')} /></div>
              <div><Label>Address</Label><Textarea rows={2} value={form.address} onChange={update('address')} /></div>
              <div><Label>Password</Label><Input type="password" required value={form.password} onChange={update('password')} placeholder="Min 6 characters" /></div>
              <div>
                <Label>NIN (optional)</Label>
                <Input inputMode="numeric" maxLength={11} value={form.nin} onChange={(e) => setForm({ ...form, nin: e.target.value.replace(/\D/g, '') })} placeholder="11-digit NIN for instant funding account" />
                <p className="text-xs text-muted-foreground mt-1">Provide your NIN to get your personal funding account number immediately. Otherwise it is set up after ID verification.</p>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                Already a member? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
              </p>
            </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}