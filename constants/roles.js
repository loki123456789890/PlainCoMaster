// constants/roles.js
//
// Single source of truth for how the three PlainCo roles are NAMED and
// DESCRIBED in the UI. The stored values ('customer', 'seller',
// 'platformAdmin') are load-bearing — firestore.rules matches them
// literally — so they are never renamed. Only the labels below are
// user-facing, and they exist because "admin" used to mean two different
// jobs at once and read as one confusing role.
//
// The two privileged roles are siblings, not a hierarchy: a Store Manager
// runs the shop and cannot touch accounts; a Platform Admin manages
// accounts and cannot touch the shop. Nothing in this file should imply
// one outranks the other.
export const ROLE_CUSTOMER = 'customer';
export const ROLE_SELLER = 'seller';
export const ROLE_PLATFORM_ADMIN = 'platformAdmin';

// Ordered least- to most-privileged for display only (the role picker in
// AdminUsersScreen renders them in this order). `capability` is written as
// one plain sentence a panelist can read aloud — it is the shortest honest
// answer to "what does this role actually do?", and it deliberately states
// what each privileged role CANNOT do, because that boundary is the whole
// point of the split.
export const ROLES = [
  {
    value: ROLE_CUSTOMER,
    label: 'Customer',
    capability: 'Shops, places orders, and sends support requests.',
  },
  {
    value: ROLE_SELLER,
    label: 'Store Manager',
    capability: 'Runs one store’s products, orders, and support. No access to user accounts.',
  },
  {
    value: ROLE_PLATFORM_ADMIN,
    label: 'Platform Admin',
    capability: 'Manages accounts, roles and stores, and answers general questions. No access to any store’s products or orders.',
  },
];

const ROLE_LABELS = ROLES.reduce((acc, role) => {
  acc[role.value] = role.label;
  return acc;
}, {});

// Falls back to the raw stored value rather than to a friendly default:
// if an unrecognized role ever reaches a badge, it should look obviously
// wrong to whoever is looking at it, not quietly render as "Customer".
export const getRoleLabel = (role) => ROLE_LABELS[role] || role;

// The name of the privileged area each role signs in to. Both roles share
// one login screen but land in different places, so the shared screen is
// "Staff Portal" and each destination names itself.
export const STAFF_PORTAL_LABEL = 'Staff Portal';

export const getPortalLabel = (role) => {
  if (role === ROLE_SELLER) return 'Store Manager';
  if (role === ROLE_PLATFORM_ADMIN) return 'Platform Admin';
  return STAFF_PORTAL_LABEL;
};

// The screen a signed-in account belongs on, by role.
//
// Written out inline in AdminLoginScreen until LandingScreen needed the
// same answer for a persisted session. Two copies of a role-to-route map
// is exactly the drift that justified constants/payment.js: adding a role,
// or renaming a route, would otherwise mean finding every copy and hoping.
//
// Note the asymmetry, which is deliberate rather than an oversight — a
// platformAdmin lands on AdminUsers because account management IS their
// job, while a seller lands on a dashboard that surveys several. There is
// no platformAdmin dashboard to send them to.
//
// Anything unrecognized — "customer", a missing role, a role invented
// later — goes to Home. Same fail-closed direction as
// resolvePrivilegedRole in AdminContext: an unknown role gets the
// unprivileged destination, never a guessed privileged one.
export const getHomeRouteForRole = (role) => {
  if (role === ROLE_PLATFORM_ADMIN) return 'AdminUsers';
  if (role === ROLE_SELLER) return 'AdminDashboard';
  return 'Home';
};
