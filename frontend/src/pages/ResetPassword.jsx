import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [form, setForm] = useState({ newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setError(''); setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: form.newPassword });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-primary text-primary-foreground">
        <h1 className="text-4xl font-bold mb-3">Choose a new password</h1>
        <p className="text-lg opacity-90">Make it at least 6 characters.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
            <CardDescription>Set a new password for your account</CardDescription>
          </CardHeader>
          <CardContent>
            {!token ? (
              <div className="text-sm text-destructive bg-destructive/10 p-4 rounded-md text-center">
                Missing reset token. Use the link from your email.
              </div>
            ) : done ? (
              <div className="space-y-4 text-center py-2">
                <div className="text-sm bg-green-50 text-green-700 p-4 rounded-md">
                  Password has been reset. You can now sign in.
                </div>
                <Button asChild className="w-full">
                  <Link to="/login">Sign in</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                {error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}
                <div>
                  <Label htmlFor="np">New password</Label>
                  <Input id="np" type="password" required value={form.newPassword}
                    onChange={(e) => setForm({ ...form, newPassword: e.target.value })} placeholder="Min 6 characters" />
                </div>
                <div>
                  <Label htmlFor="cf">Confirm password</Label>
                  <Input id="cf" type="password" required value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Saving…' : 'Reset password'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
