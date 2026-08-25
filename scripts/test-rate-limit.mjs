/**
 * Tests the order rate limiter's window arithmetic.
 *
 *     npm run test:rate-limit
 *
 * Needs no emulator, no credentials and no clock: rateLimitDecision() in
 * functions/index.js is deliberately pure, taking "now" as an argument, so
 * a ten-minute window can be walked end to end in microseconds.
 *
 * WHAT THIS COVERS that scripts/test-rules.mjs cannot: the rules suite can
 * only assert that no client may touch rateLimits/{uid} (RATE-1). The
 * throttle itself lives in a Cloud Function, which bypasses rules entirely,
 * so its behaviour is unreachable from there. The boundary between the last
 * allowed attempt and the first refused one is exactly the kind of
 * off-by-one that ships silently.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _rateLimitDecision: decide, _RATE_LIMIT } = require('../functions/index.js');
const { RATE_LIMIT_MAX_ATTEMPTS: MAX, RATE_LIMIT_WINDOW_MS: WINDOW } = _RATE_LIMIT;

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

function assert(condition, what) {
  if (!condition) throw new Error(what);
}

function assertEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

const T0 = 1_700_000_000_000;

console.log(`\nRate limiter (${MAX} attempts per ${WINDOW / 60000} minutes)`);

test('a first-ever attempt is allowed and opens the window', () => {
  // No stored document: windowStartedAtMs 0, attempts 0.
  const d = decide(0, 0, T0);
  assert(d.allowed, 'should be allowed');
  assertEqual(d.nextAttempts, 1, 'nextAttempts');
  assertEqual(d.windowStartedAtMs, T0, 'window should start now');
});

test('attempts up to the limit are all allowed', () => {
  for (let stored = 0; stored < MAX; stored += 1) {
    const d = decide(T0, stored, T0 + 1000);
    assert(d.allowed, `attempt ${stored + 1} should be allowed`);
    assertEqual(d.nextAttempts, stored + 1, 'nextAttempts');
    assertEqual(d.windowStartedAtMs, T0, 'window must not move mid-window');
  }
});

test('the attempt AFTER the limit is refused', () => {
  // The boundary. MAX stored attempts means the quota is spent.
  const d = decide(T0, MAX, T0 + 1000);
  assert(!d.allowed, 'should be refused');
  assert(d.retryAfterSeconds > 0, 'must report a positive wait');
});

test('a refusal reports the remaining window, not the whole window', () => {
  const elapsed = 4 * 60 * 1000;
  const d = decide(T0, MAX, T0 + elapsed);
  const expected = Math.ceil((WINDOW - elapsed) / 1000);
  assertEqual(d.retryAfterSeconds, expected, 'retryAfterSeconds');
});

test('a refusal never reports zero seconds', () => {
  // One millisecond before the window closes, honest arithmetic rounds to
  // zero — which would tell the caller to retry immediately and be told no
  // again. Floored at one.
  const d = decide(T0, MAX, T0 + WINDOW - 1);
  assert(!d.allowed, 'should still be refused just inside the window');
  assert(d.retryAfterSeconds >= 1, `expected >= 1, got ${d.retryAfterSeconds}`);
});

test('the window rolls over exactly at its edge', () => {
  // At T0 + WINDOW the window is closed: now - start is not < WINDOW.
  const d = decide(T0, MAX, T0 + WINDOW);
  assert(d.allowed, 'should be allowed once the window has elapsed');
  assertEqual(d.nextAttempts, 1, 'count restarts from one');
  assertEqual(d.windowStartedAtMs, T0 + WINDOW, 'a fresh window starts now');
});

test('an expired window discards a spent quota entirely', () => {
  const d = decide(T0, MAX * 10, T0 + WINDOW + 1);
  assert(d.allowed, 'stale attempts must not carry over');
  assertEqual(d.nextAttempts, 1, 'nextAttempts');
});

test('hammering while refused does not extend the lockout', () => {
  // The property that keeps this a rate limit rather than an escalating
  // ban: a refused attempt returns no new window, so nothing the caller
  // does can push their own unlock further away. An impatient customer
  // tapping Place Order repeatedly must not make their wait longer.
  const first = decide(T0, MAX, T0 + 1000);
  const later = decide(T0, MAX, T0 + 2000);
  assert(!first.allowed && !later.allowed, 'both refused');
  assert(
    later.retryAfterSeconds <= first.retryAfterSeconds,
    'the wait must shrink as time passes, never grow'
  );
  assertEqual(first.windowStartedAtMs, undefined, 'a refusal returns no window');
});

test('a legitimate retry after a failed order still costs quota', () => {
  // Documenting the accepted trade-off rather than a bug: attempts are
  // counted whatever the order's fate, because counting only successes
  // would let an attacker loop for free on a deliberately out-of-stock
  // item. A shopper fixing a cart has MAX tries inside the window.
  const d = decide(T0, MAX - 1, T0 + 1000);
  assert(d.allowed, 'the last of the quota is still usable');
  assertEqual(d.nextAttempts, MAX, 'and it spends the quota');
  assert(!decide(T0, MAX, T0 + 2000).allowed, 'after which the next is refused');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const { name } of failures) console.error(`FAILED: ${name}`);
  process.exit(1);
}
