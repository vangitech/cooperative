import { query } from '../db.js';
import { generateRef } from '../utils/helpers.js';
import { getProvider } from './providers.js';

// Funding account issuance. Mode via VIRTUAL_ACCOUNT_MODE:
//   auto (default) — try the rail (Flutterwave test keys return test numbers),
//                    fall back to a local mock on any failure so every member
//                    always has an account number to see and fund by.
//   mock           — always issue local mock numbers (dev / demo).
//   rail           — rail only; throws when the rail fails (old behavior).
// Mock numbers are deterministic per user (9 + zero-padded id), unique-checked,
// and flagged is_mock + 'MPCS Test Bank' so they can never pass as live rail
// accounts. Balances ALWAYS read from our ledger — the number is only a pointer.
function mockNumber(userId) {
  return `9${String(userId).padStart(9, '0').slice(-9)}`;
}

async function issueMockAccount(userId, txRef) {
  let accountNumber = mockNumber(userId);
  for (let i = 0; i < 25; i++) {
    const { rows } = await query('SELECT user_id FROM virtual_accounts WHERE account_number = $1', [accountNumber]);
    if (!rows[0] || Number(rows[0].user_id) === Number(userId)) break;
    accountNumber = `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
  }
  const { rows } = await query(
    `INSERT INTO virtual_accounts (user_id, account_number, bank_name, flw_ref, tx_ref, is_mock)
     VALUES ($1,$2,'MPCS Test Bank',NULL,$3,true)
     ON CONFLICT (user_id) DO UPDATE SET
       account_number = EXCLUDED.account_number, bank_name = EXCLUDED.bank_name,
       flw_ref = NULL, tx_ref = EXCLUDED.tx_ref, is_mock = true
     RETURNING *`,
    [userId, accountNumber, txRef]
  );
  return rows[0];
}

// Assign a permanent funding account to a member for wallet funding via bank
// transfer. Best-effort: returns the account row on success, null on failure
// (caller decides whether to retry).
// Pass bvn/nin when known (required for static accounts in live mode).
export async function assignVirtualAccount(userId, { bvn, nin } = {}) {
  const existing = await query('SELECT * FROM virtual_accounts WHERE user_id = $1', [userId]);
  if (existing.rows[0]) return existing.rows[0];

  const u = await query('SELECT first_name, last_name, email, phone FROM users WHERE id = $1', [userId]);
  const user = u.rows[0];
  if (!user) return null;

  const mode = (process.env.VIRTUAL_ACCOUNT_MODE || 'auto').toLowerCase();
  const txRef = generateRef('VA-USER');

  if (mode !== 'mock') {
    try {
      const rail = getProvider();
      const flw = await rail.createVirtualAccount({
        email: user.email,
        txRef,
        firstname: user.first_name,
        lastname: user.last_name,
        phonenumber: user.phone || undefined,
        narration: `MPCS ${user.first_name} ${user.last_name}`.slice(0, 60),
        bvn,
        nin,
      });

      const data = flw.data || {};
      if (!data.account_number) throw new Error(`${rail.name} did not return an account number`);

      const { rows } = await query(
        `INSERT INTO virtual_accounts (user_id, account_number, bank_name, flw_ref, tx_ref, is_mock)
         VALUES ($1,$2,$3,$4,$5,false)
         ON CONFLICT (user_id) DO UPDATE SET
           account_number = EXCLUDED.account_number, bank_name = EXCLUDED.bank_name,
           flw_ref = EXCLUDED.flw_ref, tx_ref = EXCLUDED.tx_ref, is_mock = false
         RETURNING *`,
        [userId, data.account_number, data.bank_name || 'Flutterwave', data.flw_ref || null, txRef]
      );
      return rows[0];
    } catch (e) {
      if (mode === 'rail') throw e;
      console.warn(`virtual account rail failed, issuing mock for user ${userId}:`, e.message);
    }
  }

  return issueMockAccount(userId, txRef);
}
