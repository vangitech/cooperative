import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';
import { asyncHandler } from '../utils/helpers.js';
import { authLimiter } from '../lib/rateLimit.js';
import { audit, auditTx, hashToken } from '../lib/audit.js';
import { verifyIdentity, bytidConfigured } from '../lib/bytid.js';
import { nextMemberNo } from '../lib/onboarding.js';
import { assignVirtualAccount } from '../lib/virtualAccounts.js';
import { sendMail } from '../lib/mailer.js';

// Staged member registration (all public, rate-limited):
//   1. POST /start            { employmentType, orgId } → sessionToken
//   2. POST /verify-identity  { sessionToken, idNumber, firstName?, lastName? }
//        private → NIN (format + unique + Bytid registry)
//        civil servant → IPPIS (format + unique; no public registry exists)
//   3. POST /verify-bvn       { sessionToken, bvn } → Bytid BVN (+ surname cross-check)
//   4. POST /send-code        { sessionToken, email } → 6-digit code by mail
//   5. POST /verify-code      { sessionToken, email, code }
//   6. POST /complete         { sessionToken, firstName, lastName, password, phone?, address? }
// Every gate is re-checked server-side from the intent row — the client can
// never forge a "verified" flag. Replaces the old instant POST /auth/register.

const router = express.Router();

const EMPLOYMENT = ['private', 'civil_servant'];
const CODE_TTL_SEC = 600;
const RESEND_SEC = 60;
const MAX_CODE_ATTEMPTS = 5;

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

async function openIntent(token) {
  const { rows } = await query('SELECT * FROM registration_intents WHERE session_token = $1', [token]);
  const it = rows[0];
  if (!it || it.status !== 'open' || new Date(it.expires_at) < new Date()) return null;
  return it;
}

const maskEmail = (email) => {
  const [name, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${name[0]}***@${domain}`;
};

router.post('/start', authLimiter, asyncHandler(async (req, res) => {
  const { employmentType, orgId } = req.body || {};
  if (!EMPLOYMENT.includes(employmentType)) {
    return res.status(400).json({ message: 'Choose private worker or civil servant' });
  }
  await query('DELETE FROM registration_intents WHERE expires_at < NOW()');
  let affiliationId = null;
  if (orgId) {
    const org = await query(`SELECT id FROM organisations WHERE id = $1 AND status = 'active'`, [orgId]);
    if (!org.rows[0]) return res.status(400).json({ message: 'Unknown organisation' });
    affiliationId = org.rows[0].id;
  }
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO registration_intents (session_token, employment_type, org_id, id_type)
     VALUES ($1,$2,$3,$4)`,
    [token, employmentType, affiliationId, employmentType === 'private' ? 'nin' : 'ippis']
  );
  audit(req, 'register.started', 'registration', null, { employmentType });
  res.status(201).json({
    sessionToken: token,
    employmentType,
    next: employmentType === 'private' ? 'nin' : 'ippis',
  });
}));

router.post('/verify-identity', authLimiter, asyncHandler(async (req, res) => {
  const { sessionToken, idNumber, firstName, lastName } = req.body || {};
  const it = await openIntent(sessionToken);
  if (!it) return res.status(410).json({ message: 'Session expired — restart registration' });
  const id = String(idNumber || '').trim();
  if (!id) return res.status(400).json({ message: 'ID number is required' });

  let result = null;
  if (it.employment_type === 'private') {
    if (!/^\d{11}$/.test(id)) return res.status(400).json({ message: 'NIN must be exactly 11 digits' });
    const dup = await query('SELECT user_id FROM kyc_profiles WHERE id_number = $1 LIMIT 1', [id]);
    if (dup.rows[0]) return res.status(409).json({ message: 'This NIN is already registered' });
    if (!bytidConfigured()) {
      return res.status(503).json({ message: 'Identity verification service unavailable — try again shortly' });
    }
    {
      const reg = await verifyIdentity({ type: 'nin', idNumber: id, firstName, lastName });
      result = { provider: 'bytid', mode: 'sandbox', ...reg, record: reg.record || null };
      if (!reg.checked) {
        // Provider unreachable — fail loudly, never silently pass.
        return res.status(502).json({ message: `Verification unavailable: ${reg.detail}` });
      }
      if (reg.status !== 'verified') {
        await query('UPDATE registration_intents SET id_number = $1, id_result = $2 WHERE id = $3', [
          id, JSON.stringify(result), it.id,
        ]);
        return res.status(422).json({
          message: reg.status === 'not_found' ? 'NIN not found in registry' : `NIN rejected: ${reg.detail}`,
        });
      }
    }
  } else {
    // Civil servants: IPPIS has no public registry API — format + uniqueness,
    // employer payroll cross-check stays a manual step.
    if (!/^\d{4,12}$/.test(id)) return res.status(400).json({ message: 'IPPIS number must be 4–12 digits' });
    const dup = await query('SELECT id FROM users WHERE ippis_number = $1 LIMIT 1', [id]);
    if (dup.rows[0]) return res.status(409).json({ message: 'This IPPIS number is already registered' });
    result = { provider: 'local', detail: 'format + duplicate checked (no IPPIS registry exists)' };
  }

  await query('UPDATE registration_intents SET id_number = $1, id_verified = true, id_result = $2 WHERE id = $3', [
    id, JSON.stringify(result), it.id,
  ]);
  audit(req, 'register.id_verified', 'registration', it.id, { employmentType: it.employment_type });
  // Echo the registry holder name so the UI shows WHO the ID belongs to
  // (and can pre-fill the Details step) instead of a bare "verified".
  res.json({ verified: true, next: 'bvn', fullName: result.record?.full_name || null });
}));

