import { useEffect, useState } from 'react';
import { api, download } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';

export default function Wallet() {
  const { refresh } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [txs, setTxs] = useState([]);
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null); // 'deposit' | 'withdraw' | null
  const [fundOpen, setFundOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState('');
  const [fundLoading, setFundLoading] = useState(false);
  const [wdOpen, setWdOpen] = useState(false);
  const [banks, setBanks] = useState([]);
  const [wd, setWd] = useState({ amount: '', bankCode: '', accountNumber: '' });
  const [wdLoading, setWdLoading] = useState(false);
  const [acctName, setAcctName] = useState('');
  const [acctLoading, setAcctLoading] = useState(false);
  const [acctError, setAcctError] = useState('');

  // Auto-resolve the account holder's name once a full 10-digit
  // account number is entered AND a bank is selected.
  useEffect(() => {
    const num = wd.accountNumber;
    const bank = wd.bankCode;
    setAcctName('');
    setAcctError('');
    if (num.length !== 10 || !bank) {
      setAcctLoading(false);
      return;
    }
    setAcctLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get(
          `/payments/resolve-account?accountNumber=${num}&bankCode=${encodeURIComponent(bank)}`
        );
        if (r.accountName) setAcctName(r.accountName);
        else setAcctError('Could not resolve account name');
      } catch (e) {
        setAcctError(e.message);
      } finally {
        setAcctLoading(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [wd.accountNumber, wd.bankCode]);

  const load = async () => {
    const [w, t] = await Promise.all([api.get('/wallet'), api.get('/wallet/transactions')]);
    setWallet(w); setTxs(t);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    setMsg(null);
    try {
      await api.post(`/wallet/${open}`, { amount: Number(amount) });
      setAmount(''); setOpen(null); await load(); await refresh();
      setMsg({ type: 'ok', text: 'Transaction successful' });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const fundOnline = async () => {
    setMsg(null); setFundLoading(true);
    try {
      const { link } = await api.post('/payments/fund/initiate', { amount: Number(fundAmount) });
      if (!link) throw new Error('No payment link returned');
      window.location.href = link;
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
      setFundLoading(false);
    }
  };

  const openWithdraw = async () => {
    setWdOpen(true);
    if (banks.length === 0) {
      try {
        const list = await api.get('/payments/banks?country=NG');
        setBanks(Array.isArray(list) ? list : []);
      } catch (e) { setMsg({ type: 'err', text: `Could not load banks: ${e.message}` }); }
    }
  };

  const submitWithdraw = async () => {
    setMsg(null); setWdLoading(true);
    try {
      const r = await api.post('/payments/withdraw/initiate', {
        amount: Number(wd.amount),
        bankCode: wd.bankCode,
        accountNumber: wd.accountNumber,
        accountName: acctName,
      });
      setWd({ amount: '', bankCode: '', accountNumber: '' }); setWdOpen(false);
      await load(); await refresh();
      setMsg({ type: 'ok', text: `Withdrawal submitted (${r.reference}). Status: ${r.status}` });
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
    finally { setWdLoading(false); }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground border-0">
        <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm opacity-80">Available Balance</p>
            <p className="text-4xl font-bold mt-1">{formatCurrency(wallet?.balance)}</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={open === 'deposit'} onOpenChange={(v) => setOpen(v ? 'deposit' : null)}>
              <DialogTrigger asChild>
                <Button variant="secondary">Deposit</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Deposit Funds</DialogTitle></DialogHeader>
                <div><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
                <DialogFooter><Button onClick={submit}>Confirm Deposit</Button></DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={open === 'withdraw'} onOpenChange={(v) => setOpen(v ? 'withdraw' : null)}>
              <DialogTrigger asChild>
                <Button variant="outline" className="bg-transparent text-primary-foreground border-white/40 hover:bg-white/10">Withdraw</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Withdraw Funds</DialogTitle></DialogHeader>
                <div><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
                <DialogFooter><Button onClick={submit}>Confirm Withdrawal</Button></DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={fundOpen} onOpenChange={setFundOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary">Fund Online</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Fund via Card / Transfer</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">Pay securely with Flutterwave. Minimum ₦100.</p>
                <div><Label>Amount (₦)</Label><Input type="number" min="100" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} placeholder="0.00" /></div>
                <DialogFooter><Button onClick={fundOnline} disabled={fundLoading}>{fundLoading ? 'Redirecting…' : 'Continue to Payment'}</Button></DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={wdOpen} onOpenChange={(v) => {
              setWdOpen(v);
              if (!v) {
                setWd({ amount: '', bankCode: '', accountNumber: '' });
                setAcctName(''); setAcctError(''); setAcctLoading(false);
              }
            }}>
              <DialogTrigger asChild>
                <Button variant="outline" className="bg-transparent text-primary-foreground border-white/40 hover:bg-white/10" onClick={openWithdraw}>Bank Payout</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Withdraw to Bank</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">Paid out via Flutterwave. Minimum ₦100.</p>
                <div><Label>Amount (₦)</Label><Input type="number" min="100" value={wd.amount} onChange={(e) => setWd({ ...wd, amount: e.target.value })} placeholder="0.00" /></div>
                <div><Label>Account Number</Label><Input inputMode="numeric" maxLength={10} value={wd.accountNumber} onChange={(e) => setWd({ ...wd, accountNumber: e.target.value.replace(/\D/g, '') })} placeholder="10-digit NUBAN" /></div>
                <div>
                  <Label>Bank</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={wd.bankCode}
                    onChange={(e) => setWd({ ...wd, bankCode: e.target.value })}
                  >
                    <option value="">Select bank…</option>
                    {banks.map((b) => (
                      <option key={b.code} value={b.code}>{b.name}</option>
                    ))}
                  </select>
                </div>
                {acctLoading && (
                  <p className="text-sm text-muted-foreground">Resolving account name…</p>
                )}
                {!acctLoading && acctName && (
                  <div className="text-sm p-3 rounded-md bg-green-50 text-green-700">
                    Account Name: <span className="font-semibold">{acctName}</span>
                  </div>
                )}
                {!acctLoading && acctError && (
                  <div className="text-sm p-3 rounded-md bg-red-50 text-red-700">{acctError}</div>
                )}
                <DialogFooter>
                  <Button onClick={submitWithdraw} disabled={wdLoading || !acctName}>
                    {wdLoading ? 'Submitting…' : 'Submit Withdrawal'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {msg && (
        <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>All wallet activity</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => download('/wallet/statement.csv', 'mpcs-statement.csv').catch((e) => setMsg({ type: 'err', text: e.message }))}>
            Statement (CSV)
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txs.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{t.type.replace('_', ' ')}</Badge></TableCell>
                  <TableCell className="text-sm">{t.description}</TableCell>
                  <TableCell className={`text-right font-medium ${['withdrawal','loan_repayment'].includes(t.type) ? 'text-destructive' : 'text-green-600'}`}>
                    {['withdrawal','loan_repayment'].includes(t.type) ? '-' : '+'}{formatCurrency(t.amount)}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(t.balance_after)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(t.created_at)}</TableCell>
                </TableRow>
              ))}
              {txs.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No transactions yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}