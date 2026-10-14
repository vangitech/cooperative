import { query } from '../db.js';
import { verifyIdentity, bytidConfigured, bytidMode } from './bytid.js';

export const ORG_TYPES = [
  'general', 'cooperative_branch', 'employer', 'department',
  'unit', 'trade_association', 'market', 'government_mda', 'private_sector',
];

export const ID_TYPES = ['nin', 'drivers_license', 'voters_card', 'passport'];

export const DOC_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

// Post-signup "additional verification" documents. Identity is already
// proven at registration (NIN + BVN registry pass); once logged in the
// member completes proof-of-address / extra ID scans from the dashboard.
export const KYC_DOC_TYPES = ['id_card', 'utility_bill', 'proof_of_address', 'passport_photo', 'other'];

// Validate one base64 identity document. Returns { bytes, size } or throws 400.
export function validateDocument({ docType, filename, mime, data }) {
  const err = (message) => {
    const e = new Error(message);
    e.status = 400;
    throw e;
  };
  if (!filename || !mime || !data) err('Each document needs filename, mime and data');
  if (docType && !KYC_DOC_TYPES.includes(docType)) err(`Unknown document type: ${docType}`);
  if (!DOC_MIMES.includes(mime)) err(`Document type not allowed (jpg, png, pdf only): ${filename}`);
  let bytes;
  try {
    bytes = Buffer.from(String(data), 'base64');
  } catch {
    err(`Document is not valid base64: ${filename}`);
  }
  if (!bytes.length) err(`Document is empty: ${filename}`);
  if (bytes.length > MAX_DOC_BYTES) err(`Document exceeds 5MB: ${filename}`);
  return { bytes, size: bytes.length, docType: docType || 'id_card' };
}

// Race-safe member number: {ORGCODE}-{YY}-{0001}, sequenced per org + year.
// Must be called inside the onboarding transaction (row lock on the counter).
export async function nextMemberNo(client, orgId) {
  const org = await client.query('SELECT code FROM organisations WHERE id = $1 AND status = $2', [
    orgId, 'active',
  ]);
  if (!org.rows[0]) throw new Error('Organisation not found or inactive');
  const year = new Date().getFullYear();
  // Counter row starts at 1, so the first member is 0001 and concurrent
  // first-inserts serialize on the row lock (one gets 1, the other 2…).
  const c = await client.query(
    `INSERT INTO org_counters (org_id, year, last_seq) VALUES ($1,$2,1)
     ON CONFLICT (org_id, year) DO UPDATE SET last_seq = org_counters.last_seq + 1
     RETURNING last_seq`,
    [orgId, year]
  );
  const seq = Number(c.rows[0].last_seq);
  return `${org.rows[0].code}-${String(year).slice(2)}-${String(seq).padStart(4, '0')}`;
}

