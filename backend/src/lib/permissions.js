// Staff permission model. `super_admin` is the SOLE full-rights role ('*')
// and the only role that can staff admins / assign roles (staff.manage).
// `admin` keeps broad operational rights but can no longer grant roles.
// Loan maker-checker stages (distinct actors, enforced in routes):
//   loans.grantor_approve → grantor (of borrower's org) / super_admin
//   loans.verify_kyc     → officer (account officer) / admin / super_admin
//   loans.disburse       → accountant / super_admin
//   (officer = account officer; accountant = payment approver)
export const ROLE_PERMS = {
  super_admin: ['*'],
  admin: [
    'overview.read',
    'members.read',
    'members.create',
    'members.review',
    'loans.read',
    'loans.verify_kyc',
    'loans.disburse',
    'kyc.review',
    'store.review',
    'orgs.read',
    'orgs.manage',
    'adjustments.propose',
    'adjustments.approve',
    'announcements.manage',
    'reports.read',
    'audit.read',
    'books.reconcile',
    'transactions.read',
    'savings.read',
    'dividends.manage',
    'fund',
    'exports',
    'compliance.read',
    'compliance.manage',
  ],
  officer: [
    'overview.read',
    'members.read',
    'members.create',
    'members.review',
    'loans.read',
    'loans.verify_kyc',
    'kyc.review',
    'store.review',
    'orgs.read',
    'orgs.manage',
    'adjustments.propose',
    'announcements.manage',
    'reports.read',
    'audit.read',
    'compliance.read',
    'compliance.manage',
  ],
  accountant: [
    'overview.read',
    'members.read',
    'transactions.read',
    'savings.read',
    'loans.read',
    'loans.disburse',
    'dividends.manage',
    'orgs.read',
    'adjustments.propose',
    'books.reconcile',
    'reports.read',
    'fund',
    'exports',
    'audit.read',
    'compliance.read',
    'compliance.manage',
  ],
  grantor: [
    'overview.read',
    'members.read',
    'loans.read',
    'loans.grantor_approve',
    'orgs.read',
    'reports.read',
    'audit.read',
  ],
  member: [],
};

export const STAFF_ROLES = ['super_admin', 'admin', 'officer', 'accountant', 'grantor'];
export const ALL_ROLES = ['member', 'grantor', 'officer', 'accountant', 'admin', 'super_admin'];

// Only super_admin holds these (checked explicitly in routes as well).
export const SUPER_ONLY_PERMS = ['staff.manage'];

export function hasPerm(role, perm) {
  if (perm === 'staff.manage') return role === 'super_admin';
  const perms = ROLE_PERMS[role] || [];
  return perms.includes('*') || perms.includes(perm);
}
