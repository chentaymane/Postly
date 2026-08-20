import { PostlyLogo, PlatformIcon, NavIcon } from '../components/BrandIcons';
import ThemeToggle from '../components/ThemeToggle';
import './marketing.css';

export const metadata = {
  title: 'Postly — your social media, on autopilot',
  description:
    'Describe your business once. Postly writes the posts, makes the artwork, and publishes '
    + 'them on your schedule to Pinterest, Instagram, Facebook, LinkedIn and more. Open source, self-hostable.',
};

const PLATFORMS = ['pinterest', 'instagram', 'facebook', 'tiktok', 'linkedin', 'x'];

const FEATURES = [
  {
    icon: 'create',
    title: 'Writes like a person, not a template',
    body:
      'The hook is capped at twelve words and every post must carry one concrete detail. '
      + 'A ban list kills the phrases that make copy sound like it could be selling anything.',
  },
  {
    icon: 'automation',
    title: 'Posts at the hour you actually meant',
    body:
      'Times are local wall-clock in your own timezone and stay put across daylight saving. '
      + 'If a run is missed it is caught up, not lost.',
  },
  {
    icon: 'review',
    title: 'Approve first, or let it run',
    body:
      'Every post can wait in Review for your edit, or go straight out. '
      + 'Per automation, so one stream can be hands-off while another is not.',
  },
  {
    icon: 'dashboard',
    title: 'Counts posts that exist',
    body:
      'A platform accepting a post is not the same as publishing it. Postly reads the real '
      + 'outcome back, so the dashboard shows what is live, not what was sent.',
  },
  {
    icon: 'bolt',
    title: 'Retries what deserves retrying',
    body:
      'A timeout is not a rejection. Transient failures come back on a growing backoff; '
      + 'a real refusal stops and tells you why, in words you can act on.',
  },
  {
    icon: 'key',
    title: 'Your keys, your quota',
    body:
      'Bring your own Groq, OpenAI, Gemini or Anthropic key. They are encrypted at rest '
      + 'and never sent to the browser. The free tiers are enough to run this properly.',
  },
];

const STEPS = [
  {
    title: 'Describe your business',
    body:
      'Pick a business type to start from, then say what you sell, who buys it and why. '
      + 'Add rules the AI must always follow — this is what stops the posts sounding generic.',
  },
  {
    title: 'Connect your accounts',
    body:
      'One click per platform, no developer app to register. Pinterest, Instagram, Facebook, '
      + 'TikTok, LinkedIn, Threads and YouTube.',
  },
  {
    title: 'Set the hours and walk away',
    body:
      'Choose how many posts a day and when. Postly writes them, makes the artwork, and '
      + 'publishes on time — catching up anything it misses.',
  },
];

const FAQ = [
  {
    q: 'Is it really free?',
    a: 'The software is free and open source under the AGPL. Running it is free too, on the '
      + 'hobby tiers of Vercel and Neon with a free Groq key. You only pay if you outgrow '
      + 'those, and you can self-host it anywhere instead.',
  },
  {
    q: 'Do I need to register a developer app for each platform?',
    a: 'No. Accounts connect through an aggregator, so connecting Pinterest or Instagram is a '
      + 'single click. Direct OAuth is supported too if you would rather run your own apps.',
  },
  {
    q: 'What does it cost me in AI credits?',
    a: 'Nothing on the free tiers. Copy comes from whichever provider you hold a key for — Groq '
      + 'is free and fast — and images are generated without any key at all.',
  },
  {
    q: 'Will the posts sound like a robot wrote them?',
    a: 'That is the part most of the work went into. Postly bans the dead phrases, forces a '
      + 'specific detail into every post, and takes your own rules over its defaults. '
      + 'You can also read and edit every post before it goes out.',
  },
  {
    q: 'Can I run it on my own server?',
    a: 'Yes, and the licence protects that. It is a single Next.js app plus Postgres — no '
      + 'Docker, no queue, no orchestrator. If you modify it and run it as a public service, '
      + 'the AGPL asks you to publish your changes.',
  },
  {
    q: 'What happens to my data?',
    a: 'It stays in your database. API keys are encrypted with AES-256-GCM and never reach the '
      + 'browser. There is no advertising and no cross-site tracking.',
  },
];

