import {
  createPaymentLink as flwLink,
  verifyTransactionById as flwVerifyId,
  verifyTransactionByRef as flwVerifyRef,
  createTransfer as flwTransfer,
  getTransfer as flwGetTransfer,
  listBanks as flwBanks,
  resolveAccount as flwResolve,
  createVirtualAccount as flwVA,
} from './flutterwave.js';

// L4 provider adapters: every money rail implements this shape.
// Routes NEVER import a rail client directly — they use getProvider().
// Adding MFB/CBS/bank #2 = one object here + one settlement account,
// zero route changes.
//
// Adapter contract:
//   name, settlementAccount (ledger code), currency
//   createPaymentLink, verifyTransaction({ id, ref }), createTransfer,
//   getTransfer, listBanks, resolveAccount, createVirtualAccount
//   verifyWebhook(req) -> { ok, event, data }
//   fetchStatement({ from, to }) -> normalized lines (or throws NotImplemented)

export function notImplemented(rail, method) {
  const err = new Error(`${rail}: ${method} not implemented`);
  err.status = 501;
  throw err;
}

const flutterwave = {
  name: 'flutterwave',
  settlementAccount: '1002',
  currency: 'NGN',
  createPaymentLink: flwLink,
  verifyTransaction: ({ id, ref }) => (id ? flwVerifyId(id) : flwVerifyRef(ref)),
  verifyTransactionById: flwVerifyId,
  verifyTransactionByRef: flwVerifyRef,
  createTransfer: flwTransfer,
  getTransfer: flwGetTransfer,
  listBanks: flwBanks,
  resolveAccount: flwResolve,
  createVirtualAccount: flwVA,
  // A credit is valid only if successful, right currency, amount covered.
  isCreditValid: (data, intent, currency = 'NGN') =>
    !!data &&
    data.status === 'successful' &&
    (data.currency || '').toUpperCase() === currency &&
    Number(data.amount) >= Number(intent.amount),
  async verifyWebhook(req) {
    const configured = process.env.FLW_WEBHOOK_HASH;
    if (configured && req.headers['verif-hash'] !== configured) {
      return { ok: false, reason: 'bad signature' };
    }
    const { event, data } = req.body || {};
    return { ok: true, event, data };
  },
  async fetchStatement() {
    return notImplemented('flutterwave', 'fetchStatement — import the provider CSV via the Reconcile console instead');
  },
};

// MFB / bank CBS rail — wire on their API docs. Expected config:
//   MFB_BASE_URL, MFB_API_KEY (or OAuth client id/secret), MFB_SETTLEMENT_ACCOUNT,
//   MFB_WEBHOOK_SECRET. Settlement ledger account: seed e.g. code 1003
//   ('Settlement Float – <MFB>') and set settlementAccount below.
const mfb = {
  name: 'mfb',
  settlementAccount: '1003',
  currency: 'NGN',
  createPaymentLink: async () => notImplemented('mfb', 'createPaymentLink'),
  verifyTransaction: async () => notImplemented('mfb', 'verifyTransaction'),
  verifyTransactionById: async () => notImplemented('mfb', 'verifyTransactionById'),
  verifyTransactionByRef: async () => notImplemented('mfb', 'verifyTransactionByRef'),
  createTransfer: async () => notImplemented('mfb', 'createTransfer'),
  getTransfer: async () => notImplemented('mfb', 'getTransfer'),
  listBanks: async () => notImplemented('mfb', 'listBanks'),
  resolveAccount: async () => notImplemented('mfb', 'resolveAccount'),
  createVirtualAccount: async () => notImplemented('mfb', 'createVirtualAccount'),
  isCreditValid: () => false,
  async verifyWebhook() {
    return { ok: false, reason: 'mfb rail not configured' };
  },
  async fetchStatement() {
    return notImplemented('mfb', 'fetchStatement');
  },
};

const REGISTRY = { flutterwave, mfb };

export function getProvider(name) {
  const key = (name || process.env.DEFAULT_RAIL || 'flutterwave').toLowerCase();
  const adapter = REGISTRY[key];
  if (!adapter) throw new Error(`Unknown money rail: ${key}`);
  return adapter;
}

export function providerNames() {
  return Object.keys(REGISTRY);
}
