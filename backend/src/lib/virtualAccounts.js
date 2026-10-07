import { query } from '../db.js';
import { generateRef } from '../utils/helpers.js';
import { createVirtualAccount } from './flutterwave.js';

// Assign a permanent Flutterwave virtual account to a member for
// wallet funding via bank transfer. Best-effort: returns the account
// row on success, null on failure (caller decides whether to retry).
// Pass bvn/nin when known (required for static accounts in live mode).
export async function assignVirtualAccount(userId, { bvn, nin } = {}) {
  const existing = await query('SELECT * FROM virtual_accounts WHERE user_id = $1', [userId]);
  if (existing.rows[0]) return existing.rows[0];

  const u = await query('SELECT first_name, last_name, email, phone FROM users WHERE id = $1', [userId]);
  const user = u.rows[0];
  if (!user) return null;

  const txRef = generateRef('VA-USER');
  const flw = await createVirtualAccount({
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
  if (!data.account_number) throw new Error('Flutterwave did not return an account number');

  const { rows } = await query(
    `INSERT INTO virtual_accounts (user_id, account_number, bank_name, flw_ref, tx_ref)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id) DO UPDATE SET
       account_number = EXCLUDED.account_number, bank_name = EXCLUDED.bank_name,
       flw_ref = EXCLUDED.flw_ref, tx_ref = EXCLUDED.tx_ref
     RETURNING *`,
    [userId, data.account_number, data.bank_name || 'Flutterwave', data.flw_ref || null, txRef]
  );
  return rows[0];
}
