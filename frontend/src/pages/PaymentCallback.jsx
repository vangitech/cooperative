import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

// Flutterwave redirects here after payment with
// ?status=successful&tx_ref=...&transaction_id=...
// We re-verify server-side before showing success.
export default function PaymentCallback() {
  const [params] = useSearchParams();
  const txRef = params.get('tx_ref');
  const [state, setState] = useState({ status: 'verifying', message: 'Confirming your payment…' });

  useEffect(() => {
    if (!txRef) {
      setState({ status: 'error', message: 'Missing payment reference.' });
      return;
    }
    api
      .get(`/payments/fund/verify?txRef=${encodeURIComponent(txRef)}`)
      .then((r) => {
        if (r.verified) {
          setState({
            status: 'success',
            message: r.already
              ? 'Payment already confirmed. Your wallet is up to date.'
              : 'Payment confirmed. Your wallet has been credited.',
          });
        } else {
          setState({
            status: 'error',
            message: 'Payment was not successful. No money was added. Contact support if you were debited.',
          });
        }
      })
      .catch((e) => setState({ status: 'error', message: e.message }));
  }, [txRef]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Wallet Funding</CardTitle>
          <CardDescription>Reference: {txRef || '—'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.status === 'verifying' && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{state.message}</p>
            </div>
          )}
          {state.status === 'success' && (
            <div className="flex flex-col items-center gap-2 py-4">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <p className="text-sm">{state.message}</p>
            </div>
          )}
          {state.status === 'error' && (
            <div className="flex flex-col items-center gap-2 py-4">
              <XCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm">{state.message}</p>
            </div>
          )}
          <Button asChild className="w-full">
            <Link to="/wallet">Back to Wallet</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
