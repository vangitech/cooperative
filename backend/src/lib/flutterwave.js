// Minimal Flutterwave v3 client (direct HTTPS, no SDK).
// Docs: https://developer.flutterwave.com
// Requires FLW_SECRET_KEY. All money-crediting decisions must be based on
// server-side verification (verify endpoints), never on client input.

const BASE = 'https://api.flutterwave.com/v3';

function secret() {
  const key = process.env.FLW_SECRET_KEY;
  if (!key) throw new Error('FLW_SECRET_KEY is not set');
  return key;
}

export async function flwRequest(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Flutterwave request failed (${res.status})`);
  }
  return data;
}

// Create a Standard payment link the member pays through.
export const createPaymentLink = ({ txRef, amount, currency, email, name, redirectUrl }) =>
  flwRequest('POST', '/payments', {
    tx_ref: txRef,
    amount,
    currency,
    redirect_url: redirectUrl,
    customer: { email, name },
    customizations: { title: 'MPCS Wallet Funding', description: `Wallet funding ${txRef}` },
  });

// Verify a completed charge by Flutterwave transaction id.
export const verifyTransactionById = (id) => flwRequest('GET', `/transactions/${id}/verify`);

// Verify a completed charge by our own reference.
export const verifyTransactionByRef = (txRef) =>
  flwRequest('GET', `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);

// Create a bank transfer (withdrawal payout).
export const createTransfer = ({ reference, amount, currency, bankCode, accountNumber, narration }) =>
  flwRequest('POST', '/transfers', {
    account_bank: bankCode,
    account_number: accountNumber,
    amount,
    currency,
    reference,
    narration: narration || 'MPCS wallet withdrawal',
    debit_currency: currency,
  });

// Fetch a transfer's status.
export const getTransfer = (id) => flwRequest('GET', `/transfers/${id}`);

// Bank list for a country (e.g. 'NG') — used for the withdrawal form.
export const listBanks = (country = 'NG') => flwRequest('GET', `/banks/${country}`);

// Resolve a NUBAN account number to the holder's name at a given bank.
export const resolveAccount = (accountNumber, bankCode) =>
  flwRequest('POST', '/accounts/resolve', {
    account_number: accountNumber,
    account_bank: bankCode,
  });

// Create a static (permanent) virtual account for wallet funding.
// Static NGN accounts require BVN or NIN in live mode; test mode is lenient.
export const createVirtualAccount = ({ email, txRef, firstname, lastname, phonenumber, narration, bvn, nin }) => {
  const body = {
    email,
    tx_ref: txRef,
    firstname,
    lastname,
    narration: narration || `MPCS wallet for ${firstname} ${lastname}`.slice(0, 60),
    is_permanent: true,
  };
  if (phonenumber) body.phonenumber = phonenumber;
  if (bvn) body.bvn = bvn;
  else if (nin) body.nin = nin;
  return flwRequest('POST', '/virtual-account-numbers', body);
};
