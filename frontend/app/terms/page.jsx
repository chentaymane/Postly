export const metadata = {
  title: 'Terms of Service — Postly',
  description: 'The terms that govern your use of Postly.',
};

const UPDATED = 'July 2026';
const CONTACT = 'chentaymane234@gmail.com';

export default function TermsPage() {
  return (
    <div className="legal">
      <h1>Terms of Service</h1>
      <p className="legal-meta">Last updated: {UPDATED}</p>

      <p>
        By creating an account or using Postly (&ldquo;the Service&rdquo;), you agree to these
        terms. If you do not agree, please do not use the Service.
      </p>

      <h2>What the Service does</h2>
      <p>
        Postly generates marketing copy and images from the prompts you provide, and
        publishes the result to social media accounts you have connected. You direct what
        gets created and where it is published.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You are responsible for keeping your password confidential and for activity under your account.</li>
        <li>You must provide an accurate email address and be at least 16 years old.</li>
        <li>You may only connect social accounts that you own or are authorised to manage.</li>
      </ul>

      <h2>Your content and responsibility for it</h2>
      <p>
        You retain ownership of the prompts you submit and the content generated for you.
        Because that content is created by automated models and published under your own
        social accounts, <strong>you are responsible for reviewing it before and after it is
        published</strong>, and for ensuring it is accurate, lawful, and does not infringe
        anyone&rsquo;s rights.
      </p>
      <p>You agree not to use the Service to create or publish content that:</p>
      <ul>
        <li>is unlawful, deceptive, harassing, hateful, or infringes intellectual property;</li>
        <li>violates the rules of any platform you publish to;</li>
        <li>constitutes spam or attempts to manipulate a platform&rsquo;s systems.</li>
      </ul>

      <h2>Third-party platforms</h2>
      <p>
        When you connect a platform such as Pinterest, your use of that platform remains
        governed by its own terms. Those platforms may change, rate-limit, or withdraw their
        APIs, and may suspend accounts for policy violations. We do not control their
        decisions and are not responsible for them.
      </p>

      <h2>Automated content disclaimer</h2>
      <p>
        Generated copy and images may contain errors, inaccuracies, or unintended
        similarities to existing works. The Service is a drafting aid, not a substitute for
        your judgement. Review everything before it goes out.
      </p>

      <h2>Availability</h2>
      <p>
        The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis,
        without warranties of any kind. It depends on free third-party providers and may be
        unavailable, rate-limited, or changed at any time. We may modify or discontinue
        features without notice.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, we are not liable for indirect, incidental,
        or consequential damages, nor for lost profits, data, or goodwill arising from your
        use of the Service — including content published in error, failed publications, or
        action taken against your accounts by a social platform.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Service and request deletion of your account at any time by
        contacting {CONTACT}. We may suspend or terminate accounts that violate these terms
        or that put the Service or its providers at risk.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms; material changes will be reflected in the date above.
        Continuing to use the Service after a change means you accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>Questions: {CONTACT}</p>
    </div>
  );
}
