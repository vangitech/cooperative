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

    // Seed admin
    const email = (process.env.ADMIN_EMAIL || 'admin@mpcs.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'admin1234';

    const existing = await query('SELECT id FROM users WHERE email=$1', [email]);
    if (!existing.rows.length) {
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (first_name,last_name,email,password_hash,role,status)
         VALUES ('System','Admin',$1,$2,'admin','active') RETURNING id`,
        [email, hash]
      );
      await query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [rows[0].id]);
      console.log(`👤 Admin created → ${email} / ${password}`);
    } else {
      console.log('ℹ️  Admin already exists');
    }

    console.log('🎉 Migration complete');
  } catch (e) {
    console.error('❌ Migration failed:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();