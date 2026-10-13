// Shared vocabulary for showing posts: names, colours, times and what a
// status means in words. Every page that lists posts used to carry its own
// copy of these, and they had started to disagree.

export const PLATFORM_COLORS = {
  pinterest: '#E60023', instagram: '#E4405F', facebook: '#1877F2',
  x: '#000000', linkedin: '#0A66C2', tiktok: '#010101',
};

export const PLATFORM_NAMES = {
  pinterest: 'Pinterest', instagram: 'Instagram', facebook: 'Facebook',
  x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok',
};

export const FORMAT_NAMES = { single: 'Image', carousel: 'Carousel', video: 'Video' };

// The creative angle a product post was written to (lib/recipes.js), in words.
const ANGLES = {
  showcase: 'Meet the product', peek: 'A look inside', gift: 'Gift idea',
  pick: 'Which would you pick?', moment: 'The perfect moment', free: 'Free download',
  season: 'Seasonal', classroom: 'For teachers & parents', deal: 'The deal',
};
export function angleName(key) {
  return ANGLES[key] || '';
}

export function platformName(key) {
  return PLATFORM_NAMES[key] || key;
}

const pad = (n) => String(n).padStart(2, '0');

// Dates in the interface's own language. The browser's locale would mix
// "Tomorrow" with "11 octobre" on a French machine.
const LOCALE = 'en-GB';

// 24-hour clock in the viewer's own zone.
export function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The viewer's local calendar date, for grouping.
export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date.toLocaleDateString(LOCALE, { weekday: 'long' });
}

export function dateLine(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });
}

// "Fri 10 Oct, 13:00"
export function whenLong(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' })}, ${timeOf(iso)}`;
}

// "in 2 h 14 min", "5 min ago"
export function relative(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60000);
  let unit;
  if (mins < 1) unit = 'less than a minute';
  else if (mins < 60) unit = `${mins} min`;
  else if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    unit = m && h < 10 ? `${h} h ${m} min` : `${h} h`;
  } else {
    const days = Math.round(mins / 1440);
    unit = `${days} day${days === 1 ? '' : 's'}`;
  }
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

// The line a person would recognise the post by: the pin's title on
// Pinterest, the caption's opening line everywhere else. (Other platforms
// carry a pin_title too, but it is an internal subject line nobody sees.)
export function postTitle(post) {
  const first = String(post.caption || post.pin_description || '')
    .split('\n').map((s) => s.trim()).find(Boolean);
  if (post.platform === 'pinterest') return post.pin_title || first || post.theme || 'Untitled pin';
  return first || post.pin_title || post.theme || 'Untitled post';
}

export function slidesOf(post) {
  return Array.isArray(post.image_urls) ? post.image_urls.filter(Boolean) : [];
}

// What a post's state means, in words, with the pill tone to show it in.
export function statusOf(post) {
  const s = post.status;
  if (s === 'generating') return { label: 'Writing…', tone: 'neutral', busy: true };
  if (s === 'publishing' || s === 'retrying') return { label: 'Sending…', tone: 'info', busy: true };
  if (s === 'published') {
    return post.remote_status === 'published'
      ? { label: 'Live', tone: 'ok' }
      : { label: 'Posted', tone: 'ok' };
  }
  if (s === 'skipped') return { label: 'Skipped', tone: 'neutral' };
  if (s === 'unconfirmed') return { label: 'Check needed', tone: 'warn' };
  if (s === 'failed') {
    return post.failure_kind === 'transient' && post.next_attempt_at
      ? { label: 'Retrying', tone: 'warn' }
      : { label: 'Failed', tone: 'danger' };
  }
  if (s === 'draft') {
    if (post.format === 'video' && !post.video_url && post.video_status !== 'failed') {
      return { label: 'Rendering video', tone: 'info', busy: true };
    }
    return { label: 'Needs approval', tone: 'warn' };
  }
  if (s === 'scheduled') {
    if (post.automation_paused) return { label: 'Paused', tone: 'neutral' };
    if (post.delivery !== 'postly') return { label: `With ${platformName(post.platform)}`, tone: 'ok' };
    return { label: 'Scheduled', tone: 'accent' };
  }
  return { label: s, tone: 'neutral' };
}
