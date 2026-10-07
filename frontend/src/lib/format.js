export const formatCurrency = (v, currency = 'NGN') => {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `₦${n.toLocaleString()}`;
  }
};

export const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const formatDateTime = (d) => (d ? new Date(d).toLocaleString() : '—');

export const initials = (f = '', l = '') => `${f[0] || ''}${l[0] || ''}`.toUpperCase();