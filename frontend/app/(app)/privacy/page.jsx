export const metadata = {
  title: 'Privacy Policy — Postly',
  description: 'How Postly collects, uses, stores, and deletes your data.',
};

const UPDATED = 'July 2026';
// Whoever runs this deployment is the data controller, not whoever wrote the
// code. A hardcoded address would point every fork's users at the original
// author, which is wrong both legally and practically.
const CONTACT = process.env.LEGAL_CONTACT_EMAIL || 'you@example.com';

export default function PrivacyPage() {
  return (
    <div className="legal">
      <h1>Privacy Policy</h1>
      <p className="legal-meta">Last updated: {UPDATED}</p>

      <p>
        Postly (&ldquo;the Service&rdquo;) helps you generate marketing content and publish it to
        social media accounts that you choose to connect. This policy explains what
        data we collect, why, and how you can remove it.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account details.</strong> Your email address, an optional display name,
          and a securely hashed password. We never store your password in readable form.
        </li>
        <li>
          <strong>Social account credentials.</strong> When you connect a platform such as
          Pinterest, we store the access token (and refresh token, if provided) that the
          platform issues, together with basic account information such as your username,
          account ID, and the boards or pages available to you. We ask only for the
          permissions needed to publish content and list your destinations.
        </li>
        <li>
          <strong>Content you create.</strong> The prompts you submit (theme, product name,
          description, tone, destination URL), the copy and images generated from them, and
          a record of each publish attempt including its status, the post ID returned by the
          platform, and any error message.
        </li>
        <li>
          <strong>Usage measurement.</strong> We count page views and visits using Vercel
          Web Analytics. It records the page visited, referrer, country, and the general
          device and browser type. It does not use cookies, does not follow you to other
          sites, and does not build a profile of you.
        </li>
      </ul>
      <p>
        We do not collect payment details, and we do not use advertising or
        cross-site tracking cookies. The only cookie we set is the one required to keep
        you signed in.
      </p>

      <h2>How we use your information</h2>
      <ul>
        <li>To authenticate you and keep your session active.</li>
        <li>To generate content at your request and publish it to the accounts you connected.</li>
        <li>To show your posting history and report errors returned by a platform.</li>
        <li>To keep the Service secure and diagnose failures.</li>
      </ul>
      <p>
        <strong>We do not sell your personal data, and we do not use your content to train
        machine-learning models.</strong>
      </p>

      <h2>Third-party services</h2>
      <p>
        To provide the Service, the prompts you submit are sent to the providers below.
        Only the text needed to generate your content is sent — never your credentials.
      </p>
      <ul>
        <li>The <strong>AI provider you configure</strong> (Groq, OpenAI, Google Gemini or Anthropic) — generates the written copy.</li>
        <li><strong>Pollinations.ai</strong> — generates the images.</li>
        <li>
          <strong>The social platform you connect</strong> (for example Pinterest) — receives
          the post you asked us to publish, on your behalf.
        </li>
        <li><strong>Neon</strong> (database hosting, United States) and <strong>Vercel</strong> (application hosting) — store and run the Service.</li>
        <li><strong>Vercel Web Analytics</strong> — counts page views. Cookieless, and it receives no account data.</li>
      </ul>

      <h2>Data retention and deletion</h2>
      <ul>
        <li>
          <strong>Disconnect a platform at any time</strong> from the Connections page. This
          deletes the stored access token for that account immediately.
        </li>
        <li>
          <strong>Delete your account</strong> by contacting us at {CONTACT}. We remove your
          user record, all connected-account tokens, and your posting history. Content
          already published to a social platform must be deleted on that platform, since we
          cannot remove it for you after publishing.
        </li>
      </ul>
      <p>
        Revoking Postly&rsquo;s access from within a platform&rsquo;s own settings (for example
        Pinterest&rsquo;s connected-apps page) also invalidates the token we hold.
      </p>

      <h2>Security</h2>
      <p>
        Passwords are hashed with bcrypt. Access tokens are stored server-side and are never
        exposed to your browser. All traffic is served over HTTPS, and database connections
        are encrypted with TLS. Each user&rsquo;s data is scoped to their own account.
      </p>
      <p>
        No system is perfectly secure. If you believe your account has been compromised,
        contact us at {CONTACT}.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access, correct, export, or
        delete your personal data, or to object to its processing. Contact us at {CONTACT}
        and we will respond within 30 days.
      </p>

      <h2>Children</h2>
      <p>
        The Service is not directed to anyone under 16, and we do not knowingly collect
        their data.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we make material changes, we will update the date at the top of this page and,
        where appropriate, notify you by email.
      </p>

      <h2>Contact</h2>
      <p>Questions or requests: {CONTACT}</p>
    </div>
  );
}
