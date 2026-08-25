// functions/mailer.js
//
// The one place that talks to an SMTP server, plus the brand shell every
// message is poured into.
//
// WHY EMAIL EXISTS IN THIS PROJECT AT ALL, since nothing else here sends
// any: HelpScreen tells a customer "Our support team will respond within
// 24 hours" the moment they submit a request. Nothing informed the store
// that a request had arrived. The promise was kept only if a Store Manager
// happened to open the admin support queue that day, which is not a
// pipeline — it is a hope. Order confirmations are the second case, and
// the more expected one: a receipt that survives outside the app, for an
// order the customer may well have placed on a borrowed phone.
//
// GMAIL, AND WHAT THAT COSTS. Sending goes through Gmail SMTP with an App
// Password rather than a transactional provider (Resend, SendGrid,
// Postmark). That was a deliberate trade: a real provider needs a verified
// domain before it will send to arbitrary recipients, and PlainCo does not
// own one. Gmail sends to anyone today. What it gives up:
//
//   - A ~500 recipient/day cap. Fine at this volume, a wall at scale.
//   - Deliverability. Mail from a gmail.com address on behalf of a shop
//     lands in Promotions or Spam more often than mail from an
//     authenticated domain with SPF/DKIM. Nothing in this file can fix
//     that; only owning a domain can.
//   - No bounce handling, no open tracking, no suppression list.
//
// Swapping providers later means rewriting sendMail() below and nothing
// else — that is the whole reason the transport is isolated here.
//
// CREDENTIALS live in Secret Manager, not in this repo and not in
// environment config, because an App Password is a password to a real
// mailbox. Set them once with:
//
//     firebase functions:secrets:set GMAIL_USER
//     firebase functions:secrets:set GMAIL_APP_PASSWORD
//
// GMAIL_APP_PASSWORD is NOT the account password. It is a 16-character App
// Password from Google Account -> Security -> 2-Step Verification -> App
// passwords, and 2-Step Verification must be switched on before that page
// exists at all.

const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');

// Every function that sends mail must declare both, or .value() throws at
// runtime. Exported as one array so a new sender cannot forget half of it.
const MAIL_SECRETS = [GMAIL_USER, GMAIL_APP_PASSWORD];

// The name on the From line. The address is whatever GMAIL_USER holds —
// Gmail refuses to send as any other address, so there is no point in
// making it configurable.
const FROM_NAME = 'PlainCo';

// Brand tokens, copied from constants/theme.ts rather than imported: that
// file is TypeScript in the app's ESM package, and functions/ is a
// separate CommonJS package with its own dependency tree. Keep in step by
// hand if the palette moves.
const INK = '#1C1B1A';
const CANVAS = '#FAF7F2';
const LINE = '#E8E1D5';
const ASH = '#6B655C';
const CLAY = '#C4623E';
const GOLD = '#846B1A';

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Matches formatOrderNumber in OrderConfirmationScreen.js and
// OrderDetailsScreen.js. A customer who reads this number off an email and
// then reads it off the app must see the same string, so this is the third
// copy of one line and the copies must not drift.
const formatOrderNumber = (id) => (id ? `#${String(id).slice(0, 8).toUpperCase()}` : '—');

