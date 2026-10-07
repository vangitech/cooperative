import express from 'express';
import { query, withTransaction } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, generateRef, isPositiveNumber, toMoney } from '../utils/helpers.js';
import {
  createPaymentLink,
  verifyTransactionById,
  verifyTransactionByRef,
  createTransfer,
  getTransfer,
  listBanks,
  resolveAccount,
} from '../lib/flutterwave.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { settleDueCollections } from '../lib/collections.js';

const router = express.Router();

const CURRENCY = 'NGN';
const MIN_AMOUNT = 100; // minimum funding / withdrawal in NGN

const callbackUrl = () => process.env.FUND_CALLBACK_URL || 'http://localhost:5173/payment/callback';

// Credit a verified funding intent exactly once (idempotent).
// Must be called inside withTransaction; locks the intent row first.
// flw = verification data ({ id, flw_ref }) used for idempotency + records.
async function creditFundIntent(client, intentId, flw) {
  const locked = await client.query('SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE', [intentId]);
  const intent = locked.rows[0];
  if (!intent) throw new Error('Payment intent not found');

  if (intent.status === 'successful') {
    const tx = await client.query('SELECT * FROM transactions WHERE reference = $1', [intent.tx_ref]);
    const w = await client.query('SELECT balance FROM wallets WHERE id = $1', [intent.wallet_id]);
    return { already: true, transaction: tx.rows[0], balance: w.rows[0] ? Number(w.rows[0].balance) : null };
  }

  const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [intent.user_id]);
  if (!w.rows[0]) throw new Error('Wallet not found');

  const amt = toMoney(intent.amount);
  const newBalance = toMoney(Number(w.rows[0].balance) + amt);
  await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
    newBalance, w.rows[0].id,
  ]);
  const flwRef = flw?.flw_ref || intent.tx_ref;
  const flwId = flw?.id ? String(flw.id) : null;
  const tx = await client.query(
    `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description, flw_id)
     VALUES ($1,$2,'deposit',$3,$4,$5,$6,$7) RETURNING *`,
    [intent.user_id, w.rows[0].id, amt, newBalance, intent.tx_ref, `Flutterwave funding (${flwRef})`, flwId]
  );
  await client.query(
    `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
    [intent.user_id, 'Wallet funded', `${amt} NGN added via Flutterwave`, '/wallet']
  );
  await client.query(`UPDATE payment_intents SET status = 'successful', updated_at = NOW() WHERE id = $1`, [
    intent.id,
  ]);
  if (flw?.id) {
    await client.query(`UPDATE payment_intents SET flw_id = $1 WHERE id = $2`, [String(flw.id), intent.id]);
  }
  return { already: false, transaction: tx.rows[0], balance: newBalance };
}

// Credit a bank transfer received on a member's virtual funding account.
// Idempotent via the Flutterwave transaction id.
async function creditVirtualAccount(client, userId, flw, accountNumber) {
  const flwId = String(flw.id);
  const dup = await client.query('SELECT id FROM transactions WHERE flw_id = $1', [flwId]);
  if (dup.rows[0]) return { already: true };

  const amt = toMoney(flw.amount);
  if (!(amt > 0)) throw new Error('Invalid amount');
  const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
  if (!w.rows[0]) throw new Error('Wallet not found');

  const newBalance = toMoney(Number(w.rows[0].balance) + amt);
  await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
    newBalance, w.rows[0].id,
  ]);
  const tx = await client.query(
    `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description, flw_id)
     VALUES ($1,$2,'deposit',$3,$4,$5,$6,$7) RETURNING *`,
    [userId, w.rows[0].id, amt, newBalance, generateRef('VAB'), `Bank transfer to ${accountNumber}`, flwId]
  );
  await client.query(
    `INSERT INTO notifications (user_id, title, body, link) VALUES ($1,$2,$3,$4)`,
    [userId, 'Wallet funded', `${amt} NGN received via bank transfer`, '/wallet']
  );
  return { already: false, transaction: tx.rows[0], balance: newBalance };
}

// Refund a pending withdrawal intent (transfer failed at Flutterwave).
async function refundWithdrawIntent(client, intentId, reason) {
  const locked = await client.query('SELECT * FROM payment_intents WHERE id = $1 FOR UPDATE', [intentId]);
  const intent = locked.rows[0];
  if (!intent) throw new Error('Payment intent not found');
  if (intent.status !== 'pending') return intent;

  const amt = toMoney(intent.amount);
  const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [intent.user_id]);
  if (!w.rows[0]) throw new Error('Wallet not found');
  const newBalance = toMoney(Number(w.rows[0].balance) + amt);
  await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2', [
    newBalance, w.rows[0].id,
  ]);
  await client.query(
    `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
     VALUES ($1,$2,'refund',$3,$4,$5,$6)`,
    [intent.user_id, w.rows[0].id, amt, newBalance, `${intent.tx_ref}-R`, reason || 'Withdrawal refund']
  );
  const r = await client.query(
    `UPDATE payment_intents SET status = 'failed', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [intent.id]
  );
  return r.rows[0];
}

