import { Bytid } from '@uverifyng/node';

// Bytid identity adapter (test/sandbox + live-ready).
// Key comes from DEFAULT_SANDBOX_KEY (sandbox) — swap to a live key via
// BYTID_API_KEY without code changes when going live (see key()).
// Everything stays server-side: the key never reaches the frontend.

const METHOD = {
  nin: 'nin',
  bvn: 'bvn',
  drivers_license: 'driversLicense',
  voters_card: 'votersCard',
};

let client = null;

function key() {
  return process.env.BYTID_API_KEY || process.env.DEFAULT_SANDBOX_KEY || '';
}

export function bytidConfigured() {
  return key().length > 0;
}

export function bytidMode() {
  const k = key();
  if (!k) return 'off';
  return k.startsWith('uvk_live_') ? 'live' : 'sandbox';
}

function getClient() {
  if (!client) client = new Bytid({ apiKey: key(), timeoutMs: 15000, maxRetries: 1 });
  return client;
}

function maskId(idNumber) {
  const s = String(idNumber || '');
  if (s.length <= 4) return '****';
  return `${s.slice(0, 3)}*****${s.slice(-3)}`;
}

// Registry lookup for one ID. Never throws — errors come back as data.
// { checked, status: verified|not_found|mismatch|error|skipped,
//   fieldMatches, record (masked), code, detail }
export async function verifyIdentity({ type, idNumber, firstName, lastName }) {
  const method = METHOD[type];
  if (!method) return { checked: false, status: 'skipped', detail: `unsupported type ${type}` };
  if (!bytidConfigured()) return { checked: false, status: 'skipped', detail: 'no API key' };
  if (!idNumber) return { checked: false, status: 'skipped', detail: 'no ID number' };

  const run = (async () => {
    const res = await getClient().identity[method]({
      id_number: String(idNumber).trim(),
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
    });
    const fm = res.field_matches || {};
    const nameOk = fm.first_name !== false && fm.last_name !== false;
    const dobOk = fm.date_of_birth !== false;
    const status =
      res.status === 'verified' ? (nameOk && dobOk ? 'verified' : 'mismatch') : res.status || 'error';
    return {
      checked: true,
      status,
      fieldMatches: fm,
      record: res.data
        ? {
            full_name: res.data.full_name,
            date_of_birth: res.data.date_of_birth,
            id_number: maskId(idNumber),
          }
        : null,
      detail: `registry: ${res.status}`,
    };
  })();

  // Hard ceiling so a hung provider can never stall onboarding.
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve({ checked: true, status: 'error', code: 'timeout', detail: 'provider timeout' }), 20000)
  );
  try {
    return await Promise.race([run, timeout]);
  } catch (e) {
    return { checked: true, status: 'error', code: e?.code || 'provider_error', detail: e?.message || 'lookup failed' };
  }
}
