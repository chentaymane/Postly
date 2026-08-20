import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

// Email/password plus Google, with JWT sessions (no session table needed).
//
// Google is only offered when the deployment has credentials for it, so a
// self-hosted copy without them shows one sign-in option rather than a button
// that dead-ends in an OAuth error.
export function googleEnabled() {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

const providers = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(creds) {
      const email = String(creds?.email || '').trim().toLowerCase();
      const password = String(creds?.password || '');
      if (!email || !password) return null;

      const { rows } = await query(
        'SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1',
        [email]
      );
      const user = rows[0];
      if (!user) return null;

      // An account created through Google has no password. Comparing against a
      // null hash throws, and bcrypt against an empty string would be worse:
      // it must simply not be a way in.
      if (!user.password_hash) return null;

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return null;

      await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]).catch(() => {});
      return { id: String(user.id), email: user.email, name: user.name };
    },
  }),
];

if (googleEnabled()) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Always show the chooser: people testing a SaaS routinely have several
      // Google accounts and silently reusing the last one is disorienting.
      authorization: { params: { prompt: 'select_account' } },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Required on Vercel, where the host header is proxied.
  trustHost: true,
  providers,
  callbacks: {
    // Google hands us a verified email; that is what an account is keyed on.
    // Matching on it links a Google sign-in to an existing password account
    // rather than creating a second one for the same person — the classic
    // "I already have an account but it says I don't" bug.
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true;
      if (!profile?.email || profile.email_verified === false) return false;

      const email = String(profile.email).trim().toLowerCase();
      await query(
        `INSERT INTO users (email, password_hash, name, image, auth_providers, last_login_at)
         VALUES ($1, NULL, $2, $3, '{google}', now())
         ON CONFLICT (lower(email)) DO UPDATE SET
           name  = COALESCE(users.name, EXCLUDED.name),
           image = COALESCE(EXCLUDED.image, users.image),
           auth_providers = (
             SELECT array_agg(DISTINCT p)
               FROM unnest(users.auth_providers || '{google}'::text[]) p
           ),
           last_login_at = now()`,
        [email, profile.name || null, profile.picture || null]
      );
      return true;
    },

    async jwt({ token, user, account, profile }) {
      if (user?.id && account?.provider !== 'google') {
        token.uid = user.id;
        return token;
      }
      // Google's `user.id` is Google's, not ours. The row was created or found
      // in signIn above, so read our own id back and use that everywhere —
      // every table in this app is keyed on it.
      if (account?.provider === 'google' && profile?.email) {
        const { rows } = await query('SELECT id, image FROM users WHERE lower(email) = $1', [
          String(profile.email).trim().toLowerCase(),
        ]);
        if (rows[0]) {
          token.uid = String(rows[0].id);
          token.picture = rows[0].image || token.picture;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token?.uid) session.user.id = token.uid;
      if (token?.picture) session.user.image = token.picture;
      return session;
    },
  },
});

// Returns the signed-in user's numeric id, or null.
export async function currentUserId() {
  const session = await auth();
  const id = session?.user?.id;
  return id ? Number(id) : null;
}