// Gold is the money colour and pesos are always written this way in the
// app. Grouping separators come from en-PH so a four-figure total reads as
// 1,250.00 rather than 1250.00.
const peso = (value) =>
  `₱${Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Escapes text that came from a person before it goes into HTML. Order
// items carry seller-authored product names and support requests carry
// customer-authored message bodies; neither is trusted markup, and an
// unescaped angle bracket would at best break the layout.
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Mail clients are not browsers: no external stylesheets, no flexbox worth
// trusting, and Outlook still renders through Word. So this is a table,
// every style is inline, and the layout is one column. The preheader is
// the grey line an inbox shows beside the subject — left unset it fills
// with whatever text comes first, which is rarely what you would choose.
function shell({ preheader, heading, intro, body }) {
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:${CANVAS};">
  <span style="display:none;font-size:1px;color:${CANVAS};max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;">
        <tr><td style="padding:24px 24px 0 24px;">
          <p style="margin:0;font:600 12px/1.4 ${SANS};letter-spacing:0.09em;text-transform:uppercase;color:${CLAY};">PlainCo</p>
          <h1 style="margin:12px 0 0 0;font:700 24px/1.25 ${SANS};color:${INK};">${escapeHtml(heading)}</h1>
          <p style="margin:8px 0 0 0;font:400 14px/1.55 ${SANS};color:${ASH};">${escapeHtml(intro)}</p>
        </td></tr>
        <tr><td style="padding:20px 24px 24px 24px;">${body}</td></tr>
      </table>
      <p style="margin:16px 0 0 0;font:400 12px/1.5 ${SANS};color:${ASH};">You are receiving this because you have a PlainCo account.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

// ONE-SHOT GUARD. Firestore triggers are at-least-once: the same write can
// invoke a function more than once, and a customer who receives two
// identical receipts reasonably wonders whether they were charged twice.
//
// The claim is written BEFORE the send, using create(), which fails with
// ALREADY_EXISTS if the document is already there. That ordering is
// deliberate and it does trade one failure mode for another: if the send
// throws after the claim lands, nothing will re-attempt it and that email
// is simply lost. Chosen because the order is visible in the app either
// way, so a missing receipt is an inconvenience while a duplicate is
// alarming.
//
// mailLog is not declared in firestore.rules, and that file has no
// catch-all match, so no client can read or write it. The Admin SDK here
// bypasses rules entirely.
// 'unconfigured' is the one status that does NOT count as claimed. It
// means the message was never attempted because no credentials existed —
// so the work is still outstanding, and a later attempt must be allowed
// through. Every other status ('sending', 'sent', 'failed') means someone
// already tried, and re-sending would be the duplicate this guard exists
// to prevent.
//
// This was a create() until scripts/test-email.mjs (MAILER-2) proved the
// comment above it was wrong: recordOutcome() uses set({merge:true}),
// which CREATES the document, so the unconfigured path did leave one
// behind and create() then refused the real send forever after. Every
// receipt missed while the mailbox was unconfigured would have been
// permanently unsendable — and with the Gmail placeholders in place, that
// is currently every receipt.
const CLAIMABLE_STATUSES = ['unconfigured'];

async function claimOnce(key, meta) {
  const db = getFirestore();
  const ref = db.collection('mailLog').doc(key);
  try {
    // A transaction rather than create(), because the check is now
    // conditional on the existing status rather than on mere existence.
    // Two concurrent deliveries still resolve to one send: one transaction
    // commits, the other retries, reads 'sending' and backs out.
    return await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (snapshot.exists && !CLAIMABLE_STATUSES.includes(snapshot.data().status)) {
        logger.info(`mail ${key} already claimed, skipping`);
        return false;
      }
      // No merge: a re-claim after 'unconfigured' should not inherit that
      // attempt's detail line, which would describe a state that no longer
      // applies.
      tx.set(ref, {
        ...meta,
        detail: null,
        claimedAt: FieldValue.serverTimestamp(),
        // The field AdminMailLogScreen orders by, and it must be written
        // on EVERY path that creates one of these documents. Firestore's
        // orderBy silently omits documents lacking the field it sorts on —
        // not an error, just an absence — so a timestamp written on some
        // paths and not others makes entries invisible in the one screen
        // that exists to reveal them. claimedAt cannot serve: the
        // unconfigured path does not claim.
        recordedAt: FieldValue.serverTimestamp(),
        status: 'sending',
      });
      return true;
    });
  } catch (error) {
    // A contended transaction that exhausts its retries surfaces here.
    // Treated as "someone else has it" rather than rethrown, because the
    // only way to lose that race is against another delivery of the same
    // message — which is precisely the case where not sending is correct.
    logger.warn(`mail ${key} could not be claimed: ${error.message}`);
    return false;
  }
}

// `extra` carries the recipient and subject on paths that never claimed —
// claimOnce writes those, so without this an unconfigured entry would be a
// status with no indication of what message it belonged to.
async function recordOutcome(key, status, detail, extra) {
  const db = getFirestore();
  await db.collection('mailLog').doc(key).set(
    {
      ...(extra || {}),
      status,
      detail: detail || null,
      finishedAt: FieldValue.serverTimestamp(),
      // Refreshed here so it means "last touched", and written here so the
      // unconfigured path — which never calls claimOnce — still produces a
      // sortable document. See the note in claimOnce.
      recordedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// The value both secrets hold until someone sets the real ones. They have
// to EXIST for any deploy to succeed — the CLI validates every declared
// secret while it builds the deployment plan, so a missing GMAIL_USER
// blocks `--only functions:placeOrder` just as surely as it blocks the
// senders. Creating them as placeholders is what lets checkout deploy
// before the mailbox is sorted out.
const UNCONFIGURED = 'unconfigured@example.invalid';

// Whether real credentials have landed yet. Checked before anything is
// sent, because the alternative is a steady drip of SMTP authentication
// failures in the log that look like a broken mailbox rather than one that
// was never set up. This says which it is.
function mailConfigured() {
  const user = GMAIL_USER.value();
  return Boolean(user) && user !== UNCONFIGURED && user.includes('@');
}

// The transport is built per invocation rather than at module load,
// because .value() on a secret is only resolvable once the function is
// running — at load time it returns an empty string, and the send then
// fails with an authentication error that says nothing about why.
function transport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
  });
}

// The one seam scripts/test-email.mjs uses, and the smallest one that
// makes this file testable.
//
// Everything worth asserting here — that a duplicate trigger delivery
// sends once, that a failure is recorded rather than thrown, that an
// unconfigured mailbox does not consume the one-shot claim — is logic
// AROUND the send, not the send itself. Actually reaching Gmail proves
// nothing about any of it and cannot run in CI. So the transport is
// swappable and nothing else is: the tests exercise the real Firestore
// interaction against the emulator, with only SMTP replaced.
//
// Deliberately not a general-purpose injection point. It is reset by the
// test between cases and is never set in production.
let transportOverride = null;
function __setTransportForTests(fake) {
  transportOverride = fake;
}
const activeTransport = () => transportOverride || transport();

// Sends, and never throws. A failed email must not fail the trigger: with
// retry disabled there is nothing useful a thrown error would achieve, and
// an unhandled rejection in a background function is noise in the log
// rather than a signal. The outcome is written to mailLog either way, so
// "did that receipt go out?" stays answerable after the fact.
async function sendMail({ key, to, subject, html, text, replyTo, meta }) {
  if (!to) {
    logger.warn(`mail ${key} has no recipient, skipping`);
    return;
  }

  // Records the miss without consuming the one-shot claim — an
  // unconfigured mailbox is a temporary state, and a message skipped for
  // it is still outstanding work rather than a message already handled.
  //
  // The claim is not consumed because 'unconfigured' is in
  // CLAIMABLE_STATUSES, NOT because nothing is written here. That
  // distinction is the bug MAILER-2 caught: recordOutcome() uses
  // set({merge:true}), which creates the document, so a comment claiming
  // "this path does not write, therefore does not claim" was describing
  // behaviour the code did not have. The exemption has to be explicit.
  if (!mailConfigured()) {
    logger.warn(
      `mail ${key} not sent: GMAIL_USER is unset or still the placeholder. ` +
      'Run `firebase functions:secrets:set GMAIL_USER` and ' +
      '`firebase functions:secrets:set GMAIL_APP_PASSWORD`, then redeploy.'
    );
    await recordOutcome(key, 'unconfigured', 'no mail credentials set', {
      to,
      subject,
      ...meta,
    });
    return;
  }

  if (!(await claimOnce(key, { to, subject, ...meta }))) return;

  try {
    await activeTransport().sendMail({
      from: `${FROM_NAME} <${GMAIL_USER.value()}>`,
      to,
      // Set on support notifications so a Store Manager can answer by
      // hitting Reply instead of copying an address out of the body.
      // Undefined elsewhere, which nodemailer omits.
      replyTo: replyTo || undefined,
      subject,
      text,
      html,
    });
    await recordOutcome(key, 'sent');
    logger.info(`mail ${key} sent to ${to}`);
  } catch (error) {
    // Logged at error level so it surfaces in `firebase functions:log`
    // without anyone having to inspect mailLog to notice a problem.
    logger.error(`mail ${key} failed: ${error.message}`);
    await recordOutcome(key, 'failed', error.message);
  }
}

// Where support notifications go. Gmail will only send as the
// authenticated account, so that same mailbox is the natural inbox for
// them — the store reads its own mail.
const storeInbox = () => GMAIL_USER.value();

module.exports = {
  MAIL_SECRETS,
  sendMail,
  storeInbox,
  __setTransportForTests,
  UNCONFIGURED,
  shell,
  escapeHtml,
  peso,
  formatOrderNumber,
  SANS,
  INK,
  CANVAS,
  LINE,
  ASH,
  CLAY,
  GOLD,
};
