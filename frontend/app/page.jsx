import { PostlyLogo, PlatformIcon, NavIcon } from '../components/BrandIcons';
import ThemeToggle from '../components/ThemeToggle';
import './marketing.css';

export const metadata = {
  title: 'Postly — your social media, on autopilot',
  description:
    'Describe your business once. Postly writes the posts, makes the artwork, and publishes '
    + 'them on your schedule to Pinterest, Instagram, Facebook, LinkedIn and more. '
    + 'Open source and free to self-host.',
};

const PLATFORMS = ['pinterest', 'instagram', 'facebook', 'tiktok', 'linkedin', 'x'];

const STEPS = [
  {
    title: 'Describe your business',
    body:
      'Pick a business type to start from, then say what you sell, who buys it and why. '
      + 'Add the rules the AI must always follow — that is what stops posts sounding generic.',
  },
  {
    title: 'Connect your accounts',
    body:
      'One click per platform. No developer app to register, no API keys to chase, '
      + 'no waiting on a review process.',
  },
  {
    title: 'Set the hours and leave',
    body:
      'Choose how many posts a day and when. Postly writes them, makes the artwork, '
      + 'and publishes on time — catching up anything it misses.',
  },
];

const FAQ = [
  {
    q: 'Is it really free?',
    a: 'The software is free and open source under the AGPL. Running it is free too — the '
      + 'hobby tiers of Vercel and Neon, plus a free Groq key, cover everything. You only pay '
      + 'if you outgrow those, and you can self-host it anywhere instead.',
  },
  {
    q: 'Do I need a developer app for each platform?',
    a: 'No. Accounts connect through an aggregator, so connecting Pinterest or Instagram is a '
      + 'single click. Direct OAuth is supported too if you would rather run your own apps.',
  },
  {
    q: 'Will the posts sound like a robot wrote them?',
    a: 'That is where most of the work went. The hook is capped at twelve words, every post '
      + 'must carry one concrete detail, and a ban list kills the phrases that make copy sound '
      + 'like it could be selling anything. Your own rules override all of it, and you can read '
      + 'and edit every post before it goes out.',
  },
  {
    q: 'What if a post fails to publish?',
    a: 'A timeout is not a rejection, so transient failures are retried on a growing backoff. A '
      + 'real refusal stops immediately and tells you why in words you can act on. Either way it '
      + 'appears in Review rather than disappearing.',
  },
  {
    q: 'Can I run it on my own server?',
    a: 'Yes, and the licence protects that. It is a single Next.js app plus Postgres — no Docker, '
      + 'no queue, no orchestrator. If you modify it and run it as a public service, the AGPL '
      + 'asks you to publish your changes.',
  },
  {
    q: 'What happens to my data?',
    a: 'It stays in your database. API keys are encrypted with AES-256-GCM and never reach the '
      + 'browser. No advertising, no cross-site tracking, no selling anything to anyone.',
  },
];

