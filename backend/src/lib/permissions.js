// Staff permission model. `admin` is the super-role (all powers).
// officer  → front-office: members, lending, KYC, store, notices
// accountant → back-office: books, payouts, dividends, exports
export const ROLE_PERMS = {
  admin: ['*'],
  officer: [
    'overview.read',
    'members.read',
    'members.review',
    'loans.read',
    'loans.review',
    'kyc.review',
    'store.review',
    'announcements.manage',
    'audit.read',
  ],
  accountant: [
    'overview.read',
    'members.read',
    'transactions.read',
    'savings.read',
    'loans.read',
    'dividends.manage',
    'fund',
    'exports',
    'audit.read',
  ],
  member: [],
};

export const STAFF_ROLES = ['admin', 'officer', 'accountant'];
export const ALL_ROLES = ['member', 'officer', 'accountant', 'admin'];

export function hasPerm(role, perm) {
  const perms = ROLE_PERMS[role] || [];
  return perms.includes('*') || perms.includes(perm);
}