const flwOk = (data, intent) =>
  data &&
  data.status === 'successful' &&
  (data.currency || '').toUpperCase() === CURRENCY &&
  Number(data.amount) >= Number(intent.amount);

/* ---------- Fund wallet (inflow) ---------- */

// Step 1: create a payment link the member pays through.
router.post(
  '/fund/initiate',
  authenticate,
  asyncHandler(async (req, res) => {
    const { amount } = req.body;
    if (!isPositiveNumber(amount) || Number(amount) < MIN_AMOUNT)
      return res.status(400).json({ message: `Minimum funding amount is ${MIN_AMOUNT} ${CURRENCY}` });

    const w = await query('SELECT id FROM wallets WHERE user_id = $1', [req.user.id]);
    if (!w.rows[0]) return res.status(400).json({ message: 'Wallet not found' });

    const txRef = generateRef('FLW-FND');
    await query(
      `INSERT INTO payment_intents (user_id, wallet_id, kind, tx_ref, amount, currency)
       VALUES ($1,$2,'fund',$3,$4,$5)`,
      [req.user.id, w.rows[0].id, txRef, toMoney(amount), CURRENCY]
    );

    const name = `${req.user.first_name} ${req.user.last_name}`.trim();
    const flw = await createPaymentLink({
      txRef,
      amount: toMoney(amount),
      currency: CURRENCY,
      email: req.user.email,
      name,
      redirectUrl: callbackUrl(),
    });

    await query('UPDATE payment_intents SET flw_id = $1, meta = $2 WHERE tx_ref = $3', [
      flw.data?.id ? String(flw.data.id) : null,
      JSON.stringify({ link: flw.data?.link || null }),
      txRef,
    ]);

    res.status(201).json({ txRef, link: flw.data?.link });
  })
);

// Step 2: verify after redirect (also called by the webhook path below).
router.get(
  '/fund/verify',
  authenticate,
  asyncHandler(async (req, res) => {
    const { txRef } = req.query;
    if (!txRef) return res.status(400).json({ message: 'txRef is required' });

    const found = await query(
      `SELECT * FROM payment_intents WHERE tx_ref = $1 AND user_id = $2 AND kind = 'fund'`,
      [txRef, req.user.id]
    );
    const intent = found.rows[0];
    if (!intent) return res.status(404).json({ message: 'Payment not found' });
    if (intent.status === 'successful') {
      const tx = await query('SELECT * FROM transactions WHERE reference = $1', [intent.tx_ref]);
      return res.json({ verified: true, already: true, transaction: tx.rows[0] });
    }

    let verification;
    try {
      verification = await verifyTransactionByRef(txRef);
    } catch (e) {
      return res.status(502).json({ verified: false, message: `Verification failed: ${e.message}` });
    }

    if (!flwOk(verification.data, intent)) {
      return res.json({ verified: false, status: verification.data?.status || 'unknown' });
    }

    const result = await withTransaction((client) =>
      creditFundIntent(client, intent.id, verification.data)
    );
    audit(req, 'wallet.funded_online', 'payment_intent', intent.id, {
      txRef, amount: Number(intent.amount),
    });
    await settleDueCollections(withTransaction, intent.user_id);
    res.json({ verified: true, ...result });
  })
);

/* ---------- Withdraw to bank (outflow) ---------- */

router.get(
  '/banks',
  authenticate,
  asyncHandler(async (req, res) => {
    const country = (req.query.country || 'NG').toString().toUpperCase();
    const flw = await listBanks(country);
    res.json(flw.data || []);
  })
);