function Tick() {
  return (
    <svg className="mk-tick" width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="marketing">
      <header className="mk-nav">
        <a href="/" aria-label="Postly home"><PostlyLogo /></a>
        <nav className="mk-nav-links">
          <a className="mk-nav-link hide-sm" href="#services">What it does</a>
          <a className="mk-nav-link hide-sm" href="#how">How it works</a>
          <a className="mk-nav-link hide-sm" href="#faq">FAQ</a>
          <ThemeToggle />
          <a className="mk-nav-link" href="/login">Sign in</a>
          <a className="btn btn-accent btn-sm" href="/login?mode=signup">Start free</a>
        </nav>
      </header>

      {/* ---------------------------------------------------------------- hero */}
      <div className="mk-hero-wrap">
        <section className="mk-section">
          <div className="mk-inner mk-hero">
            <div>
              <span className="mk-badge">
                <NavIcon name="bolt" size={13} /> Open source · free to self-host
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
                <a className="btn btn-outline btn-lg" href="#services">See what it does</a>
              </div>
              <div className="mk-trust">
                <span><Tick /> No credit card</span>
                <span><Tick /> Free tier is enough</span>
                <span><Tick /> Your data stays yours</span>
              </div>
            </div>

            <div className="mk-shot" aria-hidden="true">
              <div className="mk-shot-bar">
                <span className="mk-dot-win" /><span className="mk-dot-win" /><span className="mk-dot-win" />
                <span className="mk-shot-title">Today · your timezone</span>
              </div>
              <div className="mk-shot-body">
                {[
                  { t: '09:00', p: 'pinterest', w: 'mid', s: 'live' },
                  { t: '13:00', p: 'instagram', w: 'short', s: 'live' },
                  { t: '18:00', p: 'facebook', w: 'mid', s: 'queued' },
                  { t: '21:00', p: 'linkedin', w: 'short', s: 'queued' },
                ].map((r) => (
                  <div className="mk-row" key={r.t}>
                    <span className="mk-row-key">{r.t}</span>
                    <span className="platform-chip"
                          style={{ background: 'var(--surface-3)', color: 'var(--text-soft)' }}>
                      <PlatformIcon platform={r.p} size={11} /> {r.p}
                    </span>
                    <span className="mk-bars">
                      <span className="mk-bar" />
                      <span className={`mk-bar ${r.w}`} />
                    </span>
                    <span className={`pill ${r.s === 'live' ? 'ok' : 'neutral'}`}>
                      <span className="dot" />{r.s}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------------ platforms */}
      <section className="mk-section alt tight">
        <div className="mk-inner">
          <p className="mk-note" style={{ textAlign: 'center', marginBottom: 'var(--s5)' }}>
            One place to publish everywhere
          </p>
          <div className="mk-logos">
            {PLATFORMS.map((p) => (
              <span className="mk-logo" key={p}>
                <PlatformIcon platform={p} size={18} />
                <span style={{ textTransform: 'capitalize' }}>{p === 'x' ? 'X' : p}</span>
              </span>
            ))}
            <span className="mk-logo">+ Threads · YouTube</span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- services */}
      <section className="mk-section" id="services">
        <div className="mk-inner">
          <span className="mk-eyebrow">What you get</span>
          <h2 className="mk-h2 wide">Everything between an idea and a published post</h2>
          <p className="mk-sub">
            Not a caption generator you still have to copy and paste. Postly does the whole
            job — writes it, illustrates it, schedules it, sends it, and checks it landed.
          </p>

          <div className="mk-bento">
            <div className="mk-cell feature">
              <span className="mk-cell-icon"><NavIcon name="create" size={20} /></span>
              <h3>Copy that sounds like a person</h3>
              <p>
                The hook is capped at twelve words and every post must carry one concrete
                detail — a number, a time of day, a real moment. A ban list kills the dead
                phrases. Your own rules override all of it.
              </p>
            </div>

            <div className="mk-cell wide">
              <span className="mk-cell-icon"><NavIcon name="dashboard" size={20} /></span>
              <h3>Artwork made for the post</h3>
              <p>
                A real photographic scene matched to the caption, not a stock image. The frame
                that becomes the thumbnail is composed for it — subject close, face readable,
                background thrown away.
              </p>
            </div>

            <div className="mk-cell">
              <span className="mk-cell-icon"><NavIcon name="clock" size={20} /></span>
              <h3>Posts on time</h3>
              <p>
                Your own timezone, stable across daylight saving. A missed run is caught up,
                not lost.
              </p>
            </div>

            <div className="mk-cell">
              <span className="mk-cell-icon"><NavIcon name="review" size={20} /></span>
              <h3>Approve or automate</h3>
              <p>
                Every post can wait for your edit, or go straight out. Set it per automation.
              </p>
            </div>

            <div className="mk-cell">
              <span className="mk-cell-icon"><NavIcon name="bolt" size={20} /></span>
              <h3>Recovers by itself</h3>
              <p>
                Transient failures retry on a backoff. Real refusals stop and explain
                themselves.
              </p>
            </div>

            <div className="mk-cell wide">
              <span className="mk-cell-icon"><NavIcon name="check" size={20} /></span>
              <h3>Counts what actually exists</h3>
              <p>
                A platform accepting a post is not the same as publishing it. Postly reads the
                real outcome back, so the dashboard shows what is live — not what was sent.
              </p>
            </div>

            <div className="mk-cell wide">
              <span className="mk-cell-icon"><NavIcon name="key" size={20} /></span>
              <h3>Your keys, your quota</h3>
              <p>
                Bring your own Groq, OpenAI, Gemini or Anthropic key. Encrypted at rest, never
                sent to the browser, and the free tiers are genuinely enough.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- how */}
      <section className="mk-section alt" id="how">
        <div className="mk-inner">
          <span className="mk-eyebrow">How it works</span>
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

      {/* --------------------------------------------------------- open source */}
      <section className="mk-section">
        <div className="mk-inner mk-hero">
          <div>
            <span className="mk-eyebrow">Open source</span>
            <h2 className="mk-h2">Yours to read, change and run</h2>
            <p className="mk-lede">
              Every line is public. Run it on your own machine, change what you like, or just
              read it to see exactly what happens to your data. The AGPL means anyone who
              modifies Postly and runs it as a service has to share their changes too — so it
              cannot quietly become somebody else&apos;s closed product.
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
              <span className="mk-dot-win" /><span className="mk-dot-win" /><span className="mk-dot-win" />
              <span className="mk-shot-title">what it costs to run</span>
            </div>
            <div className="mk-shot-body">
              {[
                ['Hosting', 'Vercel hobby'],
                ['Database', 'Neon free tier'],
                ['Copy', 'Groq API key'],
                ['Artwork', 'no key needed'],
                ['Scheduler', 'GitHub Actions'],
              ].map(([k, v]) => (
                <div className="mk-row" key={k}>
                  <span className="mk-row-key" style={{ minWidth: 74 }}>{k}</span>
                  <span className="mk-bars" style={{ fontSize: 13, color: 'var(--text-dim)' }}>{v}</span>
                  <span className="pill accent">free</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------- faq */}
      <section className="mk-section alt" id="faq">
        <div className="mk-inner" style={{ maxWidth: 800 }}>
          <span className="mk-eyebrow">Questions</span>
          <h2 className="mk-h2">The things people ask first</h2>
          <div className="mk-faq" style={{ marginTop: 'var(--s6)' }}>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>
                  {f.q}
                  <span className="mk-faq-plus" aria-hidden="true">
                    <NavIcon name="create" size={17} />
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
            <a className="btn btn-citron btn-lg" href="/login?mode=signup">Start free</a>
            <p className="mk-note">No credit card. Nothing to cancel.</p>
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
