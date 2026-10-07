import express from 'express';
import { query } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { assignVirtualAccount } from '../lib/virtualAccounts.js';

const router = express.Router();

// Member's own funding account (null while assignment is pending).
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM virtual_accounts WHERE user_id = $1', [req.user.id]);
    res.json(rows[0] || null);
  })
);

// Admin retry: (re)assign a funding account, optionally with BVN/NIN
// (required for static accounts in live mode).
router.post(
  '/assign',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { userId, bvn, nin } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId is required' });
    try {
      const account = await assignVirtualAccount(userId, { bvn, nin });
      if (!account) return res.status(404).json({ message: 'User not found' });
      audit(req, 'virtual_account.assigned', 'virtual_account', account.id, { userId });
      res.status(201).json(account);
    } catch (e) {
      res.status(502).json({ message: `Assignment failed: ${e.message}` });
    }
  })
);

export default router;