// Resolve an account number to the holder's name (called automatically
// once the member picks a bank with a complete account number).
router.get(
  '/resolve-account',
  authenticate,
  asyncHandler(async (req, res) => {
    const accountNumber = String(req.query.accountNumber || '');
    const bankCode = String(req.query.bankCode || '');
    if (!/^\d{10}$/.test(accountNumber))
      return res.status(400).json({ message: 'A 10-digit NUBAN account number is required' });
    if (!bankCode) return res.status(400).json({ message: 'Bank is required' });

    let flw;
    try {
      flw = await resolveAccount(accountNumber, bankCode);
    } catch (e) {
      return res.status(502).json({ message: `Could not resolve account: ${e.message}` });
    }
    if (!flw.data?.account_name)
      return res.status(404).json({ message: 'Account name not found for this bank' });
    res.json({ accountNumber, bankCode, accountName: flw.data.account_name });
  })
);

router.post(
  '/withdraw/initiate',
  authenticate,
  asyncHandler(async (req, res) => {
    const { amount, accountNumber, bankCode, accountName } = req.body;
    if (!isPositiveNumber(amount) || Number(amount) < MIN_AMOUNT)
      return res.status(400).json({ message: `Minimum withdrawal is ${MIN_AMOUNT} ${CURRENCY}` });
    if (!/^\d{10}$/.test(String(accountNumber || '')))
      return res.status(400).json({ message: 'A 10-digit NUBAN account number is required' });
    if (!bankCode) return res.status(400).json({ message: 'Bank is required' });

    const amt = toMoney(amount);
    const txRef = generateRef('FLW-WDR');

    // Debit first (reserve the funds), then attempt the transfer.
    let intent;
    try {
      intent = await withTransaction(async (client) => {
        const w = await client.query('SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
        if (!w.rows[0]) throw new Error('Wallet not found');
        if (Number(w.rows[0].balance) < amt) throw new Error('Insufficient wallet balance');

        const newBalance = toMoney(Number(w.rows[0].balance) - amt);
        await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [
          newBalance, req.user.id,
        ]);
        await client.query(
          `INSERT INTO transactions (user_id, wallet_id, type, amount, balance_after, reference, description)
           VALUES ($1,$2,'withdrawal',$3,$4,$5,$6)`,
          [req.user.id, w.rows[0].id, amt, newBalance, txRef, `Bank withdrawal to ${accountNumber}`]
        );
        const r = await client.query(
          `INSERT INTO payment_intents (user_id, wallet_id, kind, tx_ref, amount, currency, meta)
           VALUES ($1,$2,'withdraw',$3,$4,$5,$6) RETURNING *`,
          [req.user.id, w.rows[0].id, txRef, amt, CURRENCY, JSON.stringify({ accountNumber, bankCode, accountName: accountName || null })]
        );
        return r.rows[0];
      });
    } catch (e) {
      return res.status(400).json({ message: e.message });
    }

    let transfer;
    try {
      transfer = await createTransfer({
        reference: txRef,
        amount: amt,
        currency: CURRENCY,
        bankCode,
        accountNumber: String(accountNumber),
        narration: `MPCS withdrawal ${txRef}`,
      });
    } catch (e) {
      await withTransaction((client) => refundWithdrawIntent(client, intent.id, `Transfer failed: ${e.message}`));
      return res.status(502).json({ message: `Transfer failed and amount was refunded: ${e.message}` });
    }

    await query('UPDATE payment_intents SET flw_id = $1, meta = meta || $2 WHERE id = $3', [
      transfer.data?.id ? String(transfer.data.id) : null,
      JSON.stringify({ transferStatus: transfer.data?.status || null }),
      intent.id,
    ]);

    audit(req, 'wallet.withdraw_bank', 'payment_intent', intent.id, {
      reference: txRef, amount: amt,
    });
    notify(req.user.id, {
      title: 'Withdrawal submitted',
      body: `${amt} NGN payout to ${accountNumber} is being processed.`,
      link: '/wallet',
    });
    res.status(201).json({
      reference: txRef,
      transferId: transfer.data?.id || null,
      status: transfer.data?.status || 'pending',
    });
  })
);

// Member's own payment intents (funding/withdrawal history + pending states).
router.get(
  '/intents',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, kind, tx_ref, amount, currency, status, created_at
       FROM payment_intents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  })
);

