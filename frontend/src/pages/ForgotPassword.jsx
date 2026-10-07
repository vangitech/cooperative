import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-center p-12 bg-primary text-primary-foreground">
        <h1 className="text-4xl font-bold mb-3">Locked out?</h1>
        <p className="text-lg opacity-90">We'll email you a link to reset your password.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Forgot password</CardTitle>
            <CardDescription>Enter your account email</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-4 text-center py-2">
                <div className="text-sm bg-green-50 text-green-700 p-4 rounded-md">
                  If an account exists for that email, a reset link has been sent. It expires in 60 minutes.
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/login">Back to Sign in</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </Button>
                <p className="text-sm text-center text-muted-foreground">
                  Remembered it? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