export default function LandingPage() {
  return (
    <div className="marketing">
      <header className="mk-nav">
        <a href="/" aria-label="Postly home"><PostlyLogo /></a>
        <nav className="mk-nav-links">
          <a className="mk-nav-link hide-sm" href="#how">How it works</a>
          <a className="mk-nav-link hide-sm" href="#features">Features</a>
          <a className="mk-nav-link hide-sm" href="#faq">FAQ</a>
          <ThemeToggle />
          <a className="mk-nav-link" href="/login">Sign in</a>
          <a className="btn btn-accent btn-sm" href="/login?mode=signup">Start free</a>
        </nav>
      </header>

      {/* ---------------------------------------------------------------- hero */}
      <section className="mk-section">
        <div className="mk-inner mk-hero">
          <div>
            <span className="mk-eyebrow">
              <NavIcon name="bolt" size={13} /> Open source · self-hostable
            </span>
            <h1 className="mk-h1">
              Your social media, <span className="mk-mark">on autopilot</span>
            </h1>
            <p className="mk-lede">
              Describe your business once. Postly writes the posts, makes the artwork, and
              publishes them on your schedule — while you get on with the actual work.
            </p>
            <div className="mk-cta-row">
              <a className="btn btn-accent btn-lg" href="/login?mode=signup">Start free</a>
              <a className="btn btn-outline btn-lg" href="#how">See how it works</a>
            </div>
            <p className="mk-note" style={{ marginTop: 'var(--s4)' }}>
              No credit card. Free tiers are enough to run it properly.
            </p>
          </div>

          <div className="mk-shot" aria-hidden="true">
            <div className="mk-shot-bar">
              <span className="mk-dot" /><span className="mk-dot" /><span className="mk-dot" />
              <span className="mk-shot-title">Today · Africa/Casablanca</span>
            </div>
            <div className="mk-shot-body">
              {[
                { t: '09:00', p: 'pinterest', w: 'mid' },
                { t: '13:00', p: 'instagram', w: 'short' },
                { t: '18:00', p: 'facebook', w: 'mid' },
              ].map((r) => (
                <div className="mk-row" key={r.t}>
                  <span className="mk-row-time">{r.t}</span>
                  <span className="platform-chip" style={{ background: 'var(--surface-3)', color: 'var(--text-soft)' }}>
                    <PlatformIcon platform={r.p} size={11} /> {r.p}
                  </span>
                  <span className="mk-bars">
                    <span className="mk-bar" />
                    <span className={`mk-bar ${r.w}`} />
                  </span>
                  <span className="pill ok"><span className="dot" />live</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ platforms */}
      <section className="mk-section alt" style={{ paddingBlock: 'var(--s7)' }}>
        <div className="mk-inner">
          <p className="mk-note" style={{ textAlign: 'center', marginBottom: 'var(--s5)' }}>
            Publishes to
          </p>
          <div className="mk-logos">
            {PLATFORMS.map((p) => (
              <span className="mk-logo" key={p}>
                <PlatformIcon platform={p} size={17} />
                <span style={{ textTransform: 'capitalize' }}>{p === 'x' ? 'X' : p}</span>
              </span>
            ))}
            <span className="mk-logo">+ Threads · YouTube</span>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- how */}
      <section className="mk-section" id="how">
        <div className="mk-inner">
          <h2 className="mk-h2">Three things to set up. Then nothing.</h2>
          <p className="mk-sub">
            The whole point is that you stop thinking about it. Setup takes about ten minutes.
          </p>
          <div className="mk-steps">
            {STEPS.map((s) => (
              <div className="mk-step" key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ features */}
      <section className="mk-section alt" id="features">
        <div className="mk-inner">
          <h2 className="mk-h2">Built by fixing what actually breaks</h2>
          <p className="mk-sub">
            Most of this exists because something went wrong first — a post that never went out,
            a caption nobody would read, a dashboard counting things that were not there.
          </p>
          <div className="mk-grid">
            {FEATURES.map((f) => (
              <div className="mk-card" key={f.title}>
                <span className="mk-card-icon"><NavIcon name={f.icon} size={19} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- open source */}
      <section className="mk-section">
        <div className="mk-inner mk-hero">
          <div>
            <span className="mk-eyebrow">AGPL-3.0</span>
            <h2 className="mk-h2">Open source, and it stays that way</h2>
            <p className="mk-lede">
              Read every line, change what you like, run it on your own machine. The licence
              means anyone who modifies Postly and runs it as a service has to share their
              changes too — so it cannot quietly become somebody else&apos;s closed product.
            </p>
            <div className="mk-cta-row">
              <a className="btn btn-outline btn-lg" href="https://github.com/chentaymane/Postly"
                 target="_blank" rel="noreferrer">
                View the source
              </a>
            </div>
          </div>
          <div className="mk-shot" aria-hidden="true">
            <div className="mk-shot-bar">
              <span className="mk-dot" /><span className="mk-dot" /><span className="mk-dot" />
              <span className="mk-shot-title">what it costs to run</span>
            </div>
            <div className="mk-shot-body">
              {[
                ['Hosting', 'Vercel hobby', 'free'],
                ['Database', 'Neon free tier', 'free'],
                ['Copy', 'Groq API key', 'free'],
                ['Artwork', 'no key needed', 'free'],
                ['Video', 'GitHub Actions', 'free'],
              ].map(([k, v, price]) => (
                <div className="mk-row" key={k}>
                  <span className="mk-row-time" style={{ minWidth: 66 }}>{k}</span>
                  <span className="mk-bars" style={{ fontSize: 13, color: 'var(--text-dim)' }}>{v}</span>
                  <span className="pill accent">{price}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- faq */}
      <section className="mk-section alt" id="faq">
        <div className="mk-inner" style={{ maxWidth: 780 }}>
          <h2 className="mk-h2">Questions</h2>
          <div className="mk-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <span className="mk-faq-plus" aria-hidden="true">
                    <NavIcon name="create" size={16} />
                  </span>
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- close */}
      <section className="mk-section">
        <div className="mk-inner">
          <div className="mk-final">
            <h2>Stop writing posts at midnight</h2>
            <p>Set it up once. Let it run.</p>
            <a className="btn btn-dark btn-lg" href="/login?mode=signup">Start free</a>
          </div>
        </div>
      </section>

      <footer className="mk-footer">
        <span>© {new Date().getFullYear()} Postly · AGPL-3.0</span>
        <nav className="mk-footer-links">
          <a href="/login">Sign in</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="https://github.com/chentaymane/Postly" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </footer>
    </div>
  );
}
