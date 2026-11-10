export function taggedLink(destination, platform, postId) {
  const url = new URL(destination);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid destination');
  if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', platform || 'postly');
  if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', 'social');
  if (!url.searchParams.has('utm_campaign')) url.searchParams.set('utm_campaign', 'postly');
  if (!url.searchParams.has('utm_content') && postId != null) url.searchParams.set('utm_content', String(postId));
  return url.toString();
}

// Link previews fetch URLs too. Counting those as visitors hides real results.
export function isLinkPreview(headers) {
  return /bot\b|crawler|spider|facebookexternalhit|facebot|pinterest|slackbot|twitterbot|discordbot|whatsapp|telegrambot/i
    .test(headers.get('user-agent') || '')
    || /prefetch|preview/i.test(`${headers.get('purpose') || ''} ${headers.get('sec-purpose') || ''}`);
}
