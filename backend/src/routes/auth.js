import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit, hashToken, newResetToken } from '../lib/audit.js';
import { sendMail, appUrl } from '../lib/mailer.js';
import { authLimiter, forgotLimiter } from '../lib/rateLimit.js';

const router = express.Router();

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, address } = req.body;
    if (!firstName || !lastName || !email || !password)
      return res.status(400).json({ message: 'First name, last name, email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);

    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (first_name,last_name,email,password_hash,phone,address,status)
         VALUES ($1,$2,$3,$4,$5,$6,'pending')
         RETURNING id, first_name, last_name, email, role, status, created_at`,
        [firstName, lastName, email.toLowerCase(), hash, phone || null, address || null]
      );
      await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [rows[0].id]);
      return rows[0];
    });

    res.status(201).json({ token: signToken(user), user });
    audit(req, 'auth.register', 'user', user.id, { email: user.email }, user.id);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (user.status === 'pending')
      return res.status(403).json({ message: 'Account pending approval. An admin will review your application.' });
    if (user.status !== 'active') return res.status(403).json({ message: 'Account suspended' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    delete user.password_hash;
    res.json({ token: signToken(user), user });
    audit(req, 'auth.login', 'user', user.id, {}, user.id);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.role,
            u.status, u.created_at, w.balance
     FROM users u LEFT JOIN wallets w ON w.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );
  res.json(rows[0]);
}));

router.patch('/me', authenticate, asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, address } = req.body;
  const { rows } = await query(
    `UPDATE users SET first_name = COALESCE($1, first_name),
                      last_name  = COALESCE($2, last_name),
                      phone      = COALESCE($3, phone),
                      address    = COALESCE($4, address),
                      updated_at = NOW()
     WHERE id = $5
     RETURNING id, first_name, last_name, email, phone, address, role, status`,
    [firstName, lastName, phone, address, req.user.id]
  );
  res.json(rows[0]);
}));

router.patch('/password', authenticate, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ message: 'New password must be at least 6 characters' });

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = await bcrypt.compare(currentPassword || '', rows[0].password_hash);
  if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });

  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'Password updated' });
  audit(req, 'auth.password_changed', 'user', req.user.id, {});
}));

// Request a password reset. Always responds 200 so emails can't be
// enumerated; the link is single-use and expires after 60 minutes.
router.post(
  '/forgot-password',
  forgotLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    const done = () =>
      res.json({ message: 'If an account exists for that email, a reset link has been sent.' });

    if (!email) return done();
    const { rows } = await query('SELECT id, first_name, email FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    if (!rows[0]) return done();

    const token = newResetToken();
    await query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1,$2,NOW() + INTERVAL '60 minutes')`,
      [rows[0].id, hashToken(token)]
    );

    const link = `${appUrl()}/reset-password?token=${token}`;
    await sendMail({
      to: rows[0].email,
      subject: 'Reset your MPCS password',
      html: `<p>Hello ${rows[0].first_name || 'there'},</p>
        <p>Someone requested a password reset for your MPCS account. Click the link below within 60 minutes:</p>
        <p><a href="${link}">${link}</a></p>
        <p>If you didn't request this, ignore this email — your password stays unchanged.</p>`,
    }).catch((e) => console.error('reset mail failed:', e.message));

    audit(req, 'auth.password_reset_requested', 'user', rows[0].id, {}, rows[0].id);
    done();
  })
);

// Consume a reset token and set a new password.
router.post(
  '/reset-password',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || newPassword.length < 6)
      return res.status(400).json({ message: 'Valid token and a 6+ character password are required' });

    const { rows } = await query(
      `SELECT id, user_id FROM password_resets
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [hashToken(String(token))]
    );
    const reset = rows[0];
    if (!reset) return res.status(400).json({ message: 'Invalid or expired reset link' });

    const userId = await withTransaction(async (client) => {
      const hash = await bcrypt.hash(newPassword, 10);
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
        hash, reset.user_id,
      ]);
      await client.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);
      return reset.user_id;
    });

    audit(req, 'auth.password_reset_completed', 'user', userId, {}, userId);
    res.json({ message: 'Password has been reset. You can now sign in.' });
  })
);

export default router;