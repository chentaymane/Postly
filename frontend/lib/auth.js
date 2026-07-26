import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

// Email/password auth with JWT sessions (no session table needed).
// Google/social sign-in can be added later by appending a provider here.
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Required on Vercel, where the host header is proxied.
  trustHost: true,
  providers: [
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

        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return null;

        return { id: String(user.id), email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.uid) session.user.id = token.uid;
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
