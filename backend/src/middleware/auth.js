import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { hasPerm } from '../lib/permissions.js';
import { loanDocStatus } from '../lib/onboarding.js';
import { audit } from '../lib/audit.js';

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      'SELECT id, first_name, last_name, email, role, status, email_verified FROM users WHERE id = $1',
      [payload.id]
    );
    if (!rows[0]) return res.status(401).json({ message: 'User not found' });
    if (rows[0].status === 'pending')
      return res.status(403).json({ message: 'Account pending approval' });
    if (rows[0].status !== 'active')
      return res.status(403).json({ message: 'Account is suspended' });

    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// R3: verified email gates money-out. Staff bypass nothing — everyone with an
// unverified email is blocked from withdrawals, transfers and bank payouts
// until verified (grandfathered actives are backfilled true on migrate).
export async function requireVerifiedEmail(req, res, next) {
  try {
    const { rows } = await query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]?.email_verified) {
      audit(req, 'auth.withdrawal_blocked_unverified', 'user', req.user.id,
        { path: req.originalUrl }, { outcome: 'failure' });
      return res.status(403).json({
        message: 'Verify your email before moving money out. Check your inbox for the code or contact support.',
      });
    }
    next();
  } catch {
    return res.status(500).json({ message: 'Verification check failed' });
  }
}

// Additional verification gates money-out (both sectors — private workers
// and civil servants): a RECENT utility bill (electricity / water / waste,
// within the last 3 months) + one valid government ID (international
// passport, driver's license or voter's card), uploaded under Profile →
// KYC. Chain after requireVerifiedEmail on withdrawals, transfers and bank
// payouts. Same posture as the email gate: everyone is checked, blocks are
// audited as failures.
export async function requireAdditionalDocs(req, res, next) {
  try {
    let rows;
    try {
      ({ rows } = await query(
        'SELECT doc_type, doc_date, created_at FROM kyc_documents WHERE user_id = $1',
        [req.user.id]
      ));
    } catch (e) {
      if (/column .* does not exist|undefined_column/.test(String(e.message))) {
        ({ rows } = await query(
          'SELECT doc_type, created_at FROM kyc_documents WHERE user_id = $1',
          [req.user.id]
        ));
      } else {
        throw e;
      }
    }
    const status = loanDocStatus(rows);
    if (!status.passed) {
      audit(req, 'auth.moneyout_blocked_missing_docs', 'user', req.user.id,
        { path: req.originalUrl, missing: status.missing }, { outcome: 'failure' });
      return res.status(403).json({
        message: `Upload ${status.missing.join(' and ')} under Profile → KYC before moving money out.`,
        missing: status.missing,
      });
    }
    next();
  } catch {
    return res.status(500).json({ message: 'Verification check failed' });
  }
}

export function requireAdmin(req, res, next) {
  if (!['admin', 'super_admin'].includes(req.user?.role))
    return res.status(403).json({ message: 'Admin access required' });
  next();
}

// Granular staff gate: requirePerm('loans.review') etc.
export function requirePerm(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' });
    const ok = perms.some((p) => hasPerm(req.user.role, p));
    if (!ok) {
      audit(req, 'auth.forbidden', 'auth', null,
        { path: req.originalUrl, required: perms }, { outcome: 'failure' });
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}