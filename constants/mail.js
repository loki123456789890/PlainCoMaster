// constants/mail.js
//
// What counts as an undelivered email, in one place.
//
// This existed twice: StoreManagerDashboardScreen queried three statuses
// to count the "N emails didn't send" card, and AdminMailLogScreen listed
// them again to decide which rows the card's filter shows. The two are the
// same question asked from two screens, and the card is a link INTO the
// list — so when they disagree, tapping a card that says one email failed
// lands on a screen saying everything sent.
//
// Which is precisely what happened: adding 'retrying' for the resend
// feature updated the list and not the card. Nothing broke loudly. The
// dashboard just started counting a different set than the screen it
// navigates to.
//
// Kept in constants/ rather than in either screen because neither owns the
// definition. functions/mailer.js writes these statuses and holds the
// authoritative copy for the server; this is the client's, and the two are
// pinned together by the RETRY-* and MAIL-* tests.

// Statuses that mean a message has not (or may not have) reached anyone.
//
// 'sending' is here because it means the mailer claimed a send and never
// recorded an outcome — the function died mid-flight — so whether that
// receipt arrived is genuinely unknown, and unknown belongs in front of
// someone rather than filed as fine.
//
// 'retrying' is here for the same reason: it means an attempt was released
// and has not yet reported back.
export const MAIL_PROBLEM_STATUSES = ['failed', 'unconfigured', 'sending', 'retrying'];

// Statuses the "Send again" button is offered on. Mirrors
// RETRYABLE_STATUSES in functions/mailer.js.
//
// 'sending' is deliberately absent even though it IS a problem status: an
// attempt is in flight, and releasing it would put two copies on the wire.
// So a stuck 'sending' entry shows in the log as a problem with no button,
// which is the honest rendering of "we do not know and cannot safely find
// out by sending again".
export const MAIL_RESENDABLE_STATUSES = ['failed', 'unconfigured', 'retrying'];

// Mirrors MAX_RETRY_ATTEMPTS in functions/mailer.js. This decides what the
// button says; the server decides what it does.
export const MAIL_MAX_RETRY_ATTEMPTS = 3;