// System verification pass over submitted KYC + identity fields.
// Deterministic, explainable, no external API needed. Returns
// { passed, score, checks: [{ key, label, passed, detail }] }.
// Human approval (officer/admin) stays the final gate.
export async function verifyKyc(client, { userId, email, phone, firstName, lastName, dob, idType, idNumber, bvn, documents = [] }) {
  const checks = [];
  const push = (key, label, passed, detail = null) => checks.push({ key, label, passed, detail });

  // 1. ID type known.
  push('id_type', 'ID type recognised', ID_TYPES.includes(idType), idType || 'missing');

  // 2. ID number format (NIN strict, others non-empty + sane length).
  if (idType === 'nin') {
    push('id_format', 'NIN is 11 digits', /^\d{11}$/.test(String(idNumber || '').trim()), '11-digit NIN');
  } else {
    const v = String(idNumber || '').trim();
    push('id_format', 'ID number present', v.length >= 4 && v.length <= 40, `${v.length} chars`);
  }

  // 3. ID number not already used by another member.
  if (idNumber) {
    const dup = await client.query(
      'SELECT user_id FROM kyc_profiles WHERE id_number = $1 AND user_id <> $2 LIMIT 1',
      [String(idNumber).trim(), userId || 0]
    );
    push('id_unique', 'ID number not reused', !dup.rows[0],
      dup.rows[0] ? `already on user #${dup.rows[0].user_id}` : 'unique');
  } else {
    push('id_unique', 'ID number not reused', false, 'no ID supplied');
  }

  // 4. Email uniqueness (case-insensitive).
  if (email) {
    const dup = await client.query('SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1', [
      String(email).toLowerCase(), userId || 0,
    ]);
    push('email_unique', 'Email not already registered', !dup.rows[0],
      dup.rows[0] ? 'already registered' : 'unique');
  }

  // 5. Age 18+ when date of birth supplied.
  if (dob) {
    const birth = new Date(dob);
    const age = (Date.now() - birth.getTime()) / 3.15576e10;
    push('age', 'Member is 18+', !Number.isNaN(age) && age >= 18,
      Number.isNaN(age) ? 'invalid date' : `${Math.floor(age)} years`);
  } else {
    push('age', 'Member is 18+', false, 'date of birth missing');
  }

  // 6. At least one identity document attached.
  push('document', 'Identity document attached', documents.length > 0,
    documents.length ? `${documents.length} file(s)` : 'none attached');

  // 7. Phone present and plausible.
  const digits = String(phone || '').replace(/\D/g, '');
  push('phone', 'Phone number plausible', digits.length >= 7 && digits.length <= 15, phone || 'missing');

  // 8. Registry check via Bytid (real NIN/BVN/licence/voter lookup when a key
  // is configured; otherwise skipped and local checks stand alone).
  // A registry REJECT (not found / mismatch) hard-fails; a provider outage
  // only flags for human review so downtime never blocks onboarding.
  let registryHardFail = false;
  let registryName = '';
  if (['nin', 'bvn', 'drivers_license', 'voters_card'].includes(idType) && idNumber && bytidConfigured()) {
    const reg = await verifyIdentity({ type: idType, idNumber, firstName, lastName });
    if (!reg.checked) {
      push('registry', `Registry lookup (${bytidMode()})`, true, reg.detail);
    } else if (reg.status === 'verified') {
      registryName = reg.record?.full_name || '';
      push('registry', `Registry verified (${bytidMode()})`, true,
        [registryName, reg.detail].filter(Boolean).join(' · '));
    } else if (reg.status === 'not_found') {
      registryHardFail = true;
      push('registry', `Registry verified (${bytidMode()})`, false, 'ID not found in registry');
    } else if (reg.status === 'mismatch') {
      registryHardFail = true;
      push('registry', `Registry verified (${bytidMode()})`, false,
        `name/DOB mismatch: ${JSON.stringify(reg.fieldMatches)}`);
    } else {
      push('registry', `Registry verified (${bytidMode()})`, false,
        `${reg.detail || reg.code || 'lookup error'} — needs human review`);
    }
  } else {
    push('registry', 'Registry verified', true, bytidConfigured() ? 'type not covered' : 'provider off — local checks only');
  }

  // 9. BVN cross-check (when a BVN is supplied): it must resolve in the
  // registry AND belong to the same surname as the primary ID record.
  let bvnHardFail = false;
  if (bvn && bytidConfigured()) {
    const bRes = await verifyIdentity({ type: 'bvn', idNumber: bvn, firstName, lastName });
    const surname = (n) => String(n || '').trim().split(/\s+/).pop().toUpperCase();
    if (!bRes.checked || bRes.status === 'error') {
      push('bvn_match', 'BVN belongs to same person', false, `${bRes.detail || 'lookup error'} — needs human review`);
    } else if (bRes.status !== 'verified') {
      bvnHardFail = true;
      push('bvn_match', 'BVN belongs to same person', false, 'BVN not found in registry');
    } else if (registryName && surname(registryName) !== surname(bvnResName(bRes))) {
      bvnHardFail = true;
      push('bvn_match', 'BVN belongs to same person', false,
        `surname mismatch: ID ${surname(registryName)} vs BVN ${surname(bvnResName(bRes))}`);
    } else {
      push('bvn_match', 'BVN belongs to same person', true, bvnResName(bRes) || `BVN ${bRes.detail}`);
    }
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);
  // Hard fails (identity reuse, bad ID, underage, registry reject, BVN mismatch)
  // can never auto-pass.
  const hardFail = registryHardFail || bvnHardFail ||
    checks.some((c) => ['id_unique', 'id_format', 'age'].includes(c.key) && !c.passed);
  return { passed: !hardFail && score >= 70, score, checks };
}

function bvnResName(bRes) {
  return bRes?.record?.full_name || '';
}

export async function publicOrgList() {
  const { rows } = await query(
    `SELECT o.id, o.name, o.code, o.type,
            p.name AS parent_name
     FROM organisations o LEFT JOIN organisations p ON p.id = o.parent_id
     WHERE o.status = 'active' ORDER BY o.type, o.name`
  );
  return rows;
}
