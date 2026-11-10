// Keep generated and edited drafts consistent at every publishing boundary.
export function normaliseHashtags(value) {
  const tags = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  const seen = new Set();
  return tags.map((tag) => String(tag).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10).map((tag) => `#${tag}`).join(' ');
}

export function composeMessage({ caption, cta, hashtags, destinationUrl }, platform) {
  const body = String(caption || '').trim();
  const action = String(cta || '').trim();
  const comparable = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const duplicate = action && comparable(body).includes(comparable(action));
  const link = platform === 'facebook' && /^https?:\/\//i.test(destinationUrl || '')
    && !body.includes(destinationUrl) ? destinationUrl : '';
  return [body, duplicate ? '' : action, link, normaliseHashtags(hashtags)]
    .filter(Boolean).join('\n\n');
}
