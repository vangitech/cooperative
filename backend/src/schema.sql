CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone      VARCHAR(30),
  address    TEXT,
  role       VARCHAR(20) NOT NULL DEFAULT 'member',
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type VARCHAR(40) NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  balance_after NUMERIC(15,2) NOT NULL,
  reference VARCHAR(80) UNIQUE NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  savings_type VARCHAR(30) NOT NULL DEFAULT 'daily',
  note TEXT,
  savings_date DATE NOT NULL DEFAULT CURRENT_DATE,
  transaction_id INTEGER REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  interest_rate NUMERIC(5,2) NOT NULL DEFAULT 10,
  duration_months INTEGER NOT NULL,
  purpose TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  total_repayable NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_repayments (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  transaction_id INTEGER REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dividends (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  period VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  transaction_id INTEGER REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_savings_user ON savings(user_id, savings_date DESC);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dividends_user ON dividends(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_intents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  kind VARCHAR(20) NOT NULL, -- 'fund' | 'withdraw'
  tx_ref VARCHAR(100) UNIQUE NOT NULL,
  flw_id VARCHAR(100),
  amount NUMERIC(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|successful|failed
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intents_user ON payment_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intents_txref ON payment_intents(tx_ref);

CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resets_token ON password_resets(token_hash);

CREATE TABLE IF NOT EXISTS kyc_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  dob DATE,
  gender VARCHAR(20),
  occupation VARCHAR(120),
  employer VARCHAR(160),
  id_type VARCHAR(40), -- nin | drivers_license | voters_card | passport
  id_number VARCHAR(80),
  residential_address TEXT,
  next_of_kin_name VARCHAR(160),
  next_of_kin_phone VARCHAR(30),
  next_of_kin_relationship VARCHAR(60),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guarantors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(255),
  relationship VARCHAR(60),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|confirmed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, phone)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(40),
  entity_id VARCHAR(80),
  metadata JSONB,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS loan_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) UNIQUE NOT NULL,
  description TEXT,
  interest_rate NUMERIC(5,2) NOT NULL, -- flat annual %
  penalty_rate NUMERIC(5,2) NOT NULL DEFAULT 5, -- one-time % of overdue installment
  min_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_amount NUMERIC(15,2),
  min_duration_months INTEGER NOT NULL DEFAULT 1,
  max_duration_months INTEGER NOT NULL DEFAULT 12,
  required_savings_multiple NUMERIC(5,2) NOT NULL DEFAULT 0, -- must have saved >= amount * multiple
  min_membership_months INTEGER NOT NULL DEFAULT 0,
  requires_guarantors BOOLEAN NOT NULL DEFAULT false,
  guarantor_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active|archived
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO loan_products
  (name, description, interest_rate, min_amount, max_amount, min_duration_months, max_duration_months,
   required_savings_multiple, min_membership_months, requires_guarantors, guarantor_count)
VALUES
  ('Emergency Loan', 'Quick cash for urgent needs', 5, 1000, 100000, 1, 3, 0.5, 1, false, 0),
  ('Business Loan', 'Grow your trade or business', 10, 10000, 1000000, 3, 12, 0.3, 3, true, 1),
  ('Asset Loan', 'Equipment and household assets', 12, 50000, 2000000, 6, 24, 0.5, 6, true, 2)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS loan_schedules (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  due_number INTEGER NOT NULL,
  due_date DATE NOT NULL,
  amount_due NUMERIC(15,2) NOT NULL,
  amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0,
  penalty_applied BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(loan_id, due_number)
);

CREATE TABLE IF NOT EXISTS deposit_rates (
  id SERIAL PRIMARY KEY,
  tenure_months INTEGER UNIQUE NOT NULL,
  annual_rate NUMERIC(5,2) NOT NULL,
  min_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO deposit_rates (tenure_months, annual_rate, min_amount) VALUES
  (3, 8, 5000), (6, 10, 5000), (12, 12, 10000)
ON CONFLICT (tenure_months) DO NOTHING;

CREATE TABLE IF NOT EXISTS fixed_deposits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  tenure_months INTEGER NOT NULL,
  annual_rate NUMERIC(5,2) NOT NULL,
  expected_payout NUMERIC(15,2) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matures_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active|matured|broken
  transaction_id INTEGER REFERENCES transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  body TEXT,
  link VARCHAR(255),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  audience VARCHAR(20) NOT NULL DEFAULT 'all', -- all|members|staff
  published_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS savings_plans (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 28),
  savings_type VARCHAR(30) NOT NULL DEFAULT 'monthly',
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active|paused|cancelled
  last_run TIMESTAMPTZ,
  next_run DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_due ON savings_plans(status, next_run);

CREATE TABLE IF NOT EXISTS store_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(40) NOT NULL, -- farm | electronics | groceries
  description TEXT,
  price NUMERIC(15,2) NOT NULL,
  image_url TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  min_down_pct NUMERIC(5,2) NOT NULL DEFAULT 20,
  max_months INTEGER NOT NULL DEFAULT 6,
  markup_pct NUMERIC(5,2) NOT NULL DEFAULT 5, -- flat % on financed balance, prorated
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active|archived
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO store_products (name, category, description, price, stock, min_down_pct, max_months, markup_pct) VALUES
  ('Rice 50kg Bag', 'groceries', 'Premium long-grain rice', 85000, 20, 20, 6, 5),
  ('Yam Tubers (20 pcs)', 'farm', 'Fresh farm yam, bulk pack', 30000, 20, 20, 3, 5),
  ('Fertilizer 50kg', 'farm', 'NPK fertilizer for the season', 45000, 20, 20, 6, 5),
  ('Smartphone', 'electronics', 'Android smartphone, 128GB', 150000, 10, 30, 12, 8),
  ('Laptop', 'electronics', 'Work-ready laptop, 8GB RAM', 350000, 5, 30, 12, 8),
  ('Cooking Oil 5L', 'groceries', 'Vegetable cooking oil', 18000, 30, 20, 3, 5)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS collections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES store_products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL,
  down_payment NUMERIC(15,2) NOT NULL DEFAULT 0,
  financed NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_repayable NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0,
  penalty_accrued NUMERIC(15,2) NOT NULL DEFAULT 0,
  duration_months INTEGER NOT NULL,
  auto_debit BOOLEAN NOT NULL DEFAULT true,
  penalty_rate NUMERIC(5,2) NOT NULL DEFAULT 5, -- one-time % of overdue installment
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|collected|completed|rejected|cancelled
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_schedules (
  id SERIAL PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  due_number INTEGER NOT NULL,
  due_date DATE NOT NULL,
  amount_due NUMERIC(15,2) NOT NULL,
  amount_paid NUMERIC(15,2) NOT NULL DEFAULT 0,
  penalty_applied BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(collection_id, due_number)
);

ALTER TABLE loans ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES loan_products(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS penalty_accrued NUMERIC(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS virtual_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  account_number VARCHAR(20) UNIQUE NOT NULL,
  bank_name VARCHAR(120) NOT NULL,
  flw_ref VARCHAR(100),
  tx_ref VARCHAR(100) UNIQUE NOT NULL,
  is_permanent BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS flw_id VARCHAR(120) UNIQUE;

-- Security hardening: backend uses postgres via DATABASE_URL (bypasses RLS).
-- Frontend must go through Express API, never direct Supabase REST.
-- No policies = default deny for anon/authenticated.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','wallets','transactions','savings','loans','loan_repayments',
    'loan_schedules','dividends','payment_intents','password_resets',
    'kyc_profiles','guarantors','audit_logs','loan_products','deposit_rates',
    'fixed_deposits','notifications','announcements','savings_plans',
    'store_products','collections','collection_schedules','virtual_accounts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
  REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
END $$;

-- Priority 1 (update v1.md): audit trail goes append-only with richer context.
-- `before_state`/`after_state` (not before/after — reserved words) hold JSONB
-- snapshots for money fields; `outcome` distinguishes success vs failure.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_role VARCHAR(20);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_state JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_state JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'web';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outcome VARCHAR(20) NOT NULL DEFAULT 'success';
CREATE INDEX IF NOT EXISTS idx_audit_outcome ON audit_logs(outcome);
-- Belt-and-braces (RLS + REVOKE ALL above already deny these): the audit log
-- must be insert-only for every human-held role, even if grants change later.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM anon, authenticated;

-- Onboarding + affiliation: organisations (branches, employers, departments,
-- units, trade associations, markets), member numbering, KYC document vault.
CREATE TABLE IF NOT EXISTS organisations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'cooperative_branch',
  parent_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  contact_name VARCHAR(160),
  contact_phone VARCHAR(30),
  address TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organisation_members (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  member_no VARCHAR(40) UNIQUE NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, org_id)
);

CREATE TABLE IF NOT EXISTS org_counters (
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, year)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS member_no VARCHAR(40) UNIQUE;

ALTER TABLE kyc_profiles ADD COLUMN IF NOT EXISTS id_document_url TEXT;
ALTER TABLE kyc_profiles ADD COLUMN IF NOT EXISTS verification_result JSONB;
ALTER TABLE kyc_profiles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS kyc_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type VARCHAR(40) NOT NULL DEFAULT 'id_card',
  filename VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL,
  data BYTEA NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docs_user ON kyc_documents(user_id);

-- Default catch-all organisation for general (unaffiliated) members.
INSERT INTO organisations (name, code, type, status)
VALUES ('General Members', 'GEN', 'general', 'active')
ON CONFLICT (code) DO NOTHING;

-- Same lockdown as the core tables (this block runs after creation).
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organisations FROM anon, authenticated;
REVOKE ALL ON TABLE public.organisation_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.org_counters FROM anon, authenticated;
REVOKE ALL ON TABLE public.kyc_documents FROM anon, authenticated;

-- L1 ledger: double-entry journal under the wallet ledger.
-- One header per movement (+ N lines, so L2 splits need no schema change).
-- source_transaction_id is UNIQUE: retries/webhook replays can never double-post.
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(160) NOT NULL,
  type VARCHAR(20) NOT NULL,
  provider VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS journal_entry_seq START 100001;

CREATE TABLE IF NOT EXISTS journal_entries (
  id SERIAL PRIMARY KEY,
  entry_no VARCHAR(20) UNIQUE NOT NULL DEFAULT ('JE-' || nextval('journal_entry_seq')),
  period VARCHAR(7) NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_transaction_id INTEGER UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  org_id INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(20),
  channel VARCHAR(20) NOT NULL DEFAULT 'web',
  narration TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_period ON journal_entries(period);
CREATE INDEX IF NOT EXISTS idx_journal_source ON journal_entries(source_transaction_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS idx_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);

INSERT INTO accounts (code, name, type, provider) VALUES
  ('1001', 'Settlement Float – General', 'asset', NULL),
  ('1002', 'Settlement Float – Flutterwave', 'asset', 'flutterwave'),
  ('1003', 'Settlement Float – MFB (pending rail config)', 'asset', 'mfb'),
  ('1100', 'Member Wallets Control', 'asset', NULL),
  ('1200', 'Loans Receivable', 'asset', NULL),
  ('1210', 'Store Receivables', 'asset', NULL),
  ('2001', 'Member Savings Payable', 'liability', NULL),
  ('2002', 'Dividends Payable', 'liability', NULL),
  ('2003', 'Fixed Deposits Payable', 'liability', NULL),
  ('3001', 'Opening Balance Equity', 'equity', NULL),
  ('4001', 'Loan Interest Income', 'income', NULL),
  ('4002', 'Penalty & Fee Income', 'income', NULL),
  ('4003', 'Store Markup Income', 'income', NULL),
  ('5001', 'Operating Expenses', 'expense', NULL)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.accounts FROM anon, authenticated;
REVOKE ALL ON TABLE public.journal_entries FROM anon, authenticated;
REVOKE ALL ON TABLE public.journal_lines FROM anon, authenticated;

-- L2: member balances are what the coop OWES: control is a liability.
UPDATE accounts SET type = 'liability' WHERE code = '1100';

INSERT INTO accounts (code, name, type, provider) VALUES
  ('3002', 'Surplus Distribution – Dividends', 'equity', NULL),
  ('5002', 'Interest Expense – Fixed Deposits', 'expense', NULL)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_of INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT;

-- Maker-checker adjustments: officers/accountants propose, admins approve.
-- Approval posts the lines atomically; rejection leaves books untouched.
CREATE TABLE IF NOT EXISTS adjustments (
  id SERIAL PRIMARY KEY,
  lines JSONB NOT NULL,
  reason TEXT NOT NULL,
  period VARCHAR(7),
  reversal_of INTEGER REFERENCES journal_entries(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  proposed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- Locked accounting periods: postJournal refuses these (L2).
CREATE TABLE IF NOT EXISTS close_periods (
  period VARCHAR(7) PRIMARY KEY,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.close_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.adjustments FROM anon, authenticated;
REVOKE ALL ON TABLE public.close_periods FROM anon, authenticated;

-- L3 reconciliation: run history + suspense queue (never auto-adjusted).
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id SERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'web',
  checks JSONB NOT NULL,
  passed BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recon_time ON reconciliation_runs(run_at DESC);

CREATE TABLE IF NOT EXISTS suspense_items (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(40) NOT NULL,
  period VARCHAR(7),
  expected NUMERIC(15,2) NOT NULL DEFAULT 0,
  actual NUMERIC(15,2) NOT NULL DEFAULT 0,
  detail JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_suspense_status ON suspense_items(status, created_at DESC);

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suspense_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reconciliation_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.suspense_items FROM anon, authenticated;

-- D1 dividend guards: maker-checker columns + one declaration per member/period.
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE dividends ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dividends_period_user_unique') THEN
    ALTER TABLE dividends ADD CONSTRAINT dividends_period_user_unique UNIQUE (period, user_id);
  END IF;
END $$;