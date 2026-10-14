import express from 'express';
import { query } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { validateDocument } from '../lib/onboarding.js';
import { notify } from '../lib/notify.js';

const router = express.Router();
router.use(authenticate);

export const COMPLIANCE_TYPES = ['pcidss', 'iso', 'financial_audit', 'license', 'tax', 'other'];

// Derived status from expiry date: valid / expiring (≤60d) / expired.
export function complianceStatus(expiryDate) {
  if (!expiryDate) return 'unknown';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  const days = Math.ceil((exp - today) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 60) return 'expiring';
  return 'valid';
}

export function daysLeft(expiryDate) {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp - today) / 86400000);
}

function withDerived(row) {
  if (!row) return row;
  const left = daysLeft(row.expiry_date);
  return { ...row, days_left: left, status: complianceStatus(row.expiry_date) };
}

// Notify all staff (admin/officer/accountant) once per day per document
// while it sits inside the 60-day window (or is expired). Called on every
// list read + explicit POST /check so the countdown ticks daily without cron.
async function checkExpiries(source = 'read') {
  try {
    const { rows: docs } = await query(
      `SELECT id, title, doc_type, expiry_date, last_reminded_at FROM compliance_documents`
    );
    const todayStr = new Date().toISOString().slice(0, 10);
    const { rows: staff } = await query(
      `SELECT id FROM users WHERE role IN ('super_admin','admin','officer','accountant') AND status = 'active'`
    );
    let notified = 0;
    for (const d of docs) {
      const left = daysLeft(d.expiry_date);
      if (left === null || left > 60) continue;
      if (d.last_reminded_at && String(d.last_reminded_at).slice(0, 10) === todayStr) continue;
      const label = left < 0
        ? `EXPIRED ${Math.abs(left)} day(s) ago`
        : left === 0
          ? 'expires TODAY'
          : `${left} day(s) to expiry`;
      for (const s of staff) {
        notify(s.id, {
          title: left < 0 ? `Compliance expired: ${d.title}` : `Compliance expiring: ${d.title}`,
          body: `${d.doc_type} — ${label} (expires ${String(d.expiry_date).slice(0, 10)}). Open Admin → Compliance to renew.`,
          link: '/admin/compliance',
        });
        notified += 1;
      }
      await query(`UPDATE compliance_documents SET last_reminded_at = CURRENT_DATE WHERE id = $1`, [d.id]);
    }
    return { checked: docs.length, notified, source };
  } catch (e) {
    console.error('compliance check failed:', e.message);
    return { checked: 0, notified: 0, source, error: e.message };
  }
}

// List + run the daily countdown check.
router.get(
  '/',
  requirePerm('compliance.read'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.id, c.title, c.doc_type, c.issuer, c.license_no, c.filename, c.mime,
              c.size_bytes, c.issue_date, c.renewed_date, c.expiry_date, c.notes,
              c.last_reminded_at, c.created_at, c.updated_at,
              u.first_name AS uploaded_by_first, u.last_name AS uploaded_by_last
       FROM compliance_documents c LEFT JOIN users u ON u.id = c.uploaded_by
       ORDER BY c.expiry_date`
    );
    const items = rows.map(withDerived);
    const summary = {
      total: items.length,
      expired: items.filter((i) => i.status === 'expired').length,
      expiring: items.filter((i) => i.status === 'expiring').length,
      valid: items.filter((i) => i.status === 'valid').length,
    };
    // Fire the 60-day → daily countdown notifications (deduped per day).
    const check = await checkExpiries('list');
    res.json({ items, summary, check });
  })
);

// Explicit daily check (cron / manual refresh button).
router.post(
  '/check',
  requirePerm('compliance.read'),
  asyncHandler(async (req, res) => {
    res.json(await checkExpiries('manual'));
  })
);

// Upload a licence/certificate: file (base64) + issue/renewed + expiry dates.
// renewed_date defaults to issue_date; the system logs created_at as the log date.
router.post(
  '/',
  requirePerm('compliance.manage'),
  asyncHandler(async (req, res) => {
    const { title, docType, issuer, licenseNo, issueDate, renewedDate, expiryDate, notes, file } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ message: 'Title is required' });
    const type = (docType || 'other').toLowerCase();
    if (!COMPLIANCE_TYPES.includes(type)) {
      return res.status(400).json({ message: `Type must be one of: ${COMPLIANCE_TYPES.join(', ')}` });
    }
    if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
      return res.status(400).json({ message: 'Expiry date (YYYY-MM-DD) is required' });
    }
    if (issueDate && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      return res.status(400).json({ message: 'Issue date must be YYYY-MM-DD' });
    }
    if (renewedDate && !/^\d{4}-\d{2}-\d{2}$/.test(renewedDate)) {
      return res.status(400).json({ message: 'Renewed date must be YYYY-MM-DD' });
    }

    let filename = null;
    let mime = null;
    let bytes = null;
    let size = null;
    if (file && (file.filename || file.data)) {
      try {
        const v = validateDocument({
          docType: type,
          filename: file.filename,
          mime: file.mime,
          data: file.data,
        });
        filename = file.filename;
        mime = file.mime;
        bytes = v.bytes;
        size = v.size;
      } catch (e) {
        return res.status(e.status || 400).json({ message: e.message });
      }
    }

    const { rows } = await query(
      `INSERT INTO compliance_documents
         (title, doc_type, issuer, license_no, filename, mime, size_bytes, data,
          issue_date, renewed_date, expiry_date, notes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, title, doc_type, issuer, license_no, filename, mime, size_bytes,
                 issue_date, renewed_date, expiry_date, notes, created_at, updated_at`,
      [
        String(title).trim(), type, issuer || null, licenseNo || null,
        filename, mime, size, bytes,
        issueDate || null, renewedDate || issueDate || null, expiryDate,
        notes || null, req.user.id,
      ]
    );
    audit(req, 'compliance.created', 'compliance', rows[0].id, { title, type, expiryDate });
    res.status(201).json(withDerived(rows[0]));
  })
);

// Download the stored licence file.
router.get(
  '/:id/download',
  requirePerm('compliance.read'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM compliance_documents WHERE id = $1', [req.params.id]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ message: 'Document not found' });
    if (!doc.data) return res.status(404).json({ message: 'No file attached' });
    res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.filename || `compliance-${doc.id}`}"`);
    res.send(doc.data);
  })
);

