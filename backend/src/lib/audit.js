import crypto from 'crypto';
import { query } from '../db.js';

// Fire-and-forget audit logging — never throws, never blocks the request.
// Usage (all existing call sites keep working unchanged):
//   audit(req, 'loan.approved', 'loan', loanId, { amount })
//   audit(req, 'auth.login', 'user', user.id, {}, user.id)   // legacy actorId
// Rich usage (Priority 1 — before/after snapshots, outcome tracking):
//   audit(req, 'member.suspended', 'user', id, { reason },
//         { before: { status: 'active' }, after: { status: 'suspended' } })
//   audit(req, 'auth.login_failed', 'user', null, { email }, { outcome: 'failure' })
//
// actor_role + user_agent are captured automatically from req.user / headers,
// so every new entry carries role + outcome with zero call-site changes.
// Metadata and snapshots are scrubbed — secrets must never reach the log.
const SENSITIVE = new Set([
  'password', 'passwordhash', 'newpassword', 'currentpassword',
  'token', 'tokenhash', 'secret', 'secretkey', 'apikey', 'api_key',
  'pin', 'otp', 'bvn', 'nin', 'authorization',
]);

function scrub(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) {
      out[k] = SENSITIVE.has(k.toLowerCase().replace(/[^a-z]/g, '')) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

const toJson = (v) => {
  if (v === null || v === undefined) return null;
  const s = JSON.stringify(scrub(v));
  return s.length > 8000 ? `${s.slice(0, 8000)}…` : s;
};

export function audit(req, action, entity, entityId, metadata, opts) {
  const params = buildEntry(req, action, entity, entityId, metadata, opts);
  query(
    `INSERT INTO audit_logs
       (actor_id, actor_role, action, entity, entity_id, metadata,
        before_state, after_state, user_agent, channel, outcome, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    params
  ).catch((e) => console.error('audit log failed:', e.message));
}

// Priority 2: transactional audit. Call with the SAME client as the money
// movement so the entry commits or rolls back atomically with the funds —
// a crash can never leave money moved without a trace (or vice versa).
// Unlike audit(), this is awaited and a failure aborts the transaction,
// which is exactly the guarantee a ledger needs.
export async function auditTx(client, req, action, entity, entityId, metadata, opts) {
  const params = buildEntry(req, action, entity, entityId, metadata, opts);
  await client.query(
    `INSERT INTO audit_logs
       (actor_id, actor_role, action, entity, entity_id, metadata,
        before_state, after_state, user_agent, channel, outcome, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    params
  );
}

// System-actor stub for background jobs (cron sweeps, auto-debits) that
// move money with no HTTP request attached.
export const systemReq = { user: null, ip: null, headers: {} };
export const SYSTEM_CHANNEL = 'system';

function buildEntry(req, action, entity, entityId, metadata, opts) {
  // Backward compatible: 6th arg used to be a bare actorId.
  let o = {};
  if (opts !== null && typeof opts === 'object') o = opts;
  else if (opts !== undefined && opts !== null) o = { actorId: opts };

  const actor = o.actorId ?? req?.user?.id ?? null;
  const actorRole = o.actorRole ?? req?.user?.role ?? null;
  const ua = o.userAgent ?? req?.headers?.['user-agent'] ?? null;
  const outcome = o.outcome === 'failure' ? 'failure' : 'success';
  const channel = o.channel || 'web';

  return [
    actor, actorRole, action, entity, entityId ? String(entityId) : null,
    toJson(metadata), toJson(o.before), toJson(o.after),
    ua ? String(ua).slice(0, 255) : null, channel, outcome,
    req?.ip ?? null,
  ];
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newResetToken() {
  return crypto.randomBytes(32).toString('hex');
}
