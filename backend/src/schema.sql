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