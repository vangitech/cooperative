import { pool, query } from '../src/db.js';
import { assignVirtualAccount } from '../src/lib/virtualAccounts.js';

// Backfill funding (mock) accounts for every user that has none.
// Idempotent: assignVirtualAccount returns the existing row when present.
// Forces local mock mode so the backfill never depends on the rail.
process.env.VIRTUAL_ACCOUNT_MODE = 'mock';
try {
  const { rows } = await query(
    `SELECT u.id, u.email FROM users u
     LEFT JOIN virtual_accounts v ON v.user_id = u.id
     WHERE v.user_id IS NULL ORDER BY u.id`
  );
  console.log(`Users without accounts: ${rows.length}`);
  let ok = 0;
  for (const u of rows) {
    try {
      const a = await assignVirtualAccount(u.id, {});
      console.log(`  #${u.id} ${u.email} → ${a.account_number} (${a.bank_name})`);
      ok += 1;
    } catch (e) {
      console.error(`  #${u.id} ${u.email} FAILED: ${e.message}`);
    }
  }
  console.log(`Done: ${ok}/${rows.length} issued`);
} catch (e) {
  console.error('Backfill failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
