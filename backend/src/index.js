import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import authRoutes from './routes/auth.js';
import walletRoutes from './routes/wallet.js';
import savingsRoutes from './routes/savings.js';
import loanRoutes from './routes/loans.js';
import dividendRoutes from './routes/dividends.js';
import adminRoutes from './routes/admin.js';
import paymentsRoutes from './routes/payments.js';
import kycRoutes from './routes/kyc.js';
import fixedRoutes from './routes/fixed.js';
import notificationRoutes from './routes/notifications.js';

for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1); // correct req.ip behind Vercel / proxies

app.use(cors({ origin: process.env.CLIENT_URL?.split(',') || '*' }));
app.use(express.json());

app.get('/api/health', (_, res) => res.json({ ok: true, service: 'MPCS API' }));

app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/savings', savingsRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/dividends', dividendRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/fixed', fixedRoutes);
app.use('/api/notifications', notificationRoutes);

// 404
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`🚀 MPCS API running on http://localhost:${PORT}`));
}

export default app;