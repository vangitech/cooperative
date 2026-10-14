import bcrypt from 'bcryptjs';
import { pool, query } from '../src/db.js';

// Creates (or promotes) a super-admin. Credentials come from argv/env —
// never hardcoded, never logged.
//   npm run make-superadmin -- super@example.com 'StrongPass123'
//   SUPERADMIN_EMAIL=x SUPERADMIN_PASSWORD=y npm run make-superadmin
const email = (process.argv[2] || process.env.SUPERADMIN_EMAIL || '').toLowerCase();
const password = process.argv[3] || process.env.SUPERADMIN_PASSWORD || '';

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run make-superadmin -- <email> <password-min-8-chars>');
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

try {
  const hash = await bcrypt.hash(password, 10);
  const found = await query('SELECT id, role FROM users WHERE email = $1', [email]);
  if (!found.rows.length) {
    const { rows } = await query(
      `INSERT INTO users (first_name,last_name,email,password_hash,role,status,email_verified)
       VALUES ('Super','Admin',$1,$2,'super_admin','active',true) RETURNING id`,
      [email, hash]
    );
    await query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [rows[0].id]);
    const gen = await query(`SELECT id FROM organisations WHERE code = 'GEN'`);
    if (gen.rows[0]) {
      await query(
        `INSERT INTO organisation_members (user_id, org_id, member_no, is_primary)
         VALUES ($1,$2,$3,true) ON CONFLICT (user_id, org_id) DO NOTHING`,
        [rows[0].id, gen.rows[0].id, `GEN-${String(new Date().getFullYear()).slice(2)}-SUPER`]
      );
    }
    console.log(`👑 Super-admin created: ${email} — sign in at /login`);
  } else {
    await query(
      `UPDATE users SET role='super_admin', status='active', email_verified=true, password_hash=$1, updated_at=NOW() WHERE email=$2`,
      [hash, email]
    );
    console.log(`👑 Promoted to super-admin: ${email} — sign in at /login`);
  }
} catch (e) {
  console.error('❌ make-superadmin failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
