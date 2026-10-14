import { verifyKyc, loanDocStatus } from './onboarding.js';
import { notify } from './notify.js';

// Loan maker-checker helpers. Stage chain:
//   pending → grantor_approved → kyc_verified → disbursed
//   (rejected at any stage; kyc_failed = back to the officer queue)
// Separation of duties: a non-super_admin may act in at most ONE stage per
// loan. super_admin is exempt (logged as override) so a fresh deployment
// with a single staffer can still operate.

export const LOAN_STAGES = ['pending', 'grantor_approved', 'kyc_verified', 'disbursed'];

export async function borrowerOrg(client, userId) {
  const { rows } = await client.query(
    `SELECT o.id, o.name, o.code, o.type
     FROM organisation_members m JOIN organisations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND m.is_primary AND m.status = 'active'`,
    [userId]
  );
  return rows[0] || null;
}

export async function orgGrantors(client, orgId) {
  const { rows } = await client.query(
    `SELECT u.id, u.first_name, u.last_name, u.email
     FROM organisation_members m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1 AND m.status = 'active'
       AND u.role = 'grantor' AND u.status = 'active'`,
    [orgId]
  );
  return rows;
}

export async function usersInRoles(client, roles) {
  const { rows } = await client.query(
    `SELECT id, first_name, last_name, email, role FROM users
     WHERE role = ANY($1) AND status = 'active'`,
    [roles]
  );
  return rows;
}

export async function recordReview(client, req, loanId, stage, action, note, metadata) {
  await client.query(
    `INSERT INTO loan_reviews (loan_id, stage, reviewer_id, action, note, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [loanId, stage, req.user.id, action, note || null, metadata ? JSON.stringify(metadata) : null]
  );
}

// A prior-stage actor (non-super_admin) cannot act again on the same loan.
export async function separationCheck(client, loan, actorId, actorRole) {
  if (actorRole === 'super_admin') return { override: true };
  const acted = [loan.grantor_id, loan.officer_id, loan.reviewed_by, loan.pushed_by]
    .filter(Boolean).map(Number);
  if (acted.includes(Number(actorId))) {
    throw new Error('Separation of duties: you already acted on this loan — another staffer must take this stage');
  }
  return { override: false };
}

// Re-run the FULL system KYC pass for the borrower at loan time and name
// exactly which checks fail (drives the officer → grantor message).
export async function runLoanKyc(client, borrowerId) {
  const u = await client.query(
    'SELECT id, first_name, last_name, email, phone FROM users WHERE id = $1',
    [borrowerId]
  );
  const user = u.rows[0];
  if (!user) throw new Error('Borrower not found');
  const k = await client.query('SELECT * FROM kyc_profiles WHERE user_id = $1', [borrowerId]);
  const profile = k.rows[0];
  if (!profile) {
    return {
      passed: false, score: 0, profile: null,
      checks: [{ key: 'profile', label: 'KYC profile submitted', passed: false, detail: 'no KYC profile on file' }],
      failed: ['KYC profile submitted'],
    };
  }
  let docs;
  try {
    docs = await client.query('SELECT id, doc_type, doc_date, created_at FROM kyc_documents WHERE user_id = $1', [borrowerId]);
  } catch (e) {
    if (/column .* does not exist|undefined_column/.test(String(e.message))) {
      docs = await client.query('SELECT id, doc_type, created_at FROM kyc_documents WHERE user_id = $1', [borrowerId]);
    } else {
      throw e;
    }
  }
  const g = await client.query('SELECT COUNT(*) FROM guarantors WHERE user_id = $1', [borrowerId]);
  const result = await verifyKyc(client, {
    userId: borrowerId, email: user.email, phone: user.phone,
    firstName: user.first_name, lastName: user.last_name, dob: profile.dob,
    idType: profile.id_type, idNumber: profile.id_number,
    documents: docs.rows,
  });
  // Loan-time document rule (both sectors): recent utility bill + one valid
  // government ID. Surfaced as named checks so the officer sees exactly
  // what is missing; the POST /loans gate already blocks applications.
  const loanDocs = loanDocStatus(docs.rows);
  const checks = [
    ...result.checks,
    {
      key: 'utility_bill',
      label: 'Recent utility bill (electricity / water / waste, ≤ 3 months)',
      passed: loanDocs.hasUtilityBill && loanDocs.utilityRecent,
      detail: !loanDocs.hasUtilityBill
        ? 'none uploaded'
        : loanDocs.utilityRecent
          ? `dated ${loanDocs.utilityDate}`
          : `dated ${loanDocs.utilityDate} — older than 3 months`,
    },
    {
      key: 'gov_id',
      label: 'Valid government ID (passport / driver\u2019s license / voter\u2019s card)',
      passed: loanDocs.hasGovId,
      detail: loanDocs.hasGovId ? loanDocs.govIdType.replaceAll('_', ' ') : 'none uploaded',
    },
  ];
  return {
    ...result,
    checks,
    profile: { status: profile.status, id_type: profile.id_type, guarantors: Number(g.rows[0].count), documents: docs.rows.length },
    failed: checks.filter((c) => !c.passed).map((c) => c.label),
  };
}

// 1:1 chat room between two staffers (reused for officer → grantor messages).
export async function ensureDirectChat(client, userA, userB, title) {
  const { rows: existing } = await client.query(
    `SELECT c.id FROM chat_conversations c
     JOIN chat_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
     JOIN chat_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
     WHERE c.type = 'direct'
       AND (SELECT COUNT(*) FROM chat_participants p WHERE p.conversation_id = c.id) = 2
     LIMIT 1`,
    [userA, userB]
  );
  if (existing[0]) return existing[0].id;
  const { rows } = await client.query(
    `INSERT INTO chat_conversations (type, title, created_by) VALUES ('direct',$1,$2) RETURNING id`,
    [title || null, userA]
  );
  for (const uid of [userA, userB]) {
    await client.query(
      `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [rows[0].id, uid]
    );
  }
  return rows[0].id;
}

export function notifyMany(ids, payload) {
  for (const id of [...new Set(ids.filter(Boolean))]) notify(id, payload);
}
