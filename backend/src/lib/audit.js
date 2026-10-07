import crypto from 'crypto';
import { query } from '../db.js';

// Fire-and-forget audit logging — never throws, never blocks the request.
// Usage: audit(req, 'loan.approved', 'loan', loanId, { amount })
// On public auth routes (no req.user yet) pass the actor explicitly:
//   audit(req, 'auth.login', 'user', user.id, {}, user.id)
export function audit(req, action, entity, entityId, metadata, actorId) {
  const actor = actorId ?? req?.user?.id ?? null;
  const ip = req?.ip ?? null;
  query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor, action, entity, entityId ? String(entityId) : null, metadata ? JSON.stringify(metadata) : null, ip]
  ).catch((e) => console.error('audit log failed:', e.message));
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newResetToken() {
  return crypto.randomBytes(32).toString('hex');
}
