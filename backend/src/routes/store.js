import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { generateRef, isPositiveNumber, toMoney, asyncHandler } from '../utils/helpers.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import {
  ensureCollectionSchedules,
  assessCollectionPenalties,
  allocateCollectionPayment,
  collectionOutstanding,
  settleDueCollections,
} from '../lib/collections.js';

const router = express.Router();

/* ---------- Catalog (members) ---------- */

router.get(
  '/products',
  authenticate,
  asyncHandler(async (req, res) => {
    const { category } = req.query;
    const params = [];
    let where = `WHERE status = 'active' AND stock > 0`;
    if (category) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }
    const { rows } = await query(`SELECT * FROM store_products ${where} ORDER BY category, price`, params);
    res.json(rows);
  })
);

// Request to collect: POST /api/store/request { productId, quantity, durationMonths, autoDebit }
router.post(
  '/request',
  authenticate,
  asyncHandler(async (req, res) => {
    try {
      const { productId, quantity, durationMonths, autoDebit } = req.body;
      const qty = Number(quantity) || 1;
      if (qty < 1) return res.status(400).json({ message: 'Invalid quantity' });

      const p = await query(`SELECT * FROM store_products WHERE id = $1 AND status = 'active'`, [productId]);
      const product = p.rows[0];
      if (!product) return res.status(400).json({ message: 'Product not available' });
      if (Number(product.stock) < qty)
        return res.status(400).json({ message: `Only ${product.stock} in stock` });

      const months = Number(durationMonths);
      if (!months || months < 1 || months > Number(product.max_months))
        return res.status(400).json({ message: `Plan must be 1–${product.max_months} months for this item` });

      const gross = toMoney(Number(product.price) * qty);
      const down = toMoney((gross * Number(product.min_down_pct)) / 100);
      const financed = toMoney(gross - down);
      const total = toMoney(down + financed * (1 + (Number(product.markup_pct) / 100) * (months / 12)));

      const { rows } = await query(
        `INSERT INTO collections
           (user_id, product_id, quantity, unit_price, down_payment, financed,
            total_repayable, duration_months, auto_debit, penalty_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,5) RETURNING *`,
        [req.user.id, product.id, qty, product.price, down, financed, total, months, autoDebit !== false]
      );
      audit(req, 'store.requested', 'collection', rows[0].id, { product: product.name, total });
      res.status(201).json({ ...rows[0], outstanding: collectionOutstanding(rows[0]) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: 'Server error' });
    }
  })
);

// My collections with live outstanding.
router.get(
  '/mine',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT c.*, p.name AS product_name, p.category
       FROM collections c LEFT JOIN store_products p ON p.id = c.product_id
       WHERE c.user_id = $1 ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map((c) => ({ ...c, outstanding: collectionOutstanding(c) })));
  })
);

// Schedule detail.
router.get(
  '/collections/:id/schedule',
  authenticate,
  asyncHandler(async (req, res) => {
    const found = await query('SELECT * FROM collections WHERE id = $1 AND user_id = $2', [
      req.params.id, req.user.id,
    ]);
    const collection = found.rows[0];
    if (!collection) return res.status(404).json({ message: 'Not found' });

    await withTransaction(async (client) => {
      await ensureCollectionSchedules(client, collection);
      const fresh = await client.query('SELECT * FROM collections WHERE id = $1', [collection.id]);
      await assessCollectionPenalties(client, fresh.rows[0]);
    });

    const { rows } = await query(
      `SELECT *, CASE WHEN due_date < CURRENT_DATE AND amount_paid < amount_due THEN true ELSE false END AS overdue
       FROM collection_schedules WHERE collection_id = $1 ORDER BY due_number`,
      [collection.id]
    );
    const updated = await query('SELECT * FROM collections WHERE id = $1', [collection.id]);
    res.json({
      collection: { ...updated.rows[0], outstanding: collectionOutstanding(updated.rows[0]) },
      schedule: rows,
    });
  })
);

// Manual installment payment from wallet.
router.post(
  '/collections/:id/repay',
  authenticate,
  asyncHandler(async (req, res) => {
    const { amount } = req.body;
    if (!isPositiveNumber(amount)) return res.status(400).json({ message: 'Invalid amount' });
    const amt = toMoney(amount);

    try {
      const result = await withTransaction(async (client) => {
        const f = await client.query(
          'SELECT * FROM collections WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [req.params.id, req.user.id]
        );
        const c = f.rows[0];
        if (!c) throw new Error('Not found');
        if (c.status !== 'collected') throw new Error('Collection is not active');

        await ensureCollectionSchedules(client, c);
        await assessCollectionPenalties(client, c);

        const outstanding = collectionOutstanding(c);
        if (amt > outstanding) throw new Error(`Amount exceeds outstanding balance of ${outstanding}`);

        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
        if (Number(w.rows[0].balance) < amt) throw new Error('Insufficient wallet balance');

        const newBalance = toMoney(Number(w.rows[0].balance) - amt);
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
          newBalance, req.user.id,
        ]);
        const tx = await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'collection_repayment',$3,$4,$5,$6) RETURNING *`,
          [req.user.id, w.rows[0].id, amt, newBalance, generateRef('CLP'), `Collection #${c.id} repayment`]
        );

        await allocateCollectionPayment(client, c.id, amt);
        const newPaid = toMoney(Number(c.amount_paid) + amt);
        const left = toMoney(Number(c.total_repayable) + Number(c.penalty_accrued || 0) - newPaid);
        await client.query('UPDATE collections SET amount_paid = $1, status = $2 WHERE id = $3', [
          newPaid, left <= 0 ? 'completed' : 'collected', c.id,
        ]);
        return { transaction: tx.rows[0], amountPaid: newPaid, balance: newBalance };
      });
      audit(req, 'store.repaid', 'collection', req.params.id, { amount: amt });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  })
);