router.post('/verify-bvn', authLimiter, asyncHandler(async (req, res) => {
  const { sessionToken, bvn } = req.body || {};
  const it = await openIntent(sessionToken);
  if (!it) return res.status(410).json({ message: 'Session expired — restart registration' });
  if (!it.id_verified) return res.status(409).json({ message: 'Verify NIN/IPPIS first' });
  const clean = String(bvn || '').trim();
  if (!/^\d{11}$/.test(clean)) return res.status(400).json({ message: 'BVN must be exactly 11 digits' });
  if (!bytidConfigured()) {
    return res.status(503).json({ message: 'Identity verification service unavailable — try again shortly' });
  }

  let result = null;
  const reg = await verifyIdentity({ type: 'bvn', idNumber: clean });
  result = { provider: 'bytid', mode: 'sandbox', ...reg, record: reg.record || null };
  if (!reg.checked) {
    return res.status(502).json({ message: `Verification unavailable: ${reg.detail}` });
  }
  if (reg.status !== 'verified') {
    return res.status(422).json({
      message: reg.status === 'not_found' ? 'BVN not found in registry' : `BVN rejected: ${reg.detail}`,
    });
  }
  // Cross-check: BVN holder surname vs NIN holder surname (private path).
  const ninName = it.id_result?.record?.full_name || '';
  const bvnName = reg.record?.full_name || '';
  if (it.employment_type === 'private' && ninName && bvnName) {
    const surname = (n) => String(n).trim().split(/\s+/).pop().toUpperCase();
    if (surname(ninName) !== surname(bvnName)) {
      await query('UPDATE registration_intents SET bvn = $1, bvn_result = $2 WHERE id = $3', [
        clean, JSON.stringify({ ...result, crossCheck: 'surname mismatch' }), it.id,
      ]);
      return res.status(422).json({ message: 'BVN does not belong to the same person as the NIN' });
    }
    result.crossCheck = 'surname match';
  }

  await query('UPDATE registration_intents SET bvn = $1, bvn_verified = true, bvn_result = $2 WHERE id = $3', [
    clean, JSON.stringify(result), it.id,
  ]);
  audit(req, 'register.bvn_verified', 'registration', it.id, { employmentType: it.employment_type });
  res.json({ verified: true, next: 'email-code', fullName: reg.record?.full_name || null });
}));

