import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/format';
import StatCard from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wallet, PiggyBank, HandCoins, TrendingUp, Megaphone, FileText, ShieldCheck, CheckCircle2, Upload, ReceiptText } from 'lucide-react';
import { useBalanceHidden, masked, BalanceEye } from '@/components/balance';

function AdditionalVerification() {
  const navigate = useNavigate();
  const [kyc, setKyc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    api.get('/kyc/me').then(setKyc).catch(() => setKyc(null));
  };
  useEffect(() => { load(); }, []);

  const profile = kyc?.profile || null;
  const documents = kyc?.documents || [];
  let vr = profile?.verification_result || null;
  if (typeof vr === 'string') {
    try { vr = JSON.parse(vr); } catch { vr = null; }
  }
  const ninPassed = Boolean(
    vr?.nin?.verified || (vr?.checks || []).some((c) => ['nin', 'reg_nin'].includes(c.key) && c.passed) || profile?.id_number
  );
  const bvnPassed = Boolean(
    vr?.bvn?.verified || (vr?.checks || []).some((c) => ['bvn_match', 'reg_bvn_match'].includes(c.key) && c.passed) || profile?.bvn_verified
  );
  const ninHolder = vr?.nin?.holder || vr?.identity?.nin?.holder || null;
  const bvnHolder = vr?.bvn?.holder || vr?.identity?.bvn?.holder || null;
  const hasUtility = documents.some((d) => ['utility_bill', 'proof_of_address'].includes(d.doc_type));
  const kycStatus = profile?.status || 'missing';

  // Fully done: identity passed + utility bill uploaded + KYC approved.
  if (ninPassed && bvnPassed && hasUtility && kycStatus === 'approved') return null;

  const uploadUtility = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setMsg('');
    setUploading(true);
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
      await api.post('/kyc/documents', { docType: 'utility_bill', filename: f.name, mime: f.type, data: base64 });
      e.target.value = '';
      setMsg('Utility bill uploaded — an admin will verify it shortly.');
      load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" /> Additional verification
            </CardTitle>
            <CardDescription>Your NIN + BVN passed at signup — finish proof of address to complete KYC</CardDescription>
          </div>
          {kycStatus !== 'missing' && (
            <Badge variant={kycStatus === 'approved' ? 'success' : kycStatus === 'pending' ? 'warning' : 'destructive'} className="capitalize">
              KYC: {kycStatus}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ninPassed ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> NIN {ninPassed ? 'PASSED' : '—'}{ninHolder ? ` — ${ninHolder}` : ''}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${bvnPassed ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> BVN {bvnPassed ? 'PASSED' : '—'}{bvnHolder ? ` — ${bvnHolder}` : ''}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${hasUtility ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}`}>
            <ReceiptText className="h-3.5 w-3.5" /> Utility bill {hasUtility ? 'uploaded' : 'needed'}
          </span>
        </div>
        {msg && <p className="text-xs rounded-md bg-muted p-2">{msg}</p>}
        {!hasUtility ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="flex flex-1 items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:border-primary">
              <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload utility bill (jpg/png/pdf)…'}
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={uploadUtility} disabled={uploading} />
            </label>
            <Button variant="outline" onClick={() => navigate('/profile')}>
              Open full KYC
            </Button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1">
              {kycStatus === 'approved'
                ? 'Address document received.'
                : 'Utility bill received — an admin will verify it. You can add more documents from full KYC.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate('/profile')}>
              Open full KYC
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState({ wallet: null, savings: null, loans: [], transactions: [], dividends: null });
  const [vaccount, setVaccount] = useState(null);
  const [notices, setNotices] = useState([]);
  const [hidden, toggleHidden] = useBalanceHidden();
  const justRegistered = location.state?.justRegistered;
  const regIdentity = location.state?.identity || null;

  useEffect(() => {
    (async () => {
      const [wallet, savings, loans, transactions, dividends] = await Promise.all([
        api.get('/wallet'),
        api.get('/savings/summary'),
        api.get('/loans'),
        api.get('/wallet/transactions?limit=6'),
        api.get('/dividends/summary'),
      ]);
      setData({ wallet, savings, loans, transactions, dividends });
      api.get('/virtual-accounts/me').then(setVaccount).catch(() => setVaccount(null));
      api.get('/announcements').then((n) => setNotices(n.slice(0, 3))).catch(() => setNotices([]));
    })().catch(console.error);
  }, []);

  const activeLoans = data.loans.filter((l) => ['disbursed', 'approved'].includes(l.status));

  const holderSuffix = (name) => (name ? ` (${name})` : '');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-sm text-muted-foreground">Your cooperative account at a glance</p>
        </div>
        <Button onClick={() => navigate('/statement')}>
          <FileText className="h-4 w-4" /> Report
        </Button>
        <Button variant="outline" onClick={() => navigate('/wallet')}>
          <Wallet className="h-4 w-4" /> Wallet
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5 flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                Wallet Balance
                <BalanceEye hidden={hidden} onToggle={toggleHidden} />
              </p>
              <p className="mt-1 text-2xl font-bold">
                {hidden ? masked() : formatCurrency(data.wallet?.balance)}
              </p>
              {vaccount && (
                <p className="mt-1 text-xs text-muted-foreground font-mono tracking-wider flex items-center gap-1.5">
                  {vaccount.account_number} · {vaccount.bank_name}
                  {vaccount.is_mock && (
                    <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-px text-[10px] font-sans font-semibold">Test</span>
                  )}
                </p>
              )}
            </div>
            <div className="p-2 rounded-lg bg-muted text-primary shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <StatCard title="Total Savings" value={formatCurrency(data.savings?.total)} icon={PiggyBank}
          hint={`Today: ${formatCurrency(data.savings?.today)}`} />
        <StatCard title="Active Loans" value={activeLoans.length} icon={HandCoins}
          hint={formatCurrency(activeLoans.reduce((s, l) => s + Number(l.total_repayable) - Number(l.amount_paid), 0)) + ' outstanding'} />
        <StatCard title="Dividends Earned" value={formatCurrency(data.dividends?.total_paid)} icon={TrendingUp} />
      </div>

      {justRegistered && (
        <Card className="border-green-500/40 bg-green-50 dark:bg-green-950">
          <CardContent className="p-4 text-sm text-green-800 dark:text-green-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Welcome — your account is active, no approval needed.
            </p>
            <p>
              NIN PASSED{holderSuffix(regIdentity?.nin?.holder)} · BVN PASSED{holderSuffix(regIdentity?.bvn?.holder)}.
              One last step below: upload a utility bill to finish verification.
            </p>
          </CardContent>
        </Card>
      )}

      <AdditionalVerification />

      {notices.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" /> Notices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {notices.map((n) => (
              <div key={n.id} className="border-l-2 border-primary pl-3">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-sm text-muted-foreground line-clamp-2">{n.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Recent Transactions</CardTitle>
          <Button variant="outline" size="sm" onClick={() => navigate('/statement')}>
            <FileText className="h-4 w-4" /> Full report
          </Button>
        </CardHeader>        <CardContent className="p-0">
          {data.transactions.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <ul className="divide-y">
              {data.transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{t.description || t.type}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(t.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className={['withdrawal', 'loan_repayment', 'transfer_out', 'collection_repayment'].includes(t.type) ? 'text-destructive font-semibold' : 'text-green-600 dark:text-green-400 font-semibold'}>
                      {['withdrawal', 'loan_repayment', 'transfer_out', 'collection_repayment'].includes(t.type) ? '-' : '+'}{formatCurrency(t.amount)}
                    </p>
                    <Badge variant="outline" className="mt-1 text-xs capitalize">{t.type.replace('_', ' ')}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}