// Renew / edit: new dates + optional replacement file. Resets the reminder clock.
router.patch(
  '/:id',
  requirePerm('compliance.manage'),
  asyncHandler(async (req, res) => {
    const cur = await query('SELECT * FROM compliance_documents WHERE id = $1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ message: 'Document not found' });
    const { title, docType, issuer, licenseNo, issueDate, renewedDate, expiryDate, notes, file } = req.body || {};

    let filename = cur.rows[0].filename;
    let mime = cur.rows[0].mime;
    let bytes = cur.rows[0].data;
    let size = cur.rows[0].size_bytes;
    if (file && (file.filename || file.data)) {
      try {
        const v = validateDocument({ docType: docType || cur.rows[0].doc_type, filename: file.filename, mime: file.mime, data: file.data });
        filename = file.filename;
        mime = file.mime;
        bytes = v.bytes;
        size = v.size;
      } catch (e) {
        return res.status(e.status || 400).json({ message: e.message });
      }
    }

    const { rows } = await query(
      `UPDATE compliance_documents SET
         title = COALESCE($1, title), doc_type = COALESCE($2, doc_type),
         issuer = COALESCE($3, issuer), license_no = COALESCE($4, license_no),
         filename = $5, mime = $6, size_bytes = $7, data = $8,
         issue_date = COALESCE($9, issue_date), renewed_date = COALESCE($10, renewed_date),
         expiry_date = COALESCE($11, expiry_date), notes = COALESCE($12, notes),
         last_reminded_at = CASE WHEN $11 IS NOT NULL THEN NULL ELSE last_reminded_at END,
         updated_at = NOW()
       WHERE id = $13
       RETURNING id, title, doc_type, issuer, license_no, filename, mime, size_bytes,
                 issue_date, renewed_date, expiry_date, notes, created_at, updated_at`,
      [
        title || null, docType ? String(docType).toLowerCase() : null, issuer || null,
        licenseNo || null, filename, mime, size, bytes,
        issueDate || null, renewedDate || null, expiryDate || null, notes || null,
        req.params.id,
      ]
    );
    audit(req, 'compliance.renewed', 'compliance', rows[0].id, { title: rows[0].title, expiryDate: rows[0].expiry_date });
    res.json(withDerived(rows[0]));
  })
);

router.delete(
  '/:id',
  requirePerm('compliance.manage'),
  asyncHandler(async (req, res) => {
    const { rows } = await query('DELETE FROM compliance_documents WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ message: 'Document not found' });
    audit(req, 'compliance.deleted', 'compliance', req.params.id, {});
    res.json({ ok: true });
  })
);

export default router;