router.post('/send-code', authLimiter, asyncHandler(async (req, res) => {
  const { sessionToken, email } = req.body || {};
  const it = await openIntent(sessionToken);
  if (!it) return res.status(410).json({ message: 'Session expired — restart registration' });
  if (!it.bvn_verified) return res.status(409).json({ message: 'Verify BVN first' });
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return res.status(400).json({ message: 'Valid email required' });
  const exists = await query('SELECT id FROM users WHERE email = $1', [clean]);
  if (exists.rows.length) return res.status(409).json({ message: 'Email already registered' });
  if (it.last_code_sent_at && Date.now() - new Date(it.last_code_sent_at).getTime() < RESEND_SEC * 1000) {
    return res.status(429).json({ message: `Wait ${RESEND_SEC} seconds before resending` });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await query(
    `UPDATE registration_intents
     SET email = $1, email_code_hash = $2, email_code_expires_at = NOW() + INTERVAL '${CODE_TTL_SEC} seconds',
         email_verified = false, email_attempts = 0, last_code_sent_at = NOW()
     WHERE id = $3`,
    [clean, hashToken(code), it.id]
  );
  // The code travels by email only — never in an API response (dev mailer logs it).
  try {
    await sendMail({
      to: clean,
      subject: 'Your MPCS verification code',
      html: `<p>Your MPCS verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
    });
  } catch (e) {
    // Provider/config failure (bad key, unverified domain, or Resend test
    // sender which only delivers to the account owner's inbox) — surfaced
    // with the fix, not swallowed.
    const msg = String(e.message || '');
    const hint = /own email|testing|domain|verify/i.test(msg)
      ? ' Tip: Resend test senders only deliver to the account owner’s inbox — verify a domain in Resend (or test with the owner email) to receive codes.'
      : '';
    return res.status(502).json({ message: `Email delivery failed: ${msg}.${hint}` });
  }
  audit(req, 'register.code_sent', 'registration', it.id, { to: maskEmail(clean) });
  res.json({ sent: true, to: maskEmail(clean), expiresIn: CODE_TTL_SEC });
}));

router.post('/verify-code', authLimiter, asyncHandler(async (req, res) => {
  const { sessionToken, email, code } = req.body || {};
  const it = await openIntent(sessionToken);
  if (!it) return res.status(410).json({ message: 'Session expired — restart registration' });
  const clean = String(email || '').trim().toLowerCase();
  if (!it.email || it.email !== clean || !it.email_code_hash) {
    return res.status(409).json({ message: 'Request a code first' });
  }
  if (new Date(it.email_code_expires_at) < new Date()) {
    return res.status(410).json({ message: 'Code expired — request a new one' });
  }
  if (it.email_attempts >= MAX_CODE_ATTEMPTS) {
    await query(`UPDATE registration_intents SET status = 'locked' WHERE id = $1`, [it.id]);
    return res.status(423).json({ message: 'Too many attempts — restart registration' });
  }
  const ok = crypto.timingSafeEqual(
    Buffer.from(hashToken(String(code || '').trim())),
    Buffer.from(it.email_code_hash)
  );
  if (!ok) {
    const left = MAX_CODE_ATTEMPTS - it.email_attempts - 1;
    await query('UPDATE registration_intents SET email_attempts = email_attempts + 1 WHERE id = $1', [it.id]);
    return res.status(422).json({ message: `Wrong code — ${left} attempt${left === 1 ? '' : 's'} left` });
  }
  await query('UPDATE registration_intents SET email_verified = true WHERE id = $1', [it.id]);
  audit(req, 'register.email_verified', 'registration', it.id, { to: maskEmail(clean) });
  res.json({ verified: true, next: 'details' });
}));

router.post('/complete', authLimiter, async (req, res) => {
  try {
    const { sessionToken, firstName, lastName, password, phone, address } = req.body || {};
    const it = await openIntent(sessionToken);
    if (!it) return res.status(410).json({ message: 'Session expired — restart registration' });
    if (!it.id_verified || !it.bvn_verified || !it.email_verified) {
      return res.status(409).json({ message: 'Complete NIN/IPPIS, BVN and email verification first' });
    }
    if (!firstName || !lastName || !password) {
      return res.status(400).json({ message: 'First name, last name and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await withTransaction(async (client) => {
      const affiliationId = it.org_id || (await client.query(
        `SELECT id FROM organisations WHERE code = 'GEN'`
      )).rows[0].id;
      const memberNo = await nextMemberNo(client, affiliationId);
      const { rows } = await client.query(
        `INSERT INTO users (first_name,last_name,email,password_hash,phone,address,status,member_no,employment_type,ippis_number,email_verified)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,true)
         RETURNING id, first_name, last_name, email, role, status, member_no, employment_type, created_at`,
        [firstName, lastName, it.email, hash, phone || null, address || null,
         memberNo, it.employment_type, it.employment_type === 'civil_servant' ? it.id_number : null]
      );
      await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [rows[0].id]);
      await client.query(
        `INSERT INTO organisation_members (user_id, org_id, member_no, is_primary)
         VALUES ($1,$2,$3,true)`,
        [rows[0].id, affiliationId, memberNo]
      );
      await auditTx(client, req, 'member.onboarded', 'user', rows[0].id,
        { email: rows[0].email, memberNo, employmentType: it.employment_type, channel: 'self' });
      // Single-use: strip secrets, close the session.
      await client.query(
        `UPDATE registration_intents
         SET status = 'used', bvn = NULL, email_code_hash = NULL WHERE id = $1`,
        [it.id]
      );
      return rows[0];
    });

    let virtualAccount = null;
    try {
      const nin = it.employment_type === 'private' ? it.id_number : undefined;
      virtualAccount = await assignVirtualAccount(user.id, { nin, bvn: undefined });
    } catch (e) {
      console.error('virtual account deferred:', e.message);
    }

    res.status(201).json({ token: signToken(user), user, virtualAccount });
    audit(req, 'auth.register', 'user', user.id,
      { email: user.email, employmentType: it.employment_type },
      { actorId: user.id, actorRole: user.role });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Already registered (email or ID in use)' });
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