// Reconcile a pending withdrawal against Flutterwave (for when the
// webhook hasn't fired, e.g. no public URL in dev). Refunds if failed.
router.get(
  '/withdraw/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const { txRef } = req.query;
    if (!txRef) return res.status(400).json({ message: 'txRef is required' });

    const found = await query(
      `SELECT * FROM payment_intents WHERE tx_ref = $1 AND user_id = $2 AND kind = 'withdraw'`,
      [txRef, req.user.id]
    );
    const intent = found.rows[0];
    if (!intent) return res.status(404).json({ message: 'Withdrawal not found' });
    if (intent.status !== 'pending' || !intent.flw_id) return res.json({ status: intent.status });

    let transfer;
    try {
      transfer = await getTransfer(intent.flw_id);
    } catch (e) {
      return res.status(502).json({ status: intent.status, message: `Status check failed: ${e.message}` });
    }

    const flwStatus = (transfer.data?.status || '').toUpperCase();
    if (flwStatus === 'SUCCESSFUL') {
      await query(`UPDATE payment_intents SET status = 'successful', updated_at = NOW() WHERE id = $1`, [
        intent.id,
      ]);
      return res.json({ status: 'successful' });
    }
    if (flwStatus === 'FAILED') {
      await withTransaction((client) =>
        refundWithdrawIntent(client, intent.id, `Transfer failed: ${transfer.data?.complete_message || ''}`)
      );
      return res.json({ status: 'failed', refunded: true });
    }
    res.json({ status: intent.status, transferStatus: transfer.data?.status });
  })
);

/* ---------- Flutterwave webhook (public — verified by signature) ---------- */

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const configured = process.env.FLW_WEBHOOK_HASH;
    if (configured) {
      if (req.headers['verif-hash'] !== configured)
        return res.status(401).json({ message: 'Invalid webhook signature' });
    } else {
      console.warn('⚠️  FLW_WEBHOOK_HASH not set — accepting unsigned webhook (dev only)');
    }

    const { event, data } = req.body || {};

    try {
      if ((event === 'charge.completed' && data?.tx_ref) || event === 'virtual_account.credited') {
        const found = data?.tx_ref
          ? await query(
              `SELECT * FROM payment_intents WHERE tx_ref = $1 AND kind = 'fund' AND status = 'pending'`,
              [data.tx_ref]
            )
          : { rows: [] };
        const intent = found.rows[0];
        if (intent) {
          // Never trust the webhook body alone — re-verify with Flutterwave.
          const verification = await verifyTransactionById(data.id);
          if (flwOk(verification.data, intent)) {
            await withTransaction((client) =>
              creditFundIntent(client, intent.id, verification.data)
            );
            audit(
              { user: { id: intent.user_id }, ip: req.ip },
              'wallet.funded_online', 'payment_intent', intent.id,
              { txRef: intent.tx_ref, via: 'webhook' }
            );
          }
        } else {
          // Bank transfer straight into a member's virtual funding account:
          // match our creation tx_ref first, then the account number itself.
          const va = await query(
            `SELECT * FROM virtual_accounts WHERE tx_ref = $1 OR account_number = $2`,
            [data?.tx_ref || '', data?.account_number || '']
          );
          const account = va.rows[0];
          if (account && data?.id) {
            const verification = await verifyTransactionById(data.id);
            const v = verification.data || {};
            if (
              v.status === 'successful' &&
              (v.currency || '').toUpperCase() === 'NGN' &&
              Number(v.amount) > 0
            ) {
              const result = await withTransaction((client) =>
                creditVirtualAccount(client, account.user_id, v, account.account_number)
              );
              if (!result.already) {
                audit(
                  { user: { id: account.user_id }, ip: req.ip },
                  'wallet.funded_account', 'virtual_account', account.id,
                  { amount: Number(v.amount), via: 'webhook' }
                );
                await settleDueCollections(withTransaction, account.user_id);
              }
            }
          }
        }
      } else if (event === 'transfer.completed' && data?.reference) {
        const found = await query(
          `SELECT * FROM payment_intents WHERE tx_ref = $1 AND kind = 'withdraw' AND status = 'pending'`,
          [data.reference]
        );
        const intent = found.rows[0];
        if (intent) {
          if ((data.status || '').toUpperCase() === 'SUCCESSFUL') {
            await query(`UPDATE payment_intents SET status = 'successful', updated_at = NOW() WHERE id = $1`, [
              intent.id,
            ]);
          } else {
            await withTransaction((client) =>
              refundWithdrawIntent(client, intent.id, `Transfer ${data.status || 'failed'}: ${data.complete_message || ''}`)
            );
          }
        }
      }
    } catch (e) {
      console.error('Webhook processing failed (will retry):', e.message);
      return res.status(500).json({ message: 'Retry later' });
    }

    res.json({ received: true });
  })
);

export default router;
