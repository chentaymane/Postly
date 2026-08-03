// Wall-clock scheduling in the user's own timezone.
//
// An automation's times are local wall-clock strings ("10:00"), not instants.
// That is deliberate: someone who wants a post every morning at ten wants ten
// in their own city, every day, including the two days a year when the offset
// moves. Storing a UTC instant would silently drift by an hour across DST;
// storing "10:00" plus an IANA zone does not.
//
// All of this is done with Intl, which ships with Node, rather than a date
// library — the app has no runtime dependencies beyond pg/next and this keeps
// it that way.

// Zones the browser may report that Intl accepts but that are not IANA names.
const DEFAULT_ZONE = 'UTC';

// True when the runtime can actually resolve this zone. An automation carrying
// a zone the platform does not know would otherwise throw inside the cron, one
// bad row taking every other automation down with it.
export function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(tz) {
  return isValidTimezone(tz) ? tz : DEFAULT_ZONE;
}

// Offset of `tz` from UTC, in milliseconds, at a given instant. Positive east
// of Greenwich. Derived by formatting the instant in the zone and reading the
// wall-clock back — the only dependency-free way to get a *historically
// correct* offset (fixed offsets are wrong for half the year).
function offsetAt(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);

  const f = {};
  for (const p of parts) f[p.type] = p.value;
  // Some engines render midnight as hour "24" under hour12:false.
  const asUtc = Date.UTC(
    Number(f.year), Number(f.month) - 1, Number(f.day),
    Number(f.hour) % 24, Number(f.minute), Number(f.second)
  );
  return asUtc - instant.getTime();
}

// The instant at which the clock in `tz` reads exactly y-m-d hh:mm.
//
// Two passes, because the offset we need depends on the answer: guess with the
// offset at the naive instant, then re-solve using the offset that actually
// applies there. That converges everywhere except inside the one hour a spring
// DST jump skips, where the clock never reads that time at all — the second
// pass lands just after the jump, which is the sane reading of "post at 02:30
// on the morning 02:30 does not exist".
export function zonedTimeToUtc(y, m, d, hh, mm, tz) {
  const zone = safeTimezone(tz);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  const firstPass = naive - offsetAt(new Date(naive), zone);
  const secondPass = naive - offsetAt(new Date(firstPass), zone);
  return new Date(secondPass);
}

// The calendar date showing on a clock in `tz` at a given instant.
export function zonedDateParts(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(tz),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const f = {};
  for (const p of parts) f[p.type] = p.value;
  return { year: Number(f.year), month: Number(f.month), day: Number(f.day) };
}

