'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlatformIcon } from '../../../components/BrandIcons';

const PLATFORM_COLORS = {
  pinterest: '#E60023', instagram: '#E4405F', facebook: '#1877F2',
  x: '#000000', linkedin: '#0A66C2', tiktok: '#010101',
};

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi">
      <p className="kpi-label">{label}</p>
      <p className={`kpi-value${tone ? ' ' + tone : ''}`}>{value}</p>
      {sub && <p className="kpi-sub">{sub}</p>}
    </div>
  );
}

// Two-series sparkline. Inline SVG keeps the page dependency-free, and every
// series is labelled in the legend rather than relying on colour alone.
function TrendChart({ daily }) {
  const w = 720, h = 170, pad = { t: 12, r: 12, b: 22, l: 28 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.posts, d.clicks)));
  const x = (i) => pad.l + (daily.length < 2 ? iw / 2 : (i * iw) / (daily.length - 1));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const path = (key) =>
    daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const ticks = [0, Math.ceil(max / 2), max];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img"
           aria-label={`Posts and clicks over the last ${daily.length} days`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 3} className="axis" textAnchor="end">{v}</text>
          </g>
        ))}
        <path d={path('posts')} className="series posts" />
        <path d={path('clicks')} className="series clicks" />
        {daily.map((d, i) => (
          <g key={d.day}>
            <circle cx={x(i)} cy={y(d.posts)} r="2.5" className="dot posts" />
            <circle cx={x(i)} cy={y(d.clicks)} r="2.5" className="dot clicks" />
          </g>
        ))}
        {daily.map((d, i) =>
          i % 3 === 0 ? (
            <text key={d.day} x={x(i)} y={h - 6} className="axis" textAnchor="middle">
              {d.day.slice(5)}
            </text>
          ) : null
        )}
      </svg>
      <div className="legend">
        <span className="legend-item"><span className="swatch posts" />Posts created</span>
        <span className="legend-item"><span className="swatch clicks" />Link clicks</span>
      </div>
    </div>
  );
}

function Bars({ rows, valueKey, label }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  if (rows.length === 0) return <p className="empty">No {label} yet.</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.platform}>
          <span className="bar-label">
            <span style={{ color: PLATFORM_COLORS[r.platform], display: 'inline-flex' }}>
              <PlatformIcon platform={r.platform} size={14} />
            </span>
            {r.platform}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r[valueKey] / max) * 100}%` }} />
          </span>
          <span className="bar-value">{r[valueKey]}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [d, setD] = useState(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => { if (r.status === 401) { router.push('/login'); return null; } return r.json(); })
      .then((json) => json && setD(json));
  }, [router]);

  if (!d) {
    return (
      <>
        <div className="page-head"><h1>Dashboard</h1></div>
        <div className="skeleton" style={{ height: 120, marginBottom: 18 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </>
    );
  }

  const t = d.totals;
  const activeAutos = d.automations.filter((a) => a.enabled).length;

  return (
    <>
      <div className="page-head">
        <div className="head-row">
          <div>
            <h1>Dashboard</h1>
            <p>Everything Postly has published for you, and the traffic it brought back.</p>
          </div>
          <a className="btn btn-accent" href="/create">Create post</a>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Live posts" value={t.published + t.scheduled}
             sub={`${t.published} published · ${t.scheduled} scheduled`} />
        <Kpi label="Link clicks" value={t.clicks} sub="tracked from your posts" tone="accent" />
        <Kpi label="Awaiting review" value={t.drafts}
             sub={t.drafts > 0 ? 'in Review' : 'nothing waiting'} />
        <Kpi label="Automations" value={`${activeAutos}/${d.automations.length}`}
             sub={activeAutos > 0 ? 'active' : 'all paused'} />
        <Kpi label="Failed" value={t.failed + t.unconfirmed}
             sub={t.unconfirmed > 0 ? `${t.unconfirmed} unconfirmed` : 'publish errors'}
             tone={t.failed + t.unconfirmed > 0 ? 'danger' : undefined} />
      </div>

      <section className="panel">
        <p className="panel-title">Last 14 days</p>
        <TrendChart daily={d.daily} />
      </section>

      <div className="two-col">
        <section className="panel">
          <p className="panel-title">Posts by platform</p>
          <Bars rows={d.byPlatform} valueKey="live" label="posts" />
        </section>
        <section className="panel">
          <p className="panel-title">Clicks by platform</p>
          <Bars rows={d.clicksByPlatform} valueKey="clicks" label="clicks" />
          {t.clicks === 0 && (
            <p className="hint">
              Clicks appear once someone follows a link in a published post. Instagram
              captions aren&apos;t clickable, so Pinterest and TikTok drive most traffic.
            </p>
          )}
        </section>
      </div>

      {d.topPosts.length > 0 && (
        <section className="panel">
          <p className="panel-title">Best performing posts</p>
          <div className="top-list">
            {d.topPosts.map((p) => (
              <div className="top-row" key={p.id}>
                {p.image_url
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img className="top-thumb" src={p.image_url} alt="" />
                  : <span className="top-thumb placeholder" />}
                <span className="platform-chip" style={{ background: PLATFORM_COLORS[p.platform] }}>
                  <PlatformIcon platform={p.platform} size={12} /> {p.platform}
                </span>
                <span className="top-title">{p.pin_title || p.theme}</span>
                <span className="top-clicks"><strong>{p.clicks}</strong> clicks</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="two-col">
        <section className="panel">
          <p className="panel-title">Coming up</p>
          {d.upcoming.length === 0 ? (
            <p className="empty">Nothing scheduled. <a href="/automations">Set up an automation →</a></p>
          ) : (
            <div className="mini-list">
              {d.upcoming.map((p) => (
                <div className="mini-row" key={p.id}>
                  <span className="mini-time">
                    {new Date(p.scheduled_at).toLocaleString([], { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="platform-chip" style={{ background: PLATFORM_COLORS[p.platform] }}>
                    <PlatformIcon platform={p.platform} size={12} /> {p.platform}
                  </span>
                  <span className="mini-text">{p.pin_title || p.theme}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <p className="panel-title">Recent activity</p>
          <div className="mini-list">
            {d.recent.map((p) => (
              <div className="mini-row" key={p.id}>
                <span className={`pill ${p.status === 'published' || p.status === 'scheduled' ? 'connected' : p.status === 'failed' ? 'failed' : 'disconnected'}`}>
                  <span className="dot" />{p.status}
                </span>
                <span className="platform-chip" style={{ background: PLATFORM_COLORS[p.platform] }}>
                  <PlatformIcon platform={p.platform} size={12} /> {p.platform}
                </span>
                <span className="mini-text">{p.pin_title || p.theme}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
