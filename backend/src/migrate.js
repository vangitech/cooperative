import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { pool, query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('❌ Missing required env var: DATABASE_URL. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

async function migrate() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('✅ Schema applied');

    // Seed admin (legacy operational admin — limited perms; full rights live
    // with super_admin seeded below).
    const email = (process.env.ADMIN_EMAIL || 'admin@mpcs.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin1234';

    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (!existing.rows.length) {
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (first_name,last_name,email,password_hash,role,status,email_verified)
         VALUES ('System','Admin',$1,$2,'admin','active',true) RETURNING id`,
        [email, hash]
      );
      await query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [rows[0].id]);
      console.log(`👤 Admin created → ${email} / ${password}`);
    } else {
      console.log('ℹ️  Admin already exists');
    }

    // Seed super-admin: SOLE full-rights role (staff.manage + '*' + loan
    // override). Credentials ONLY from env — never hardcoded.
    const superEmail = (process.env.SUPERADMIN_EMAIL || '').toLowerCase();
    const superPassword = process.env.SUPERADMIN_PASSWORD || '';
    if (superEmail && superPassword) {
      const found = await query('SELECT id, role FROM users WHERE email=$1', [superEmail]);
      const hash = await bcrypt.hash(superPassword, 10);
      if (!found.rows.length) {
        const { rows } = await query(
          `INSERT INTO users (first_name,last_name,email,password_hash,role,status,email_verified)
           VALUES ('Super','Admin',$1,$2,'super_admin','active',true) RETURNING id`,
          [superEmail, hash]
        );
        await query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [rows[0].id]);
        const gen = await query(`SELECT id FROM organisations WHERE code = 'GEN'`);
        if (gen.rows[0]) {
          const code = `GEN-${String(new Date().getFullYear()).slice(2)}-SUPER`;
          await query(
            `INSERT INTO organisation_members (user_id, org_id, member_no, is_primary)
             VALUES ($1,$2,$3,true) ON CONFLICT (user_id, org_id) DO NOTHING`,
            [rows[0].id, gen.rows[0].id, code]
          );
        }
        console.log(`👑 Super-admin created → ${superEmail} (password from SUPERADMIN_PASSWORD)`);
      } else if (found.rows[0].role !== 'super_admin') {
        await query(
          `UPDATE users SET role='super_admin', status='active', email_verified=true, password_hash=$1, updated_at=NOW() WHERE email=$2`,
          [hash, superEmail]
        );
        console.log(`👑 Promoted to super-admin → ${superEmail}`);
      } else {
        console.log('ℹ️  Super-admin already exists');
      }
    } else {
      console.log('ℹ️  SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD not set — run `npm run make-superadmin -- <email> <password>` to create one');
    }

    // R3 backfill: grandfather currently-active members as verified so the
    // email gate only bites new/staff-created unverified accounts.
    const backfill = await query(
      `UPDATE users SET email_verified = true WHERE status = 'active' AND email_verified = false RETURNING id`
    );
    console.log(`✅ R3 backfill: ${backfill.rows.length} active user(s) marked email-verified`);

    console.log('🎉 Migration complete');
  } catch (e) {
    console.error('❌ Migration failed:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
