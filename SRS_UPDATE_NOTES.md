# SRS Update Notes — PlainCo

What changed in the system and therefore needs changing in the SRS.
Organised by the SRS section it affects. Written to be pasted or
paraphrased into the document.

Companion files: [ROLES.md](ROLES.md) (full detail),
[SRS_AUDIT.md](SRS_AUDIT.md) (what was out of sync, and what's now fixed).

---

## 1. User characteristics / Scope — THREE roles, not two

The single "admin" role has been split into two **non-overlapping** roles.
Neither is a superset of the other; they are siblings, not a hierarchy.

| Stored value | Called | Can do | Cannot do |
|---|---|---|---|
| `customer` (or field absent) | Customer | Browse, order, favourite, submit support requests | Reach any staff screen |
| `seller` | **Store Manager** | Products, orders, support requests | Read or modify user accounts |
| `platformAdmin` | **Platform Admin** | User accounts: grant roles, activate/deactivate | Products, orders, support |

Suggested wording:

> PlainCo defines three user roles. Customers browse and purchase. Store
> Managers operate the shop — products, orders, and support requests.
> Platform Admins manage user accounts and roles. The two staff roles are
> deliberately non-overlapping: a Store Manager has no access to user
> accounts, and a Platform Admin has no access to store data. This
> separation is enforced by Cloud Firestore security rules, not merely by
> hiding screens in the interface.

Anywhere the SRS says "admin", decide which of the two it means and say
that instead. The word "admin" alone is now ambiguous.

---

## 2. Authentication — one staff login, role-based routing

- Staff sign in through a single **Staff Portal**. The account's role
  decides the destination: Store Manager → dashboard, Platform Admin →
  Manage Users.
- The customer login **rejects staff accounts** and redirects them to the
  Staff Portal.
- Deactivated accounts (`isActive: false`) are refused at staff sign-in.

---

## 3. Staff account provisioning — NEW, previously undocumented

The SRS never stated where staff accounts come from. It should.

> Staff accounts are **granted, never self-registered.** There is no staff
> signup. A prospective staff member registers as an ordinary customer,
> and an existing Platform Admin then assigns them the Store Manager or
> Platform Admin role from the Manage Users screen.
>
> This is enforced, not conventional: security rules forbid the `role` and
> `isActive` fields from being set when a user document is created, so no
> account can be registered with a privileged role at any value. The only
> code path that can write `role` is a Platform Admin's update, and that
> path cannot target the Platform Admin's own document.
>
> The first Platform Admin is established by hand in the Firebase console.
> This is a one-time act and the system's root of trust, in the same way
> the first administrator of any permission system is created
> out-of-band.

Why there is no "create account" form, if asked: a client application
cannot create another person's Firebase Auth account —
`createUserWithEmailAndPassword` signs the *caller* in as the new user.
Doing it on someone's behalf requires the Firebase Admin SDK running
server-side, which this project does not use. Promotion also has a
security advantage: the staff member sets and owns their own password, so
it is never known to or transmitted by the Platform Admin.

---

## 4. Security — data type enforcement is now real (SRS Security, p.29)

The SRS already claims "strict data type enforcement on the backend."
Previously the only type check in the rules was the numeric comparison
guarding the checkout stock decrement. It is now implemented across every
writable collection:

- **`users` create** — exact key allowlist, string types, length caps,
  `uid` bound to the authenticated caller, and `role`/`isActive` excluded
  entirely.
- **`products` create** — exact key allowlist, types, non-empty name,
  non-negative price and stock, list types for colours and sizes,
  server-set `createdAt`. **Updates** are validated against the resulting
  document.
- **`supportRequests` create** — exact key allowlist, non-empty message
  capped at 2000 characters, `status` forced to `open`. Staff updates are
  confined to the `status` field only.
- **Activity log collections** — see section 5.

**Recommended qualification to add**, because it is more accurate than the
current claim:

> Type and length enforcement bounds what can be stored but does not
> sanitise markup. The cross-site scripting risk described here is a
> web-application concern that does not transfer directly to React Native:
> text is rendered through `<Text>` components, which never interpret
> HTML, so stored markup has no execution path in this application.

---

## 5. Audit functions — now implemented (SRS Constraint 2.4.5)

The SRS asks for logs of user activities (product updates and order
transactions) to help store managers monitor operations. Previously no
such logging existed. It now does, in two collections split along the
same line as the roles:

| Collection | Written by | Records | Readable by |
|---|---|---|---|
| `activityLogs` | Store Manager | Product create / edit / delete, order status changes | Store Manager |
| `accountLogs` | Platform Admin | Role grants, account activation / deactivation | Platform Admin |

Both are surfaced in a single Activity screen that selects its collection
from the signed-in role. Store Managers open it from a dashboard tile;
Platform Admins from Manage Users.

Security rules enforce four properties on every entry:

1. **Append-only** — creation is the only permitted write, for every role.
   No entry can be edited or deleted, including by its own author.
2. **Truthful attribution** — the recorded actor must be the
   authenticated caller.
3. **Honest timestamps** — the timestamp must be the server's, so entries
   cannot be back- or post-dated.
4. **Fixed shape** — exactly seven fields, with length caps.

**State this limitation explicitly in the SRS:**

> Log entries are written by the client immediately after the action they
> describe. Security rules can guarantee that an entry is well-formed,
> correctly attributed, and never altered, but cannot compel a modified
> client to write one. This is therefore an operational activity log for
> monitoring, as this document specifies, and not a tamper-proof audit
> trail for dispute resolution. Producing the latter would require
> server-side database triggers.

---

## 6. Account deactivation — add the sole-admin consideration

Existing behaviour is unchanged: accounts are deactivated
(`isActive: false`), never deleted, so completed sales remain auditable
(SRS §2.4). Worth adding:

> Because only a Platform Admin can restore an account, the last active
> Platform Admin is a single point of failure: if that account is lost,
> account management cannot be recovered from within the application.
> Security rules prevent a Platform Admin from deactivating themselves
> through the Manage Users screen, and the interface warns whenever only
> one active Platform Admin exists. **The operational requirement is to
> maintain at least two active Platform Admin accounts.**

---

## 7. New screen to add to the module list

**Activity Log screen** — one screen serving both staff roles, showing
each its own log (Store Activity or Account Activity). Includes search and
a chronological list with actor and timestamp.

---

## 8. Verification — worth a short section if the SRS has one

The security rules have an automated test suite: **47 tests** run against
the Firestore emulator via `npm run test:rules`. Coverage includes
privilege escalation attempts, role separation in both directions, field
validation, checkout stock rules, and audit log integrity. Notable cases:

- A signup cannot set a privileged role.
- A customer cannot promote themselves or anyone else.
- A Store Manager cannot read user accounts.
- A Platform Admin cannot modify products or read orders.
- Log entries cannot be forged, backdated, edited, or deleted.

---

## 9. Still outstanding — SRS-side only, no code changes needed

From [SRS_AUDIT.md](SRS_AUDIT.md). Category A (things the SRS promised
that the app didn't do) is now empty. These remain, and are all
documentation gaps:

**Category B — the app does it, the SRS doesn't mention it**
- Password reset by email (a full flow exists; the SRS documents only
  registration and login/logout).
- A Store Manager can set an order status of "Cancelled". Note that
  cancelling does **not** restore decremented stock — the SRS should say
  which behaviour is intended.
- The Help screen offers four contact channels, a common-issues picker,
  an app-share action, and published support hours, beyond the
  "searchable FAQ" the SRS describes.

**Category C — both mention it, but describe it differently**
- Signup postcondition: the SRS says the user is redirected to the login
  page; the app signs them in and goes to Home, because account creation
  authenticates them automatically.
- "Out of Stock notification": the app disables the Add to Cart button
  and shows a badge rather than displaying a message.
- "Invalid Quantity" error: quantity is a stepper with a disabled
  decrement, so zero or negative input is structurally impossible and the
  error branch the SRS describes cannot occur.
- Order status vocabulary differs between the staff view (five statuses)
  and the customer view (pending and processing collapsed into one).

Note also that the SRS's own audit report keeps the *original* findings
alongside the resolutions, so the historical text describes the system as
it was, not as it is.
