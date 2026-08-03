// Failure classification and backoff.
//
// A publish that failed because the network hiccuped and a publish that failed
// because the caption breaks the platform's rules are not the same event, and
// treating them the same is what made posts vanish: everything was marked
// "failed" and nothing was ever tried again. One deserves another attempt in a
// few minutes; the other deserves a message to the user and no retries at all.

// Wording platforms and aggregators use when the request never reached a
// verdict — a timeout, a gateway, a throttle. These are worth another attempt.
const TRANSIENT = [
  /timed? ?out|timeout|abort/i,
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up/i,
  /fetch failed|network|temporarily unavailable|try again/i,
  /HTTP 5\d\d|\b(500|502|503|504)\b|internal server error|bad gateway|service unavailable/i,
  /rate ?limit|too many requests|\b429\b|quota exceeded|throttl/i,
  /still processing|not ready|media.*process/i,
];

// Failures that will never come right on their own. Retrying these burns quota
// and buries the message the user actually needs to read.
const PERMANENT = [
  /not connected|no .* account|missing its account id|no Pinterest board|no Facebook Page/i,
  /unauthor|invalid[_ ]token|token .*(expired|revoked)|permission|forbidden|\b40[13]\b/i,
  /not implemented|unsupported|no AI writer configured|no .* key\b/i,
  /nothing to publish|has no media|needs a video or at least one image/i,
  /duplicate|already (posted|published)/i,
];

export function classifyFailure(error) {
  const message = String(error?.message || error || '');
  if (error?.unconfirmed) return 'unconfirmed';
  if (PERMANENT.some((re) => re.test(message))) return 'permanent';
  if (TRANSIENT.some((re) => re.test(message))) return 'transient';
  // Unknown failures are retried, but only a couple of times: an unrecognised
  // message is more often a passing glitch than a permanent rule, and the
  // attempt ceiling stops an unknown-but-permanent error looping forever.
  return 'transient';
}

// Growing gaps, so a platform having a bad ten minutes is ridden out without
// hammering it: ~2m, 8m, 25m, 1h, 3h. After that the post stays failed and the
// user is told, rather than being retried invisibly for days.
const BACKOFF_MINUTES = [2, 8, 25, 60, 180];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

export function nextAttemptAt(attempts, from = new Date()) {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.max(0, attempts - 1)] ?? BACKOFF_MINUTES.at(-1);
  // A little jitter keeps a batch of posts that failed together from all
  // retrying in the same second and failing together again.
  const jitter = Math.floor(Math.random() * 45) * 1000;
  return new Date(from.getTime() + minutes * 60000 + jitter);
}

// What the user should read when a post has stopped being retried.
export function exhaustedMessage(message, attempts) {
  return `${message} (gave up after ${attempts} attempt${attempts === 1 ? '' : 's'})`;
}
