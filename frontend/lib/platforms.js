// Platform registry — OAuth + display metadata.
// `enabled: true` means the Connect flow is wired up. Others render as
// "coming soon" cards in the dashboard.

// Requested for both Facebook and Instagram so a single connection can publish
// to either. In a Meta app in Development mode these work for accounts you own
// without app review.
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
];

export const PLATFORMS = {
  pinterest: {
    name: 'Pinterest',
    color: '#E60023',
    emoji: '📌',
    enabled: true,
    authorizeUrl: 'https://www.pinterest.com/oauth/',
    tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
    scopes: ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'],
    scopeSeparator: ',',
    clientIdEnv: 'PINTEREST_CLIENT_ID',
    clientSecretEnv: 'PINTEREST_CLIENT_SECRET',
  },
  // Facebook and Instagram share one Meta app, one OAuth flow, and one set of
  // scopes — connecting either yields a Page token usable for both.
  facebook: {
    name: 'Facebook',
    color: '#1877F2',
    emoji: '👍',
    enabled: true,
    kind: 'meta',
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: META_SCOPES,
    scopeSeparator: ',',
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
  },
  // "Instagram API with Instagram Login": users authenticate with Instagram
  // directly, so no Facebook Page is involved. Uses its own Instagram app
  // ID/secret (found under the Instagram product, NOT the Facebook app's).
  instagram: {
    name: 'Instagram',
    color: '#E4405F',
    emoji: '📷',
    enabled: true,
    kind: 'instagram_login',
    authorizeUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    scopeSeparator: ',',
    clientIdEnv: 'INSTAGRAM_CLIENT_ID',
    clientSecretEnv: 'INSTAGRAM_CLIENT_SECRET',
    requirement: 'Instagram professional account (Business or Creator)',
  },
  x: {
    name: 'X (Twitter)',
    color: '#000000',
    emoji: '𝕏',
    enabled: false,
    clientIdEnv: 'X_CLIENT_ID',
    clientSecretEnv: 'X_CLIENT_SECRET',
  },
  linkedin: {
    name: 'LinkedIn',
    color: '#0A66C2',
    emoji: '💼',
    enabled: false,
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
  },
  tiktok: {
    name: 'TikTok',
    color: '#010101',
    emoji: '🎵',
    enabled: false,
    clientIdEnv: 'TIKTOK_CLIENT_KEY',
    clientSecretEnv: 'TIKTOK_CLIENT_SECRET',
  },
};

import { socialApiEnabled, SOCIALAPI_PLATFORMS } from './socialapi.js';
import { zernioEnabled, ZERNIO_PLATFORMS } from './zernio.js';

// Public, secret-free view for the browser. Aggregators provide one-click
// connect with no per-platform app registration.
//
// Zernio is tried first: it covers every platform except X and does not meter
// posts on its free tier, whereas SocialAPI's free tier allows only 10 posts a
// month. SocialAPI then covers what Zernio cannot (notably X), and direct
// OAuth remains the last resort.
export function publicCatalog() {
  const sapi = socialApiEnabled();
  const zernio = zernioEnabled();
  return Object.entries(PLATFORMS).map(([key, p]) => {
    const viaZernio = zernio && ZERNIO_PLATFORMS.has(key);
    const viaSocialApi = !viaZernio && sapi && SOCIALAPI_PLATFORMS.has(key);
    const viaAggregator = viaSocialApi || viaZernio;
    const directConfigured =
      p.enabled && Boolean(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]);
    return {
      key,
      name: p.name,
      color: p.color,
      emoji: p.emoji,
      enabled: p.enabled || viaAggregator,
      requirement: viaAggregator ? null : p.requirement || null,
      configured: viaAggregator || directConfigured,
      connectPath: viaZernio
        ? `/api/zernio/${key}/start`
        : viaSocialApi
          ? `/api/aggregator/${key}/start`
          : `/api/oauth/${key}/start`,
    };
  });
}

// Public base URL of this app. Explicit APP_BASE_URL wins; on Vercel we fall
// back to the stable production domain (NOT VERCEL_URL, which changes every
// deploy and would break the exact redirect-URI match platforms require).
export function appBaseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return 'http://localhost:3000';
}

export function redirectUri(platformKey) {
  return `${appBaseUrl()}/api/oauth/${platformKey}/callback`;
}