// Toggle auto-debit consent.
router.patch(
  '/collections/:id/auto-debit',
  authenticate,
  asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    const { rows } = await query(
      `UPDATE collections SET auto_debit = $1 WHERE id = $2 AND user_id = $3 AND status = 'collected' RETURNING *`,
      [!!enabled, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Active collection not found' });
    res.json(rows[0]);
  })
);

/* ---------- Admin ---------- */

router.get(
  '/requests',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE c.status = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT c.*, p.name AS product_name, p.category, u.first_name, u.last_name, u.email
       FROM collections c
       LEFT JOIN store_products p ON p.id = c.product_id
       JOIN users u ON u.id = c.user_id
       ${where} ORDER BY c.created_at DESC LIMIT 300`,
      params
    );
    res.json(rows.map((c) => ({ ...c, outstanding: collectionOutstanding(c) })));
  })
);

// Approve & release (deducts down payment, decrements stock, builds schedule)
// or reject a pending request.
router.patch(
  '/requests/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status, note } = req.body;
    if (!['approved', 'rejected'].includes(status))
      return res.status(400).json({ message: 'Status must be approved or rejected' });

    try {
      const result = await withTransaction(async (client) => {
        const f = await client.query('SELECT * FROM collections WHERE id = $1 FOR UPDATE', [req.params.id]);
        const c = f.rows[0];
        if (!c) throw new Error('Request not found');
        if (c.status !== 'pending') throw new Error('Request already reviewed');

        if (status === 'rejected') {
          const r = await client.query(
            `UPDATE collections SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
             WHERE id = $3 RETURNING *`,
            [req.user.id, note || null, c.id]
          );
          return r.rows[0];
        }

        const p = await client.query('SELECT * FROM store_products WHERE id = $1 FOR UPDATE', [c.product_id]);
        const product = p.rows[0];
        if (!product || product.status !== 'active') throw new Error('Product no longer available');
        if (Number(product.stock) < Number(c.quantity)) throw new Error('Insufficient stock');

        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [c.user_id]);
        const down = toMoney(c.down_payment);
        if (Number(w.rows[0].balance) < down)
          throw new Error(`Member wallet lacks the ${down} down payment — ask them to fund first`);

        const newBalance = toMoney(Number(w.rows[0].balance) - down);
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
          newBalance, w.rows[0].id,
        ]);
        await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'collection_down',$3,$4,$5,$6)`,
          [c.user_id, w.rows[0].id, down, newBalance, generateRef('CLD'), `Down payment: collection #${c.id}`]
        );
        await client.query('UPDATE store_products SET stock = stock - $1 WHERE id = $2', [
          c.quantity, c.product_id,
        ]);
        const r = await client.query(
          `UPDATE collections SET status = 'collected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2
           WHERE id = $3 RETURNING *`,
          [req.user.id, note || null, c.id]
        );
        await ensureCollectionSchedules(client, r.rows[0]);
        return r.rows[0];
      });

      audit(req, `store.${status}`, 'collection', result.id, { amount: Number(result.total_repayable) });
      notify(result.user_id, status === 'approved'
        ? { title: 'Collection approved', body: 'Your item is ready for pickup. The down payment was deducted.', link: '/market' }
        : { title: 'Collection request update', body: 'Your request was not approved. Contact support for details.', link: '/market' });
      res.json(result);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  })
);

// Catalog management.
router.get(
  '/admin-products',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query('SELECT * FROM store_products ORDER BY category, price');
    res.json(rows);
  })
);

router.post(
  '/admin-products',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { name, category, description, price, stock, minDownPct, maxMonths, markupPct } = req.body;
    if (!name || !category || !isPositiveNumber(price))
      return res.status(400).json({ message: 'Name, category and price are required' });
    const { rows } = await query(
      `INSERT INTO store_products (name, category, description, price, stock, min_down_pct, max_months, markup_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, category, description || null, toMoney(price), Number(stock) || 0,
       minDownPct ?? 20, maxMonths ?? 6, markupPct ?? 5]
    );
    audit(req, 'store.product_created', 'store_product', rows[0].id, { name });
    res.status(201).json(rows[0]);
  })
);

router.patch(
  '/admin-products/:id',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const allowed = ['name', 'category', 'description', 'price', 'stock', 'min_down_pct', 'max_months', 'markup_pct', 'status'];
    const sets = [];
    const params = [];
    for (const key of allowed) {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const val = req.body[key] !== undefined ? req.body[key] : req.body[camel];
      if (val !== undefined) {
        params.push(val);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ message: 'Nothing to update' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE store_products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ message: 'Product not found' });
    audit(req, 'store.product_updated', 'store_product', rows[0].id, { name: rows[0].name });
    res.json(rows[0]);
  })
);

export default router;
