# Roles & Staff Account Provisioning — PlainCo

PlainCo has **three roles**. They are stored as the `role` field on
`users/{uid}` and matched literally by `firestore.rules`, so the stored
values never change; only their display labels do (see
[constants/roles.js](constants/roles.js)).

| Stored value | Shown as | Can do | Cannot do |
|---|---|---|---|
| *(absent)* / `customer` | Customer | Browse, order, favorite, send support requests | Reach any staff screen |
| `seller` | **Store Manager** | Products, orders, support requests, review moderation | Read or modify user accounts |
| `platformAdmin` | **Platform Admin** | User accounts: change roles, activate/deactivate | Touch products, orders, or support |

The two privileged roles are **siblings, not a hierarchy**. Neither is a
superset of the other — a Store Manager cannot read `/users`, and a
Platform Admin cannot read `/products` writes or any order. This split
exists because a single combined "admin" role conflated two unrelated
jobs and read as one confusing permission set.

## Where the boundary is actually enforced

1. **`firestore.rules`** — the real boundary. `isSeller()` and
   `isPlatformAdmin()` are separate predicates; no rule grants both.
2. **`withRoleGuard`** ([components/withRoleGuard.js](components/withRoleGuard.js))
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
3. **Edit User → Role → Store Manager** (or Platform Admin).
4. For a Store Manager, **Store → pick one, or "Open a new store"** → Save.

### Stores (multi-store)

A Store Manager runs **one store**, named by `storeId` on their user
document. Every product carries the `storeId` of the store that listed it,
and `firestore.rules` lets a manager create, edit, restock or delete only
their own store's products (`managesStore()`).

- **Stores are opened by a Platform Admin**, in the same Edit User save
  that assigns the store's first manager — one batch, so there is never a
  store without the manager it was opened for. There is no vendor
  self-signup, for the same reason there is no staff signup.
- **A Store Manager must have a store.** Promoting someone to Store Manager
  without naming a store is refused, and demoting them clears it in the
  same write.
- **Stores can be renamed, never deleted.** Products and orders point at
  them by id.
- **Accounts and products from before stores existed** have no `storeId`,
  and the rules freeze them rather than guess an owner. The one-time
  `scripts/migrate-to-stores.mjs` assigns them to a store; it runs with
  the Admin SDK because giving an existing product a store is exactly the
  write the rules forbid clients to make.

A cart holding products from several stores checks out as **one order
per store** (`placeOrder`), and only that store's manager may move an
order's status or cancel it.

Still any-manager for now, until the admin screens are scoped: reading
orders, support requests, review moderation, and the activity and mail
logs. See TODO.md, "Multi-store".

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

## The sole-admin lockout, and what guards it

Granting `platformAdmin` requires an existing active `platformAdmin`. That
makes the **last active one a single point of failure**: if that account
becomes unusable, nothing inside the app can restore account management,
because no one else can set `isActive` back to `true` or grant the role.
Recovery means editing the document in the Firebase console.

### How the app currently prevents it

`firestore.rules` blocks the direct route: the platformAdmin update branch
cannot target the requester's own document, so an admin cannot demote or
deactivate themselves from Manage Users.

The **owner** branch does still permit self-deactivation from the Profile
screen — but a platform admin **cannot reach that screen**. No staff screen
navigates to Profile, and `Loginscreen` signs staff accounts out and sends
them to the Staff Portal, so there is no path from a privileged session
into the customer stack. (Before that redirect was fixed, staff *did* fall
through to the customer HomeScreen, which is why `Profilescreen` still
carries code for routing "a restored privileged session" to its portal.)

`Profilescreen` also refuses self-deactivation for the last active platform
admin, failing closed if the count can't be verified. **This check is
currently dormant** — it cannot be triggered, for the reason above. It is
kept as defence in depth: it costs nothing at runtime and would become
load-bearing again if anyone routes from the staff stack to Profile, or
makes a persisted session enter the app directly.

**Manage Users** shows a standing warning whenever the active platformAdmin
count is 1. This is the guard that actually does work today.

Both are **guardrails, not security boundaries** — rules cannot count
documents, so neither can be enforced server-side. That's acceptable
because they protect against a mistake rather than an attacker.

### The risk that remains

Screen-level guards can't help with the likeliest cause: **losing access to
the only admin's credentials or email.** Nothing in the app prevents that,
and recovery still means the Firebase console.

**So: keep at least two active Platform Admins.** That's the actual
mitigation; everything above only removes the ways to cause it by accident.

## Activity logging

SRS Constraint 2.4.5 ("Audit Functions") asks for logs of user activities
— product updates and order transactions — to help store managers monitor
operations. Two collections implement it, split along the same line as
the roles:

| Collection | Written by | Records | Read by |
|---|---|---|---|
| `activityLogs` | Store Manager | Product create/edit/delete, order status changes | Store Manager |
| `accountLogs` | Platform Admin | Role grants, account activate/deactivate | Platform Admin |

Both are reached from the same screen
([AdminActivityScreen](screens/admin/AdminActivityScreen.js)), which picks
its collection from the signed-in role. Store Managers open it from the
Activity tile on their dashboard; Platform Admins from the clock icon in
Manage Users.

**Why two collections rather than one with a `domain` field:** Firestore
rules cannot inspect a query's filters — a rule may only allow or deny a
read of the collection as a whole. A single log would therefore have to be
readable by both roles, which would let a Store Manager read account
history or a Platform Admin read store operations. Splitting the
collection keeps the log's read boundary identical to the role boundary.

Rules enforce four things on every entry:

1. **Append-only.** `create` is the only write verb allowed, for every
   role. Nobody can edit or delete an entry, including its author.
2. **Truthful attribution.** `actorId` must equal `request.auth.uid`, so
   an action cannot be logged under someone else's name.
3. **Honest timestamps.** `createdAt` must equal `request.time`, which
   forces `serverTimestamp()` and prevents back- or post-dating.
4. **A fixed shape.** Exactly seven fields, with length caps.

### Limitation, stated plainly

These entries are written **by the client**, immediately after the action
they describe. The rules can guarantee an entry is well-formed, correctly
attributed, and never altered — but they cannot force a modified client to
write one in the first place.

So this is an **operational activity log for monitoring**, which is what
the SRS asks for, and not a tamper-proof security audit trail. Making it
the latter requires writing entries server-side from a database trigger
(Cloud Functions), which this project does not use. If the log is ever
relied on for dispute resolution rather than monitoring, that is the
change to make.

## Deactivation, not deletion

No `delete` rule exists for user documents, for any role. SRS §2.4
requires accounts to be **deactivated** (`isActive: false`), not deleted,
so completed sales tied to that account stay auditable. Deactivation
blocks staff sign-in at [AdminLoginScreen](screens/admin/AdminLoginScreen.js)
as well as hiding the account, so it is a real revocation and not just a
list filter.
