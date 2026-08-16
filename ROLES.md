# Roles & Staff Account Provisioning — PlainCo

PlainCo has **three roles**. They are stored as the `role` field on
`users/{uid}` and matched literally by `firestore.rules`, so the stored
values never change; only their display labels do (see
[constants/roles.js](constants/roles.js)).

| Stored value | Shown as | Can do | Cannot do |
|---|---|---|---|
| *(absent)* / `customer` | Customer | Browse, order, favorite, send support requests | Reach any staff screen |
| `seller` | **Store Manager** | Products, orders, support requests | Read or modify user accounts |
| `platformAdmin` | **Platform Admin** | User accounts: change roles, activate/deactivate | Touch products, orders, or support |

The two privileged roles are **siblings, not a hierarchy**. Neither is a
superset of the other — a Store Manager cannot read `/users`, and a
Platform Admin cannot read `/products` writes or any order. This split
exists because a single combined "admin" role conflated two unrelated
jobs and read as one confusing permission set.

## Where the boundary is actually enforced

1. **`firestore.rules`** — the real boundary. `isSeller()` and
   `isPlatformAdmin()` are separate predicates; no rule grants both.
2. **`withAdminGuard`** ([components/withAdminGuard.js](components/withAdminGuard.js))
   — a UI guard only. Each admin screen names the exact role allowed, in
   [App.js](App.js). It stops the wrong screen from rendering; it is not
   what stops the data from being read.
3. **`AdminContext`** ([context/AdminContext.jsx](context/AdminContext.jsx))
   — re-verifies role and `isActive` against Firestore on every cold start.
   Never trusts a cached or client-supplied role.

## How staff accounts are created

**There is no staff signup, deliberately.** If anyone could register as a
Store Manager or Platform Admin, the role system would be decorative — a
stranger could grant themselves access, and every restriction above would
be bypassable by choosing the right option on a signup form.

Two things enforce that:

- `firestore.rules` constrains `users/{userId}` **create** to an allowlist
  of keys that deliberately excludes `role` and `isActive`. They cannot be
  set at document-creation time, at any value, by anyone. A brand-new
  account is therefore always an ordinary customer.
- The only rule branch that can write `role` is the platformAdmin update
  branch, and it cannot target the requester's own document — so a
  Platform Admin can neither promote themselves nor demote themselves into
  locking the role out of existence.

### The actual flow

1. The new staff member **signs up in the app like any customer**.
2. A **Platform Admin** opens Manage Users and finds their account.
3. **Edit User → Role → Store Manager** (or Platform Admin) → Save.

The person-add button in the Manage Users header explains these three
steps in-app, so the flow isn't folklore.

Access is **granted, never self-registered**. Controlling who holds which
role is the Platform Admin's entire purpose.

### Why there's no "Create Account" button

A client app cannot create another person's Firebase Auth account.
`createUserWithEmailAndPassword` signs *the caller* in as the newly
created user, which would drop the Platform Admin's own session. Creating
accounts on someone else's behalf requires the Firebase Admin SDK running
server-side (a Cloud Function), which this project does not use — there is
no `functions/` directory and no `firebase-admin` dependency.

Promoting an existing account achieves the same result with no server, and
has a security advantage besides: the staff member sets and owns their own
password, so it is never known to, or transmitted by, the Platform Admin.

## Bootstrapping the first Platform Admin

There is an unavoidable chicken-and-egg: granting `platformAdmin` requires
an existing `platformAdmin`. **The first one is set by hand in the Firebase
console** — sign up normally, then edit that `users/{uid}` document and add
`role: "platformAdmin"`.

This is the system's root of trust, and it is a one-time act. Every staff
account after the first is granted in-app through the flow above. (This is
the same bootstrap every permission system has — the first root account is
always established out-of-band.)

## Deactivation, not deletion

No `delete` rule exists for user documents, for any role. SRS §2.4
requires accounts to be **deactivated** (`isActive: false`), not deleted,
so completed sales tied to that account stay auditable. Deactivation
blocks staff sign-in at [AdminLoginScreen](screens/admin/AdminLoginScreen.js)
as well as hiding the account, so it is a real revocation and not just a
list filter.
