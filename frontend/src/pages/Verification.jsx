import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, CircleDashed, Upload, ReceiptText, IdCard, PartyPopper } from 'lucide-react';

const UTILITY_MAX_AGE_DAYS = 93;
const GOV_ID_TYPES = ['passport', 'drivers_license', 'voters_card', 'id_card'];
const UTILITY_TYPES = ['utility_bill', 'proof_of_address'];

const GOV_LABELS = {
  passport: 'International Passport',
  drivers_license: 'Driver’s License',
  voters_card: 'Voter’s Card (PVC)',
};

function docIsRecent(d) {
  const ref = new Date(d.doc_date || d.created_at);
  if (Number.isNaN(ref.getTime())) return false;
  return (Date.now() - ref.getTime()) / 86400000 <= UTILITY_MAX_AGE_DAYS;
}

function StepShell({ n, title, desc, state, children }) {
  return (
    <Card className={state === 'done' ? 'border-green-500/40' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className={`h-8 w-8 shrink-0 rounded-full grid place-items-center text-sm font-bold ${state === 'done' ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
            {state === 'done' ? <CheckCircle2 className="h-4 w-4" /> : n}
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </div>
          <Badge variant={state === 'done' ? 'success' : 'warning'}>{state === 'done' ? 'Done' : 'Todo'}</Badge>
        </div>
      </CardHeader>
      {children && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export default function Verification() {
  const navigate = useNavigate();
  const [kyc, setKyc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [billDate, setBillDate] = useState('');
  const [govType, setGovType] = useState('passport');
  const [msg, setMsg] = useState(null);

  const load = () => api.get('/kyc/me').then(setKyc).catch(() => setKyc(null));
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
  const ninDob = vr?.nin?.dob || vr?.identity?.nin?.dob || null;
  const bvnDob = vr?.bvn?.dob || vr?.identity?.bvn?.dob || null;

  const govDoc = documents.find((d) => GOV_ID_TYPES.includes(d.doc_type)) || null;
  const utilityDoc = documents
    .filter((d) => UTILITY_TYPES.includes(d.doc_type))
    .sort((a, b) => new Date(b.doc_date || b.created_at) - new Date(a.doc_date || a.created_at))[0] || null;
  const utilityRecent = utilityDoc ? docIsRecent(utilityDoc) : false;
  const ready = ninPassed && bvnPassed && utilityRecent && Boolean(govDoc);

  const uploadFile = async (e, { docType, docDate }) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setMsg(null);
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
      await api.post('/kyc/documents', { docType, filename: f.name, mime: f.type, data: base64, docDate: docDate || undefined });
      e.target.value = '';
      if (docType === 'utility_bill') setBillDate('');
      setMsg({ type: 'ok', text: 'Document uploaded — an admin will verify it shortly.' });
      load();
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Verification</h2>
        <p className="text-sm text-muted-foreground">
          Complete these steps to unlock loans, withdrawals, transfers and bank payouts.
        </p>
      </div>

      {msg && (
        <div className={`text-sm p-3 rounded-md ${msg.type === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
          {msg.text}
        </div>
      )}

      {ready && (
        <Card className="border-green-500/40 bg-green-50 dark:bg-green-950">
          <CardContent className="p-4 flex items-start gap-3">
            <PartyPopper className="h-5 w-5 text-green-700 dark:text-green-300 shrink-0 mt-0.5" />
            <div className="text-sm text-green-800 dark:text-green-200">
              <p className="font-semibold">You&rsquo;re fully verified.</p>
              <p>Loans, withdrawals, transfers and bank payouts are unlocked.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <StepShell n={1} title="Identity — NIN + BVN" desc="Verified automatically at signup" state={ninPassed && bvnPassed ? 'done' : 'todo'}>
        <div className="flex flex-wrap gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${ninPassed ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> NIN {ninPassed ? 'PASSED' : '—'}{ninHolder ? ` — ${ninHolder}` : ''}{ninDob ? ` · DOB ${ninDob}` : ''}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${bvnPassed ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> BVN {bvnPassed ? 'PASSED' : '—'}{bvnHolder ? ` — ${bvnHolder}` : ''}{bvnDob ? ` · DOB ${bvnDob}` : ''}
          </span>
        </div>
      </StepShell>

      <StepShell n={2} title="Recent utility bill" desc="Electricity, water or waste bill — dated within the last 3 months" state={utilityRecent ? 'done' : 'todo'}>
        <div className="space-y-2.5">
          {utilityDoc ? (
            <p className={`text-xs flex items-center gap-1.5 ${utilityRecent ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
              {utilityRecent ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
              {utilityDoc.filename} · dated {String(utilityDoc.doc_date || utilityDoc.created_at).slice(0, 10)}
              {!utilityRecent && ' — too old, upload a newer one below'}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ReceiptText className="h-3.5 w-3.5" /> No utility bill on file yet.
            </p>
          )}
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="verify-bill-date">Bill date (printed on the bill)</label>
            <input
              id="verify-bill-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <label className="flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:border-primary">
            <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload bill (jpg / png / pdf)…'}
            <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" disabled={uploading || !billDate} onChange={(e) => uploadFile(e, { docType: 'utility_bill', docDate: billDate })} />
          </label>
          {!billDate && <p className="text-[11px] text-muted-foreground">Pick the bill date first — it must be within 3 months.</p>}
        </div>
      </StepShell>

      <StepShell n={3} title="Government ID" desc="International passport, driver’s license or voter’s card (PVC)" state={govDoc ? 'done' : 'todo'}>
        <div className="space-y-2.5">
          {govDoc ? (
            <p className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {govDoc.filename} · {govDoc.doc_type.replaceAll('_', ' ')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <IdCard className="h-3.5 w-3.5" /> No government ID on file yet.
            </p>
          )}
          <select
            value={govType} onChange={(e) => setGovType(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Government ID type"
          >
            {Object.entries(GOV_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground cursor-pointer hover:border-primary">
            <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : `Upload ${GOV_LABELS[govType].toLowerCase()}…`}
            <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" disabled={uploading} onChange={(e) => uploadFile(e, { docType: govType })} />
          </label>
        </div>
      </StepShell>

      <StepShell n={4} title="Unlocked" desc="What completes when all steps are done" state={ready ? 'done' : 'todo'}>
        <ul className="text-sm space-y-1">
          {['Loan applications', 'Wallet withdrawals', 'Member transfers', 'Bank payouts'].map((x) => (
            <li key={x} className={`flex items-center gap-2 ${ready ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground'}`}>
              {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />} {x}
            </li>
          ))}
        </ul>
        {!ready && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/profile?tab=kyc')}>
            Open full KYC (guarantors, address)
          </Button>
        )}
      </StepShell>
    </div>
  );
}
