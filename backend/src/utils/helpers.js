export const generateRef = (prefix = 'TXN') =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export const toMoney = (v) => Math.round(Number(v) * 100) / 100;

export const isPositiveNumber = (v) =>
  v !== undefined && v !== null && !isNaN(v) && Number(v) > 0;

// CSV download helper: sets headers and sends rows (arrays) as CSV.
export function sendCsv(res, filename, headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join('\n')}`);
}

// Wraps async route handlers so rejected promises reach Express'
// error middleware instead of hanging the request (Express 4).
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);