import { useState, useRef, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { apiFetch } from '../lib/api';

const CARD_CYCLE = [
  { bg: '#ff4d8b', text: '#ffffff' },
  { bg: '#1a3a3a', text: '#ffffff' },
  { bg: '#b8a4ed', text: '#0a0a0a' },
  { bg: '#ffb084', text: '#0a0a0a' },
  { bg: '#e8b94a', text: '#0a0a0a' },
  { bg: '#f5f0e0', text: '#0a0a0a' },
];

const FEATURES = [
  {
    label: 'Reads any page',
    body: "Drop in a URL from Reddit, HN, a competitor blog, or anywhere signal hides. OpHunt extracts the opportunity you're too close to see.",
    icon: '⊙',
  },
  {
    label: 'Surfaces the gap',
    body: 'Identify the pain, map the ICP, benchmark against what exists, and score the idea on opportunity, feasibility, and novelty — in one brief.',
    icon: '◎',
  },
  {
    label: 'Hands you to a builder',
    body: 'Unlock the full brief and get handed straight to a founder agent that scopes, specs, and ships an MVP in days, not months.',
    icon: '⊕',
  },
];

const STEPS = [
  { num: '01', title: 'Paste a URL — anything with signal', body: 'Reddit threads, HN discussions, niche blogs, competitor changelogs. If it has frustrated users or missing features, OpHunt finds the angle.' },
  { num: '02', title: 'Get your $1 opportunity brief', body: 'A founder-grade report lands in seconds: scored opportunity, pain mapping, ICP breakdown, and a locked MVP brief ready to unlock.' },
  { num: '03', title: 'Click Build — ship it', body: 'Unlock the full brief and hand off to your AI co-founder. From URL to working prototype faster than the next coffee.' },
];

const PRICING_FEATURES = [
  'Opportunity + feasibility + novelty scores',
  'ICP breakdown and pain point mapping',
  'Competitor gap analysis',
  'MVP concept (unlocked)',
  'Go-to-market first 100 strategy (unlocked)',
  'Handoff to founder build agent',
];

export default function Landing() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const res = await apiFetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });

      const data = await res.json() as { id?: string; error?: string };

      if (!res.ok || !data.id) {
        setError(data.error || 'Analysis failed. Check that your URL is reachable and try again.');
        setIsLoading(false);
        return;
      }

      navigate(`/report/${data.id}`);
    } catch {
      setError('Something went wrong. Try again in a moment.');
      setIsLoading(false);
    }
  }

  return (
    <div style={{ background: '#fffaf0', minHeight: '100vh' }}>
      <Nav />

      {/* ── Hero ── */}
      <section
        className="flex flex-col items-center text-center"
        style={{ padding: '96px 24px 96px', maxWidth: '800px', margin: '0 auto' }}
      >
        <p
          className="font-body font-semibold uppercase mb-6 fade-up"
          style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
        >
          Opportunity Intelligence for Founders
        </p>

        <h1
          className="font-heading font-medium fade-up-d1"
          style={{
            fontSize: 'clamp(42px, 7vw, 72px)',
            letterSpacing: 'clamp(-1.5px, -0.03em, -2.5px)',
            lineHeight: 1.05,
            color: '#0a0a0a',
            marginBottom: '24px',
          }}
        >
          Find the gap before<br /> anyone else does
        </h1>

        <p
          className="font-body fade-up-d2"
          style={{
            fontSize: '17px',
            lineHeight: '1.65',
            color: 'rgba(10,10,10,0.6)',
            maxWidth: '520px',
            marginBottom: '40px',
          }}
        >
          OpHunt reads any page, surfaces buildable ideas, and hands you straight to a founder agent that ships them.
        </p>

        {/* URL input pill */}
        <form
          onSubmit={handleSubmit}
          className={`w-full fade-up-d3 ${isLoading ? 'shimmer-active' : ''}`}
          style={{
            maxWidth: '600px',
            background: '#ffffff',
            borderRadius: '999px',
            border: '1px solid rgba(10,10,10,0.12)',
            boxShadow: 'inset 0 2px 8px rgba(10,10,10,0.06), 0 1px 3px rgba(10,10,10,0.05)',
            display: 'flex',
            alignItems: 'center',
            padding: '6px 6px 6px 20px',
            gap: '8px',
          }}
        >
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste any URL — Reddit thread, HN post, blog…"
            disabled={isLoading}
            className="font-body flex-1 bg-transparent outline-none"
            style={{ fontSize: '15px', color: '#0a0a0a', minWidth: 0 }}
            aria-label="URL to analyze"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="font-body font-semibold flex-shrink-0 transition-opacity"
            style={{
              background: isLoading ? 'rgba(255,77,139,0.5)' : '#ff4d8b',
              color: '#ffffff',
              border: 'none',
              borderRadius: '999px',
              padding: '11px 22px',
              fontSize: '15px',
              letterSpacing: '0.2px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Analyzing…' : 'Hunt it →'}
          </button>
        </form>

        {error && (
          <p
            className="font-body mt-4 text-sm"
            style={{ color: '#ff4d8b', maxWidth: '500px' }}
          >
            {error}
          </p>
        )}

        <Link
          to="/explore"
          className="font-body no-underline fade-up-d3"
          style={{
            marginTop: '16px',
            border: '1px solid rgba(10,10,10,0.15)',
            borderRadius: '999px',
            padding: '10px 22px',
            background: 'transparent',
            color: 'rgba(10,10,10,0.6)',
            fontSize: '14px',
            display: 'inline-block',
            transition: 'border-color 0.15s',
          }}
        >
          Browse ideas →
        </Link>

        <p
          className="font-body mt-4 fade-up-d3"
          style={{ fontSize: '13px', color: 'rgba(10,10,10,0.35)' }}
        >
          $1 per report · No subscription · Instant results
        </p>
      </section>

      {/* ── Hero visual / mock browser ── */}
      <section style={{ padding: '0 24px', marginBottom: '96px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div
            style={{
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 32px 80px rgba(10,10,10,0.12)',
              border: '1px solid rgba(10,10,10,0.08)',
            }}
          >
            {/* Browser chrome */}
            <div
              style={{
                background: '#f0ebe0',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 16px',
                gap: '8px',
              }}
            >
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f57', flexShrink: 0 }} />
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#febc2e', flexShrink: 0 }} />
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#28c840', flexShrink: 0 }} />
              <div
                style={{
                  flex: 1,
                  background: 'rgba(10,10,10,0.06)',
                  borderRadius: '6px',
                  height: '24px',
                  margin: '0 16px',
                }}
              />
            </div>
            {/* Report preview */}
            <div style={{ background: '#fffaf0', padding: '32px' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  position: 'relative',
                }}
              >
                <h3
                  className="font-heading font-medium"
                  style={{ fontSize: 'clamp(18px, 3vw, 26px)', letterSpacing: '-1px', color: '#0a0a0a', margin: 0 }}
                >
                  AI-Powered Code Review for Solo Devs
                </h3>

                {/* Score ring + pills row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                  {/* SVG score ring */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <svg width="72" height="72" viewBox="0 0 72 72">
                      <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(10,10,10,0.07)" strokeWidth="7" />
                      <circle
                        cx="36"
                        cy="36"
                        r="28"
                        fill="none"
                        stroke="#ff4d8b"
                        strokeWidth="7"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 28 * 0.87} ${2 * Math.PI * 28}`}
                        transform="rotate(-90 36 36)"
                      />
                    </svg>
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span
                        className="font-heading font-medium"
                        style={{ fontSize: '18px', letterSpacing: '-0.5px', color: '#0a0a0a' }}
                      >
                        87
                      </span>
                    </div>
                  </div>

                  {/* Score pills */}
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Feasibility', val: '8.2' },
                      { label: 'Novelty', val: '9.1' },
                      { label: 'Market Fit', val: '7.8' },
                    ].map((s) => (
                      <div
                        key={s.label}
                        style={{
                          background: '#ffffff',
                          border: '1px solid rgba(10,10,10,0.1)',
                          borderRadius: '999px',
                          padding: '6px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span className="font-body" style={{ fontSize: '12px', color: 'rgba(10,10,10,0.45)' }}>{s.label}</span>
                        <span className="font-heading font-medium" style={{ fontSize: '14px', color: '#0a0a0a', letterSpacing: '-0.3px' }}>{s.val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Blurred content + CTA overlay */}
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      filter: 'blur(4px)',
                      pointerEvents: 'none',
                      userSelect: 'none',
                    }}
                  >
                    {['ICP: Solo developers shipping side projects without a team', 'Pain: PRs pile up, context-switching kills momentum — no one is reviewing', 'Gap: No tool exists that gives async, AI-driven review at the solo-dev price point'].map((line) => (
                      <p key={line} className="font-body" style={{ fontSize: '14px', color: 'rgba(10,10,10,0.55)', marginBottom: '8px', lineHeight: '1.6' }}>{line}</p>
                    ))}
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <button
                      disabled
                      data-ophunt-checkout="ophunt-report-1"
                      className="font-body font-semibold cursor-not-allowed"
                      style={{
                        background: '#ff4d8b',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '999px',
                        padding: '12px 28px',
                        fontSize: '15px',
                        boxShadow: '0 8px 24px rgba(255,77,139,0.35)',
                      }}
                    >
                      Unlock for $1
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature cards ── */}
      <section style={{ padding: '0 24px 96px' }}>
        <div className="max-w-6xl mx-auto">
          <p
            className="font-body font-semibold uppercase text-center mb-4"
            style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
          >
            What OpHunt does
          </p>
          <h2
            className="font-heading font-medium text-center"
            style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-1.5px', color: '#0a0a0a', marginBottom: '48px' }}
          >
            Read, score, and build — in one brief
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {FEATURES.map((feat, i) => {
              const { bg, text } = CARD_CYCLE[i];
              return (
                <div
                  key={feat.label}
                  className="card-lift"
                  style={{
                    background: bg,
                    borderRadius: '24px',
                    padding: '36px 32px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  <span style={{ fontSize: '28px', color: text, opacity: 0.7 }}>{feat.icon}</span>
                  <h3
                    className="font-heading font-medium"
                    style={{ fontSize: '24px', letterSpacing: '-1px', color: text, margin: 0 }}
                  >
                    {feat.label}
                  </h3>
                  <p
                    className="font-body"
                    style={{ fontSize: '15px', lineHeight: '1.65', color: text, opacity: 0.8, margin: 0 }}
                  >
                    {feat.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ padding: '0 24px 96px' }}>
        <div className="max-w-4xl mx-auto">
          <p
            className="font-body font-semibold uppercase text-center mb-4"
            style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
          >
            How it works
          </p>
          <h2
            className="font-heading font-medium text-center"
            style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-1.5px', color: '#0a0a0a', marginBottom: '56px' }}
          >
            From URL to fundable idea in under a minute
          </h2>

          <div className="flex flex-col gap-10">
            {STEPS.map((step) => (
              <div
                key={step.num}
                className="flex gap-8 items-start"
              >
                <span
                  className="font-body font-semibold flex-shrink-0"
                  style={{ fontSize: '13px', letterSpacing: '1px', color: 'rgba(10,10,10,0.25)', paddingTop: '4px', minWidth: '28px' }}
                >
                  {step.num}
                </span>
                <div>
                  <h3
                    className="font-heading font-medium"
                    style={{ fontSize: '22px', letterSpacing: '-0.75px', color: '#0a0a0a', marginBottom: '8px' }}
                  >
                    {step.title}
                  </h3>
                  <p
                    className="font-body"
                    style={{ fontSize: '16px', lineHeight: '1.65', color: 'rgba(10,10,10,0.55)', margin: 0 }}
                  >
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Idea Feed section ── */}
      <section style={{ padding: '0 24px 96px' }}>
        <div className="max-w-6xl mx-auto">
          <p
            className="font-body font-semibold uppercase text-center mb-4"
            style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
          >
            Explore
          </p>
          <h2
            className="font-heading font-medium text-center"
            style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-1.5px', color: '#0a0a0a', marginBottom: '16px' }}
          >
            A daily feed of buildable ideas
          </h2>
          <p
            className="font-body text-center mx-auto"
            style={{ fontSize: '17px', lineHeight: '1.65', color: 'rgba(10,10,10,0.6)', maxWidth: '540px', marginBottom: '40px' }}
          >
            OpHunt's background engine scans Reddit, Hacker News, Product Hunt, and tech news every day. Every signal becomes a scored opportunity brief — browsable by category, sortable by novelty or timing.
          </p>

          {/* Horizontal scroll feed cards */}
          <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '32px' }}>
            {[
              { color: '#ff4d8b', textColor: '#ffffff', category: 'AI Tools', title: 'Voice-to-Jira: meeting notes that auto-file tickets', score: 91 },
              { color: '#1a3a3a', textColor: '#ffffff', category: 'Dev Tools', title: 'Diff-aware code review for solo devs shipping fast', score: 88 },
              { color: '#b8a4ed', textColor: '#0a0a0a', category: 'B2B SaaS', title: 'Churn prediction for Stripe-native SaaS under $1M ARR', score: 85 },
            ].map((card) => (
              <div
                key={card.title}
                className="card-lift"
                style={{
                  background: card.color,
                  borderRadius: '20px',
                  padding: '28px 24px',
                  minWidth: '280px',
                  maxWidth: '320px',
                  flex: '0 0 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    className="font-body font-semibold"
                    style={{
                      fontSize: '11px',
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      color: card.textColor,
                      opacity: 0.6,
                    }}
                  >
                    {card.category}
                  </span>
                  <span
                    className="font-heading font-medium"
                    style={{
                      fontSize: '13px',
                      background: 'rgba(255,255,255,0.2)',
                      color: card.textColor,
                      borderRadius: '999px',
                      padding: '4px 10px',
                      letterSpacing: '-0.3px',
                    }}
                  >
                    {card.score}
                  </span>
                </div>
                <h3
                  className="font-heading font-medium"
                  style={{ fontSize: '18px', letterSpacing: '-0.75px', color: card.textColor, margin: 0, lineHeight: '1.3' }}
                >
                  {card.title}
                </h3>
                <Link
                  to="/explore"
                  className="font-body font-semibold no-underline"
                  style={{
                    fontSize: '13px',
                    color: card.textColor,
                    opacity: 0.7,
                    marginTop: 'auto',
                    display: 'inline-block',
                  }}
                >
                  View brief →
                </Link>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link
              to="/explore"
              className="font-body font-semibold no-underline inline-block transition-opacity hover:opacity-90"
              style={{
                background: '#0a0a0a',
                color: '#ffffff',
                borderRadius: '12px',
                padding: '12px 24px',
                fontSize: '15px',
              }}
            >
              Browse all ideas →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Explore CTA ── */}
      <section style={{ padding: '0 24px 96px' }}>
        <div className="max-w-6xl mx-auto">
          <div
            style={{
              background: '#1a3a3a',
              borderRadius: '24px',
              padding: '64px 48px',
              textAlign: 'center',
            }}
          >
            <p
              className="font-body font-semibold uppercase mb-4"
              style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(255,255,255,0.4)' }}
            >
              Already in the feed
            </p>
            <h2
              className="font-heading font-medium"
              style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-1.5px', color: '#ffffff', marginBottom: '16px' }}
            >
              Browse ideas found today
            </h2>
            <p
              className="font-body mx-auto"
              style={{ fontSize: '17px', lineHeight: '1.65', color: 'rgba(255,255,255,0.6)', maxWidth: '440px', marginBottom: '32px' }}
            >
              OpHunt's feed surfaces opportunities from across the internet. Browse, score, and build the one that fits.
            </p>
            <Link
              to="/explore"
              className="font-body font-semibold inline-block no-underline transition-opacity hover:opacity-90"
              style={{
                background: '#ff4d8b',
                color: '#ffffff',
                padding: '14px 32px',
                borderRadius: '12px',
                fontSize: '15px',
                letterSpacing: '0.2px',
              }}
            >
              Explore the feed →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{ padding: '0 24px 96px' }}>
        <div className="max-w-xl mx-auto text-center">
          <p
            className="font-body font-semibold uppercase mb-4"
            style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
          >
            Pricing
          </p>
          <h2
            className="font-heading font-medium"
            style={{ fontSize: 'clamp(28px, 4vw, 40px)', letterSpacing: '-1.5px', color: '#0a0a0a', marginBottom: '48px' }}
          >
            Pay only for what you read
          </h2>

          <div
            style={{
              background: '#ffffff',
              border: '1px solid rgba(10,10,10,0.1)',
              borderRadius: '24px',
              padding: '48px 40px',
              boxShadow: '0 4px 24px rgba(10,10,10,0.06)',
            }}
          >
            <div className="flex items-baseline justify-center gap-1 mb-2">
              <span
                className="font-heading font-medium"
                style={{ fontSize: '64px', letterSpacing: '-2.5px', color: '#0a0a0a' }}
              >
                $1
              </span>
              <span className="font-body" style={{ fontSize: '17px', color: 'rgba(10,10,10,0.45)' }}>/ report</span>
            </div>
            <p className="font-body mb-8" style={{ fontSize: '15px', color: 'rgba(10,10,10,0.5)' }}>
              No subscriptions. No lock-in. Buy a brief, build a company.
            </p>

            <ul className="text-left flex flex-col gap-3 mb-8">
              {PRICING_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 font-body" style={{ fontSize: '15px', color: 'rgba(10,10,10,0.7)' }}>
                  <span style={{ color: '#ff4d8b', marginTop: '2px', flexShrink: 0 }}>✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              disabled
              data-ophunt-checkout="ophunt-report-1"
              className="w-full font-body font-semibold cursor-not-allowed"
              style={{
                background: 'rgba(255,77,139,0.3)',
                color: 'rgba(255,255,255,0.7)',
                border: 'none',
                borderRadius: '12px',
                padding: '16px',
                fontSize: '15px',
                letterSpacing: '0.2px',
              }}
            >
              Pre-order — checkout opening soon
            </button>
            <p className="font-body mt-3" style={{ fontSize: '12px', color: 'rgba(10,10,10,0.35)' }}>
              Secured checkout · Payments by Lemon Squeezy
            </p>
          </div>
        </div>
      </section>

      {/* ── "From huh, neat" band ── */}
      <section style={{ padding: '0 24px 96px' }}>
        <div
          style={{
            background: '#f5f0e0',
            borderRadius: '24px',
            padding: '80px 48px',
            textAlign: 'center',
          }}
        >
          <p
            className="font-body font-semibold uppercase"
            style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)', marginBottom: '20px' }}
          >
            The OpHunt moment
          </p>
          <h2
            className="font-heading font-medium"
            style={{
              fontSize: 'clamp(32px, 5vw, 52px)',
              letterSpacing: '-2px',
              color: '#0a0a0a',
              marginBottom: '20px',
              lineHeight: 1.1,
            }}
          >
            From "huh, neat" to first commit.
          </h2>
          <p
            className="font-body mx-auto"
            style={{
              fontSize: '17px',
              lineHeight: '1.65',
              color: 'rgba(10,10,10,0.6)',
              maxWidth: '480px',
              marginBottom: '40px',
            }}
          >
            Most founders scroll past the gap. OpHunt stops the scroll, names the opportunity, and hands you a brief that's ready to build.
          </p>

          {/* Mini stat cards */}
          <div
            style={{
              display: 'inline-flex',
              gap: '24px',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {[
              { stat: '< 30s', label: 'Time to first brief' },
              { stat: '$1', label: 'Per full report' },
              { stat: '∞', label: 'URLs you can analyze' },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  background: '#ffffff',
                  borderRadius: '16px',
                  padding: '24px 32px',
                  boxShadow: '0 2px 12px rgba(10,10,10,0.06)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span
                  className="font-heading font-medium"
                  style={{ fontSize: '32px', letterSpacing: '-1px', color: '#0a0a0a' }}
                >
                  {item.stat}
                </span>
                <span
                  className="font-body"
                  style={{ fontSize: '13px', color: 'rgba(10,10,10,0.5)', whiteSpace: 'nowrap' }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}