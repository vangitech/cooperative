import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '@/lib/api';
import KycRequiredModal from '@/components/KycRequiredModal';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useBalanceHidden, masked, BalanceEye } from '@/components/balance';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid, Legend,
} from 'recharts';

const OUT_TYPES = ['withdrawal', 'loan_repayment', 'transfer_out', 'collection_repayment', 'collection_down', 'fixed_deposit', 'savings_plan'];

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
  const [analytics, setAnalytics] = useState(null);
  const [months, setMonths] = useState(6);
  const [vaccount, setVaccount] = useState(null);
  const [kycStatus, setKycStatus] = useState(null);
  // Money-out gate (same rule as loans): withdrawals, transfers and bank
  // payouts need a recent utility bill + government ID. Attempting any of
  // them without documents pops the styled KYC modal; the server enforces.
  const [docGate, setDocGate] = useState(null);
  const [gateOpen, setGateOpen] = useState(false);

  const gateBlocked = Boolean(docGate && (!docGate.hasGovId || !docGate.utilityRecent));
  const missingDocs = () => {
    if (!docGate) return [];
    return [
      !docGate.utilityRecent && 'A recent utility bill (electricity, water or waste — within 3 months)',
      !docGate.hasGovId && 'A valid government ID (passport, driver’s license or voter’s card)',
    ].filter(Boolean);
  };
  const blockedByGate = () => {
    if (gateBlocked) { setGateOpen(true); return true; }
    return false;
  };
  const [sendOpen, setSendOpen] = useState(false);
  const [sendId, setSendId] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [recipient, setRecipient] = useState(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [hidden, toggleHidden] = useBalanceHidden();

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
    api.get('/virtual-accounts/me').then(setVaccount).catch(() => setVaccount(null));
    api.get('/kyc/me').then((d) => {
      setKycStatus(d.profile?.status || null);
      const docs = d?.documents || [];
      const gov = docs.find((x) => ['passport', 'drivers_license', 'voters_card', 'id_card'].includes(x.doc_type));
      const util = docs
        .filter((x) => ['utility_bill', 'proof_of_address'].includes(x.doc_type))
        .sort((a, b) => new Date(b.doc_date || b.created_at) - new Date(a.doc_date || a.created_at))[0] || null;
      const recent = util ? (Date.now() - new Date(util.doc_date || util.created_at).getTime()) / 86400000 <= 93 : false;
      setDocGate({ hasGovId: Boolean(gov), hasUtility: Boolean(util), utilityRecent: recent });
    }).catch(() => { setKycStatus(null); setDocGate(null); });
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    api.get(`/wallet/analytics?months=${months}`).then(setAnalytics).catch(() => setAnalytics(null));
  }, [months, wallet?.updated_at]);

  const submit = async () => {
    setMsg(null);
    if (blockedByGate()) return;
    try {
      await api.post(`/wallet/${open}`, { amount: Number(amount) });
      setAmount(''); setOpen(null); await load(); await refresh();
      setMsg({ type: 'ok', text: 'Transaction successful' });
    } catch (e) {
      if (open === 'withdraw' && /KYC|verification|Upload/i.test(e.message)) setGateOpen(true);
      else setMsg({ type: 'err', text: e.message });
    }
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
    if (blockedByGate()) return;
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
    if (blockedByGate()) { setWdLoading(false); setWdOpen(false); return; }
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
    } catch (e) {
      if (/KYC|verification|Upload/i.test(e.message)) { setGateOpen(true); setWdOpen(false); }
      else setMsg({ type: 'err', text: e.message });
    }
    finally { setWdLoading(false); }
  };

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(vaccount.account_number);
      setMsg({ type: 'ok', text: 'Account number copied' });
    } catch { setMsg({ type: 'err', text: 'Could not copy' }); }
  };

  const resolveRecipient = async () => {
    setMsg(null); setRecipient(null);
    try {
      const r = await api.get(`/wallet/resolve-recipient?q=${encodeURIComponent(sendId.trim())}`);
      setRecipient(r);
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  const submitSend = async () => {
    setMsg(null); setSendLoading(true);
    if (blockedByGate()) { setSendLoading(false); setSendOpen(false); return; }
    try {
      const r = await api.post('/wallet/transfer', {
        recipient: sendId.trim(),
        amount: Number(sendAmount),
      });
      setSendId(''); setSendAmount(''); setRecipient(null); setSendOpen(false);
      await load(); await refresh();
      setMsg({ type: 'ok', text: `Sent ${r.amount} to ${r.recipient} (${r.reference})` });
    } catch (e) {
      if (/KYC|verification|Upload/i.test(e.message)) { setGateOpen(true); setSendOpen(false); }
      else setMsg({ type: 'err', text: e.message });
    }
    finally { setSendLoading(false); }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground border-0">
        <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm opacity-80 flex items-center gap-1.5">
              Available Balance
              <BalanceEye hidden={hidden} onToggle={toggleHidden} className="text-primary-foreground hover:bg-white/10" />
            </p>
            <p className="text-4xl font-bold mt-1">{hidden ? masked() : formatCurrency(wallet?.balance)}</p>
            {vaccount && (
              <p className="text-sm opacity-80 mt-1 font-mono tracking-wider">
                {vaccount.account_number} · {vaccount.bank_name}
              </p>
            )}
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
                  <div className="text-sm p-3 rounded-md bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                    Account Name: <span className="font-semibold">{acctName}</span>
                  </div>
                )}
                {!acctLoading && acctError && (
                  <div className="text-sm p-3 rounded-md bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">{acctError}</div>
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
        <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
          {msg.text}
        </div>
      )}


      <Card>
        <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">My Funding Account — bank transfer from any app</p>
            {vaccount ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                <span className="text-2xl font-mono font-bold tracking-wider">{vaccount.account_number}</span>
                <span className="text-sm text-muted-foreground">{vaccount.bank_name}</span>
                <Button variant="outline" size="sm" onClick={copyAccount}>Copy</Button>
              </div>
            ) : kycStatus === 'approved' ? (
              <p className="text-sm text-muted-foreground mt-1">
                ID verified — your funding account is being issued. If it doesn't appear soon, contact support.
              </p>
            ) : kycStatus === 'pending' ? (
              <p className="text-sm text-muted-foreground mt-1">
                Your ID is under review — the funding account arrives right after approval.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                No funding account yet —{' '}
                <Link to="/profile" className="text-primary font-medium hover:underline">
                  verify your ID (NIN) in Profile → KYC
                </Link>{' '}
                to activate it.
              </p>
            )}
          </div>
          <Dialog open={sendOpen} onOpenChange={(v) => {
            if (v && blockedByGate()) return;
            setSendOpen(v);
            if (!v) { setSendId(''); setSendAmount(''); setRecipient(null); }
          }}>
            <DialogTrigger asChild>
              <Button>Send Money</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Send to a Member</DialogTitle></DialogHeader>
              <div><Label>Email or account number</Label><Input value={sendId} onChange={(e) => { setSendId(e.target.value); setRecipient(null); }} placeholder="member@example.com or 10-digit account" /></div>
              <Button variant="outline" onClick={resolveRecipient}>Verify Recipient</Button>
              {recipient && (
                <div className="text-sm p-3 rounded-md bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">
                  To: <span className="font-semibold">{recipient.name}</span> ({recipient.email})
                </div>
              )}
              <div><Label>Amount (₦)</Label><Input type="number" min="1" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="0.00" /></div>
              <DialogFooter>
                <Button onClick={submitSend} disabled={sendLoading || !recipient}>
                  {sendLoading ? 'Sending…' : 'Confirm Send'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Cash Flow</CardTitle>
            <CardDescription>Inflow vs outflow per month</CardDescription>
          </div>
          <div className="flex gap-1">
            {[3, 6, 12].map((m) => (
              <Button key={m} variant={months === m ? 'default' : 'outline'} size="sm" onClick={() => setMonths(m)}>
                {m}M
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Total In</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400">{formatCurrency(analytics?.summary.inflow)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Out</p>
              <p className="text-xl font-bold text-destructive">{formatCurrency(analytics?.summary.outflow)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net</p>
              <p className="text-xl font-bold">{formatCurrency(analytics?.summary.net)}</p>
            </div>
          </div>
          <div className="h-56">
            {(analytics?.monthly?.length || 0) > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.monthly}>
                  <defs>
                    <linearGradient id="inGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--destructive)" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="var(--destructive)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} width={70}
                         tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} />
                  <RTooltip formatter={(v) => formatCurrency(v)} />
                  <Legend />
                  <Area type="monotone" dataKey="inflow" name="In" stroke="var(--primary)" strokeWidth={2} fill="url(#inGrad)" />
                  <Area type="monotone" dataKey="outflow" name="Out" stroke="var(--destructive)" strokeWidth={2} fill="url(#outGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                Not enough activity yet
              </div>
            )}
          </div>
          {(analytics?.byType?.length || 0) > 0 && (
            <div className="mt-4 space-y-2">
              {analytics.byType.map((t) => {
                const max = Math.max(...analytics.byType.map((x) => Number(x.total)), 1);
                return (
                  <div key={t.type} className="flex items-center gap-3 text-sm">
                    <span className="w-32 truncate capitalize text-muted-foreground">{t.type.replace(/_/g, ' ')}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(Number(t.total) / max) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right font-medium">{formatCurrency(t.total)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
                  <TableCell className={`text-right font-medium ${OUT_TYPES.includes(t.type) ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
                    {OUT_TYPES.includes(t.type) ? '-' : '+'}{formatCurrency(t.amount)}
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

      <KycRequiredModal
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        missing={missingDocs()}
        title="Complete verification to move money"
      />
    </div>
  );
}