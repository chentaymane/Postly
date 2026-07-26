// Platform registry — OAuth + display metadata.
// `enabled: true` means the Connect flow is wired up. Others render as
// "coming soon" cards in the dashboard.

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
  facebook: {
    name: 'Facebook',
    color: '#1877F2',
    emoji: '👍',
    enabled: false,
    authorizeUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    scopes: ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement'],
    scopeSeparator: ',',
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
  },
  instagram: {
    name: 'Instagram',
    color: '#E4405F',
    emoji: '📷',
    enabled: false,
    clientIdEnv: 'META_CLIENT_ID',
    clientSecretEnv: 'META_CLIENT_SECRET',
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

// Public, secret-free view for the browser.
export function publicCatalog() {
  return Object.entries(PLATFORMS).map(([key, p]) => ({
    key,
    name: p.name,
    color: p.color,
    emoji: p.emoji,
    enabled: p.enabled,
    configured: p.enabled ? Boolean(process.env[p.clientIdEnv] && process.env[p.clientSecretEnv]) : false,
  }));
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