// 'YYYY-MM-DD' as it reads in the zone. This is the date half of a slot key,
// so it has to be the *local* date: a 23:00 slot in Casablanca belongs to that
// evening, not to the UTC day it happens to fall in.
export function zonedDateString(instant, tz) {
  const { year, month, day } = zonedDateParts(instant, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Parses "9:5" / "09:05" into { hh, mm }, or null when it is not a time.
export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

export function normaliseTime(value) {
  const t = parseTime(value);
  return t ? `${String(t.hh).padStart(2, '0')}:${String(t.mm).padStart(2, '0')}` : null;
}

// Cleans a times array: valid, unique, sorted, capped.
export function normaliseTimes(times, { max = 8 } = {}) {
  const seen = new Set();
  for (const t of Array.isArray(times) ? times : []) {
    const n = normaliseTime(t);
    if (n) seen.add(n);
  }
  return Array.from(seen).sort().slice(0, max);
}

// A slot is one scheduled moment of one automation: the local date it belongs
// to, the wall-clock time, and the instant that resolves to.
function makeSlot(dateString, time, at) {
  return { date: dateString, time, at, key: `${dateString}T${time}` };
}

// Every slot of `automation` falling in (after, until]. Half-open at the start
// so a watermark can be advanced without ever replaying or skipping a slot.
//
// Enumerating by local calendar date rather than by adding 24h is what makes
// this DST-correct: on a 23- or 25-hour day the wall-clock time still resolves
// to the right instant.
export function slotsBetween(automation, after, until) {
  const tz = safeTimezone(automation.timezone);
  const times = normaliseTimes(automation.times);
  if (times.length === 0) return [];

  const afterMs = after.getTime();
  const untilMs = until.getTime();
  if (untilMs <= afterMs) return [];

  const slots = [];
  // A day either side covers every zone offset relative to the UTC window.
  const DAY = 86400000;
  for (let ms = afterMs - DAY; ms <= untilMs + DAY; ms += DAY) {
    const { year, month, day } = zonedDateParts(new Date(ms), tz);
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (slots.some((s) => s.date === dateString)) continue;

    for (const time of times) {
      const { hh, mm } = parseTime(time);
      const at = zonedTimeToUtc(year, month, day, hh, mm, tz);
      const t = at.getTime();
      if (t > afterMs && t <= untilMs) slots.push(makeSlot(dateString, time, at));
    }
  }

  // De-duplicate: a repeated hour on a DST fall-back day can resolve twice.
  const byKey = new Map();
  for (const s of slots) if (!byKey.has(s.key)) byKey.set(s.key, s);
  return Array.from(byKey.values()).sort((a, b) => a.at - b.at);
}

// The next slot strictly after `now`. Used for the "next run" label, so it must
// agree exactly with what the scheduler will actually pick up.
export function nextSlot(automation, now = new Date()) {
  const horizon = new Date(now.getTime() + 8 * 86400000);
  return slotsBetween(automation, now, horizon)[0] || null;
}

export function nextRunAt(automation, now = new Date()) {
  const slot = nextSlot(automation, now);
  return slot ? slot.at.toISOString() : null;
}

// Slots the scheduler owes right now: everything between the watermark (or the
// catch-up window, whichever is later) and now, plus anything inside the lead
// window ahead of now.
//
// `lead` exists because generating a post is not instant — copy and artwork
// take the better part of a minute. Starting a few minutes early means the post
// is ready *at* its slot rather than a minute after it.
export function dueSlots(automation, { now = new Date(), leadMs = 6 * 60000 } = {}) {
  const catchUpHours = Number.isFinite(Number(automation.catch_up_hours))
    ? Math.max(0, Math.min(48, Number(automation.catch_up_hours)))
    : 6;

  const earliestCatchUp = new Date(now.getTime() - catchUpHours * 3600000);

  // No watermark means this automation has never been scheduled: a brand new
  // one, or an existing one on its first tick after an upgrade. It starts from
  // *now*, not from the top of the catch-up window — otherwise switching one on
  // (or deploying) would immediately fire every slot of the last few hours,
  // which reads as the app spamming rather than catching up.
  const watermark = automation.scheduled_through
    ? new Date(automation.scheduled_through)
    : now;

  // Never reach further back than the catch-up window allows: a paused
  // automation switched on after a week must not dump a week of posts.
  const after = watermark > earliestCatchUp ? watermark : earliestCatchUp;
  const until = new Date(now.getTime() + leadMs);

  return slotsBetween(automation, after, until).map((slot) => ({
    ...slot,
    // A slot already in the past is a catch-up: it goes out now rather than
    // being handed to the aggregator with a time that has been and gone.
    late: slot.at.getTime() <= now.getTime(),
  }));
}

// Formats a wall-clock time for display in a given zone, e.g. "10:00".
export function formatSlotTime(instant, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTimezone(tz), hour12: false,
    hour: '2-digit', minute: '2-digit',
  }).format(instant);
}

// Short zone label, e.g. "GMT+1" — enough for the user to confirm the app and
// their head agree about what time it is.
export function timezoneLabel(tz, at = new Date()) {
  const zone = safeTimezone(tz);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, timeZoneName: 'shortOffset',
    }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value || zone;
  } catch {
    return zone;
  }
}
