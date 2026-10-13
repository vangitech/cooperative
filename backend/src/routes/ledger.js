import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit, auditTx } from '../lib/audit.js';
import { postJournal, periodOf, trialBalance } from '../lib/ledger.js';
import { runReconciliation, suspenseList } from '../lib/reconcile.js';

const router = express.Router();
router.use(authenticate);

// Maker-checker adjustments: staff propose balanced lines + reason;
// only admins approve (posting atomically) or reject.

router.get(
  '/adjustments',
  requirePerm('adjustments.propose'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT a.*, u.email AS proposed_by_email
       FROM adjustments a LEFT JOIN users u ON u.id = a.proposed_by
       ORDER BY a.created_at DESC LIMIT 200`
    );
    res.json(rows);
  })
);

router.post(
  '/adjustments',
  requirePerm('adjustments.propose'),
  asyncHandler(async (req, res) => {
    const { lines, reason, period, reversalOf } = req.body || {};
    if (!reason || !String(reason).trim())
      return res.status(400).json({ message: 'A reason is required for every adjustment' });
    if (!Array.isArray(lines) || lines.length < 2)
      return res.status(400).json({ message: 'At least 2 journal lines are required' });
    for (const l of lines) {
      if (!l.code || (!(Number(l.debit) > 0) && !(Number(l.credit) > 0)))
        return res.status(400).json({ message: 'Each line needs an account and a debit or credit' });
      if (Number(l.debit) > 0 && Number(l.credit) > 0)
        return res.status(400).json({ message: 'A line cannot debit and credit' });
    }
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    if (Math.abs(dr - cr) > 0.005)
      return res.status(400).json({ message: 'Adjustment lines must balance' });
    const targetPeriod = period || periodOf();
    if (!/^\d{4}-\d{2}$/.test(targetPeriod))
      return res.status(400).json({ message: 'Period must be YYYY-MM' });

    const { rows } = await query(
      `INSERT INTO adjustments (lines, reason, period, reversal_of, proposed_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [JSON.stringify(lines), String(reason).trim(), targetPeriod, reversalOf || null, req.user.id]
    );
    audit(req, 'adjustment.proposed', 'adjustment', rows[0].id, { reason: rows[0].reason });
    res.status(201).json(rows[0]);
  })
);

router.patch(
  '/adjustments/:id/approve',
  requirePerm('adjustments.approve'),
  asyncHandler(async (req, res) => {
    const result = await withTransaction(async (client) => {
      const f = await client.query('SELECT * FROM adjustments WHERE id = $1 FOR UPDATE', [req.params.id]);
      const adj = f.rows[0];
      if (!adj) throw new Error('Adjustment not found');
      if (adj.status !== 'pending') throw new Error(`Already ${adj.status}`);
      if (adj.proposed_by === req.user.id)
        throw new Error('Proposer cannot approve their own adjustment');
      const entry = await postJournal(client, req, {
        type: 'adjustment',
        reference: `#${adj.id} ${adj.reason}`.slice(0, 120),
        lines: adj.lines,
        postedAt: new Date(`${adj.period}-15T12:00:00Z`),
      });
      const r = await client.query(
        `UPDATE adjustments SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
          review_note = $2 WHERE id = $3 RETURNING *`,
        [req.user.id, req.body.note || null, adj.id]
      );
      await auditTx(client, req, 'adjustment.approved', 'adjustment', adj.id,
        { entry: entry.entry_no });
      return { adjustment: r.rows[0], entry };
    });
    res.json(result);
  })
);

router.patch(
  '/adjustments/:id/reject',
  requirePerm('adjustments.approve'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `UPDATE adjustments SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
       WHERE id = $3 AND status = 'pending' RETURNING *`,
      [req.user.id, req.body.note || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Pending adjustment not found' });
    audit(req, 'adjustment.rejected', 'adjustment', rows[0].id, { note: rows[0].review_note });
    res.json(rows[0]);
  })
);

// Accounting periods: list (open/closed) + close (admin only).
router.get(
  '/periods',
  requirePerm('adjustments.propose'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT DISTINCT period FROM journal_entries ORDER BY period DESC LIMIT 24`
    );
    const closed = await query('SELECT period, closed_at FROM close_periods');
    const shut = new Set(closed.rows.map((r) => r.period));
    res.json(rows.map((r) => ({ period: r.period, closed: shut.has(r.period) })));
  })
);

router.post(
  '/periods/close',
  requirePerm('adjustments.approve'),
  asyncHandler(async (req, res) => {
    const { period, note } = req.body || {};
    if (!period || !/^\d{4}-\d{2}$/.test(period))
      return res.status(400).json({ message: 'Period must be YYYY-MM' });
    try {
      const { rows } = await query(
        `INSERT INTO close_periods (period, closed_by, note) VALUES ($1,$2,$3) RETURNING *`,
        [period, req.user.id, note || null]
      );
      audit(req, 'period.closed', 'period', null, { period });
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ message: 'Period already closed' });
      throw e;
    }
  })
);

// Trial balance snapshot (accountants + admins).
router.get(
  '/trial-balance',
  requirePerm('adjustments.propose'),
  asyncHandler(async (req, res) => {
    const tb = await trialBalance();
    const dr = tb.reduce((s, a) => s + Number(a.debit), 0);
    const cr = tb.reduce((s, a) => s + Number(a.credit), 0);
    res.json({ balanced: Math.abs(dr - cr) < 0.005, lines: tb });
  })
);

// L3 reconciliation runs + suspense queue (back-office only).
router.post(
  '/reconcile/run',
  requirePerm('books.reconcile'),
  asyncHandler(async (req, res) => {
    const { statements } = req.body || {};
    if (statements !== undefined) {
      if (!Array.isArray(statements)) return res.status(400).json({ message: 'statements must be an array' });
      for (const s of statements) {
        if (!s.code || !(Number(s.balance) >= 0))
          return res.status(400).json({ message: 'Each statement needs { code, balance >= 0 }' });
      }
    }
    const result = await withTransaction(async (client) => {
      const out = await runReconciliation(client, {
        actorId: req.user.id, channel: 'web', statements: statements || [],
      });
      await auditTx(client, req, 'recon.run', 'reconciliation', out.runId, {
        passed: out.passed, checks: out.checks.length,
      });
      return out;
    });
    res.status(201).json(result);
  })
);

router.get(
  '/reconcile/runs',
  requirePerm('books.reconcile'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT r.*, u.email AS run_by_email FROM reconciliation_runs r
       LEFT JOIN users u ON u.id = r.run_by ORDER BY r.run_at DESC LIMIT 50`
    );
    res.json(rows);
  })
);

router.get(
  '/suspense',
  requirePerm('books.reconcile'),
  asyncHandler(async (req, res) => {
    res.json(await suspenseList(req.query.status));
  })
);

router.patch(
  '/suspense/:id/resolve',
  requirePerm('books.reconcile'),
  asyncHandler(async (req, res) => {
    const { resolution } = req.body || {};
    if (!resolution || !String(resolution).trim())
      return res.status(400).json({ message: 'A resolution note is required' });
    const { rows } = await query(
      `UPDATE suspense_items SET status = 'resolved', resolved_by = $1,
        resolution = $2, resolved_at = NOW()
       WHERE id = $3 AND status = 'open' RETURNING *`,
      [req.user.id, String(resolution).trim(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Open suspense item not found' });
    audit(req, 'recon.resolved', 'suspense', rows[0].id, { kind: rows[0].kind, resolution: rows[0].resolution });
    res.json(rows[0]);
  })
);

export default router;
