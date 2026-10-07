import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', phone: '', address: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await register(form);
      navigate('/dashboard');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-primary text-primary-foreground">
        <h1 className="text-4xl font-bold mb-3">Join the Cooperative</h1>
        <p className="text-lg opacity-90">
          Create your account, get a wallet, start saving and unlock loans & dividends.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Create an account</CardTitle>
            <CardDescription>Register to become a member</CardDescription>
          </CardHeader>
          <CardContent>
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                Already a member? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}