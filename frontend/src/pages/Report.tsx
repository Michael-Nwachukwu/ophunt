import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import ScoreRing from '../components/ScoreRing';
import { apiFetch } from '../lib/api';
import { useAuthContext } from '../App';

interface IdeaDetail {
  id: string;
  url: string;
  sourceTitle: string;
  title: string;
  summary: string;
  painPoints: string[];
  targetAudience: string;
  competitorGap: string;
  mvpConcept: string;
  gtmStrategy: string;
  // v2 full pitch-spec fields
  opportunity: string;
  problem: string;
  marketFit: string;
  businessModel: string;
  valueProp: string;
  whyNow: string;
  timing: string;
  communitySignal: string;
  proofSignals: string[];
  keywords: string[];
  category: string;
  source: string;
  scores: { opportunity: number; feasibility: number; novelty: number; timing: number; marketFit: number };
  tags: string[];
  isUnlocked: boolean;
  createdAt: string;
}

function LockIcon({ isHovered }: { isHovered: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="11" width="16" height="11" rx="3" fill="currentColor" opacity="0.9" />
      <path
        className="lock-shackle"
        d="M8 11V7a4 4 0 0 1 8 0v4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
        style={{ transform: isHovered ? 'translateY(-3px)' : 'translateY(0)', transition: 'transform 0.2s ease' }}
      />
    </svg>
  );
}

const SKIP_WORDS = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'in', 'of', 'to', 'is', 'on', 'at', 'by', 'or']);

function extractRootWord(title: string): string {
  const words = title.trim().split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z]/g, '');
    if (clean.length > 0 && !SKIP_WORDS.has(clean.toLowerCase())) {
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }
  }
  return words[0] || 'Startup';
}

function generateNames(title: string): string[] {
  const root = extractRootWord(title);
  return ['HQ', 'Lab', 'ly', 'AI', 'Base'].map(s => `${root}${s}`);
}

function summaryTagline(summary: string): string {
  const words = summary.trim().split(/\s+/);
  return words.slice(0, 6).join(' ') + '...';
}

function truncate(text: string, len: number): string {
  if (!text) return '';
  return text.length > len ? text.slice(0, len).trimEnd() + '...' : text;
}

export default function Report() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthContext();
  const [idea, setIdea] = useState<IdeaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lockHovered, setLockHovered] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'validate' | 'launch'>('overview');
  const [paystackEmail, setPaystackEmail] = useState('');
  const [paystackLoading, setPaystackLoading] = useState(false);
  const [paystackError, setPaystackError] = useState('');
  const [activePlatform, setActivePlatform] = useState<'reddit' | 'twitter'>('reddit');
  const [copiedNames, setCopiedNames] = useState<Record<number, boolean>>({});
  const [copiedPosts, setCopiedPosts] = useState<Record<string, boolean>>({});
  const [copiedSurveyLink, setCopiedSurveyLink] = useState(false);
  const [copiedWaitlistLink, setCopiedWaitlistLink] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const blurRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const overviewRef = useRef<HTMLDivElement>(null);
  const validateRef = useRef<HTMLDivElement>(null);
  const launchRef = useRef<HTMLDivElement>(null);

  const startPolling = () => {
    if (pollingRef.current) return; // already polling
    pollCountRef.current = 0;
    pollingRef.current = setInterval(async () => {
      pollCountRef.current++;
      if (pollCountRef.current > 30) { // 30 × 2s = 60s max
        clearInterval(pollingRef.current!);
        pollingRef.current = null;
        return;
      }
      try {
        const res = await apiFetch(`/api/ideas/${id}/unlock-status`);
        const data = await res.json();
        if (data.isUnlocked) {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setIdea(prev => prev ? { ...prev, isUnlocked: true } : prev);
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 2000);
  };

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/ideas/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: IdeaDetail) => {
        setIdea(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(String(err));
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (!id || !user) return;
    apiFetch('/api/me/saved', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { ideas: { id: string }[] } | null) => {
        if (d) setIsSaved(d.ideas.some(i => i.id === id));
      })
      .catch(() => {});
  }, [id, user]);

  async function handleToggleSave() {
    if (!user) { window.location.href = '/sign-in'; return; }
    if (isSaved) {
      await apiFetch(`/api/ideas/${id}/save`, { method: 'DELETE', credentials: 'include' });
      setIsSaved(false);
    } else {
      await apiFetch(`/api/ideas/${id}/save`, { method: 'POST', credentials: 'include' });
      setIsSaved(true);
    }
  }

  useEffect(() => {
    if (!id) return;

    // Listen for Lemon Squeezy checkout close event
    const handleMessage = (event: MessageEvent) => {
      if (event.data && (event.data.event === 'Checkout.Success' || event.data.type === 'checkout:completed')) {
        startPolling();
      }
    };

    window.addEventListener('message', handleMessage);

    // Also set up LemonSqueezy.Setup callback if available
    const setupLS = () => {
      if ((window as any).LemonSqueezy) {
        (window as any).LemonSqueezy.Setup({
          eventHandler: (event: any) => {
            if (event?.event === 'Checkout.Success') {
              startPolling();
            }
          }
        });
      }
    };

    setupLS();
    const timer = setTimeout(setupLS, 2000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timer);
    };
  }, [id]);

  // IntersectionObserver to highlight active tab while scrolling
  useEffect(() => {
    const sections: [HTMLDivElement | null, 'overview' | 'validate' | 'launch'][] = [
      [overviewRef.current, 'overview'],
      [validateRef.current, 'validate'],
      [launchRef.current, 'launch'],
    ];
    const observers: IntersectionObserver[] = [];
    sections.forEach(([el, name]) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveTab(name); },
        { threshold: 0.3, rootMargin: '-80px 0px -60% 0px' }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [loading]);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const copyName = (name: string, idx: number) => {
    navigator.clipboard.writeText(name);
    setCopiedNames(prev => ({ ...prev, [idx]: true }));
    setTimeout(() => setCopiedNames(prev => ({ ...prev, [idx]: false })), 2000);
  };

  const copyPost = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPosts(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopiedPosts(prev => ({ ...prev, [key]: false })), 2000);
  };

  const handleCopyPrompt = () => {
    const i = idea!;
    const prompt = [
      `# ${i.title}`,
      `\n## Problem\n${i.problem || i.summary}`,
      `\n## Opportunity\n${i.opportunity || i.summary}`,
      `\n## Target User\n${i.targetAudience}`,
      `\n## Value Proposition\n${i.valueProp}`,
      `\n## Why Now\n${i.whyNow}`,
      `\n## MVP Scope\n${i.mvpConcept}`,
      `\n## First 100 Customers\n${i.gtmStrategy}`,
      `\n## Business Model\n${i.businessModel}`,
    ].join('');
    navigator.clipboard.writeText(prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  if (loading) {
    return (
      <div style={{ background: '#fffaf0', minHeight: '100vh' }}>
        <Nav />
        <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
          <div className="text-center">
            <div
              className="shimmer-active mx-auto mb-4"
              style={{ width: '280px', height: '24px', borderRadius: '12px', background: 'rgba(10,10,10,0.06)' }}
            />
            <div
              className="shimmer-active mx-auto"
              style={{ width: '180px', height: '16px', borderRadius: '8px', background: 'rgba(10,10,10,0.04)' }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (error || !idea) {
    return (
      <div style={{ background: '#fffaf0', minHeight: '100vh' }}>
        <Nav />
        <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: '60vh', padding: '48px 24px' }}>
          <h1 className="font-heading font-medium mb-4" style={{ fontSize: '32px', letterSpacing: '-1px' }}>
            Report not found
          </h1>
          <p className="font-body mb-8" style={{ color: 'rgba(10,10,10,0.5)', fontSize: '16px' }}>
            {error || "This idea report doesn't exist or was removed."}
          </p>
          <Link
            to="/explore"
            className="font-body font-semibold no-underline"
            style={{ background: '#ff4d8b', color: '#ffffff', padding: '12px 28px', borderRadius: '12px', fontSize: '15px' }}
          >
            Browse the feed →
          </Link>
        </div>
      </div>
    );
  }

  // Derived values used across tabs
  const names = idea ? generateNames(idea.title) : [];
  const tagline = idea ? summaryTagline(idea.summary) : '';

  const redditPosts = idea ? [
    {
      key: 'r1',
      subreddit: 'r/startups',
      title: `I've been thinking about ${idea.title} — would love feedback`,
      body: `Been noticing a gap in ${idea.targetAudience} space. ${idea.summary} Curious if others have hit this problem. What would make you switch to a new tool for this?`,
    },
    {
      key: 'r2',
      subreddit: 'r/entrepreneur',
      title: `Validating a new idea: ${idea.title}`,
      body: `Working on something for ${idea.targetAudience}. The core problem: ${idea.summary} My MVP plan: ${idea.mvpConcept} Would you pay for this? What's missing?`,
    },
    {
      key: 'r3',
      subreddit: 'r/SideProject',
      title: `Building ${idea.title} — here's the plan`,
      body: `Side project update: tackling ${idea.summary} for ${idea.targetAudience}. ${idea.gtmStrategy} Happy to share more — drop a comment if you want early access.`,
    },
  ] : [];

  const tweets = idea ? [
    {
      key: 't1',
      text: `Just spotted a gap: ${truncate(idea.summary, 120)}. Building ${idea.title} for ${idea.targetAudience}. Who else has felt this pain? 🧵 #buildinpublic #startups`,
    },
    {
      key: 't2',
      text: `Validating ${idea.title} — the problem: ${truncate(idea.summary, 100)}. If you're ${idea.targetAudience}, I'd love 5 mins of your time. DMs open.`,
    },
    {
      key: 't3',
      text: `${idea.title} update: ${truncate(idea.mvpConcept, 120)}. Targeting ${idea.targetAudience}. Would you use this? Drop a reply 👇`,
    },
  ] : [];

  const tabStyle = (tab: 'overview' | 'validate' | 'launch'): React.CSSProperties => ({
    padding: '14px 24px',
    fontSize: '14px',
    fontWeight: 600,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    borderBottom: activeTab === tab ? '2px solid #ff4d8b' : '2px solid transparent',
    color: activeTab === tab ? '#0a0a0a' : '#888',
    transition: 'color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap' as const,
  });

  const score = idea ? idea.scores.opportunity : 0;
  const scoreColor = score >= 80 ? '#1a3a3a' : score >= 60 ? '#ff4d8b' : '#e8b94a';
  const circumference = 2 * Math.PI * 50;
  const dashOffset = circumference * (1 - score / 100);
  const tagsLower = idea ? idea.tags.map(t => t.toLowerCase()) : [];
  const isDevtools = tagsLower.some(t => t.includes('devtools') || t.includes('developer'));
  const isFintech = tagsLower.some(t => t.includes('fintech'));
  const tam = isFintech ? '$120B' : isDevtools ? '$50B' : '$30B';
  const sam = isFintech ? '$15B' : isDevtools ? '$8B' : '$5B';
  const som = isFintech ? '$500M' : isDevtools ? '$200M' : '$150M';
  const mvpLong = idea ? idea.mvpConcept.length > 200 : false;
  const feComplexity = mvpLong ? 'medium' : 'low';
  const beComplexity = 'medium';
  const infraComplexity = mvpLong ? 'medium' : 'low';
  const complexColor = (c: string) => c === 'low' ? '#4caf50' : c === 'medium' ? '#e8b94a' : '#e53935';
  const complexWidth = (c: string) => c === 'low' ? '33%' : c === 'medium' ? '66%' : '100%';

  return (
    <div style={{ background: '#fffaf0', minHeight: '100vh' }}>
      <Nav />

      {/* ── Sticky tab bar ── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: '#fffaf0',
          borderBottom: '1px solid #e8e0d0',
        }}
      >
        <div
          style={{
            display: 'flex',
            maxWidth: '860px',
            margin: '0 auto',
            padding: '0 24px',
            overflowX: 'auto',
          }}
        >
          <button style={tabStyle('overview')} onClick={() => scrollTo(overviewRef)}>Overview</button>
          <button style={tabStyle('validate')} onClick={() => scrollTo(validateRef)}>Validate</button>
          <button style={tabStyle('launch')} onClick={() => scrollTo(launchRef)}>Launch</button>
        </div>
      </div>

      <article style={{ maxWidth: '860px', margin: '0 auto', padding: '56px 24px 0' }}>

        {/* ══════════════════════════════════════════
            OVERVIEW SECTION
        ══════════════════════════════════════════ */}
        <div id="overview" ref={overviewRef}>

          {/* Breadcrumb */}
          <Link
            to="/explore"
            className="font-body no-underline inline-flex items-center gap-2 mb-10"
            style={{ fontSize: '14px', color: 'rgba(10,10,10,0.4)', fontWeight: 600 }}
          >
            ← Explore ideas
          </Link>

          {/* Category + source + tags */}
          <div className="flex flex-wrap gap-2 mb-6">
            {idea.category && (
              <span className="font-body" style={{ background: '#ff4d8b', color: '#fff', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px' }}>
                {idea.category}
              </span>
            )}
            {idea.source && idea.source !== 'url' && (
              <span className="font-body" style={{ background: 'rgba(10,10,10,0.08)', color: 'rgba(10,10,10,0.6)', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, letterSpacing: '0.5px' }}>
                via {idea.source}
              </span>
            )}
            {idea.tags.map((tag) => (
              <span key={tag} className="font-body" style={{ background: 'rgba(10,10,10,0.06)', color: 'rgba(10,10,10,0.55)', borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {tag}
              </span>
            ))}
          </div>

          {/* Title + save */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
            <h1
              className="font-heading font-medium"
              style={{ fontSize: 'clamp(28px, 5vw, 48px)', letterSpacing: '-1.5px', color: '#0a0a0a', lineHeight: 1.1, flex: 1, margin: 0 }}
            >
              {idea.title}
            </h1>
            <button
              onClick={handleToggleSave}
              title={isSaved ? 'Remove from saved' : 'Save idea'}
              style={{
                flexShrink: 0, marginTop: '8px',
                background: isSaved ? '#ff4d8b' : 'rgba(10,10,10,0.06)',
                border: 'none', borderRadius: '50%',
                width: '42px', height: '42px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px', transition: 'background 0.2s',
              }}
            >
              {isSaved ? '❤️' : '🤍'}
            </button>
          </div>

          {/* Source */}
          <p className="font-body mb-10" style={{ fontSize: '13px', color: 'rgba(10,10,10,0.35)' }}>
            From <span style={{ fontWeight: 600 }}>{idea.sourceTitle || idea.url}</span> ·{' '}
            {new Date(idea.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>

          {/* Score rings */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              border: '1px solid rgba(10,10,10,0.08)',
              marginBottom: '48px',
              overflow: 'hidden',
            }}
          >
            <div className="flex flex-col sm:flex-row items-center justify-around gap-8" style={{ padding: '40px 32px' }}>
              <ScoreRing value={idea.scores.opportunity} label="Opportunity" color="#ff4d8b" />
              <ScoreRing value={idea.scores.feasibility} label="Feasibility" color="#1a3a3a" />
              <ScoreRing value={idea.scores.novelty} label="Novelty" color="#b8a4ed" />
              <ScoreRing value={idea.scores.timing ?? 0} label="Timing" color="#f4a261" />
              <ScoreRing value={idea.scores.marketFit ?? 0} label="Market Fit" color="#2a9d8f" />
            </div>
            <div style={{ borderTop: '1px solid rgba(10,10,10,0.06)', padding: '10px 20px', display: 'flex', justifyContent: 'flex-end' }}>
              <a
                href="https://argens.xyz"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', fontWeight: 500, letterSpacing: '0.2px', color: 'rgba(10,10,10,0.3)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', transition: 'color 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(10,10,10,0.6)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(10,10,10,0.3)')}
              >
                ⚡ Analysis powered by argens.xyz
              </a>
            </div>
          </div>

          {/* Keywords — free preview */}
          {idea.keywords?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-10">
              {idea.keywords.map((kw) => (
                <span key={kw} className="font-body" style={{ background: '#f0ece0', color: 'rgba(10,10,10,0.55)', borderRadius: '8px', padding: '4px 10px', fontSize: '12px', fontWeight: 500 }}>
                  #{kw}
                </span>
              ))}
            </div>
          )}

          {/* Timing — free preview */}
          {idea.timing && (
            <div className="mb-10" style={{ background: '#f5f0e0', borderRadius: '12px', padding: '16px 20px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={{ color: '#f4a261', fontWeight: 700, flexShrink: 0 }}>⏱</span>
              <p className="font-body" style={{ fontSize: '14px', lineHeight: '1.6', color: 'rgba(10,10,10,0.65)', margin: 0 }}><strong>Timing:</strong> {idea.timing}</p>
            </div>
          )}

          {/* Summary */}
          <section className="mb-10">
            <h2
              className="font-body font-semibold uppercase mb-4"
              style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
            >
              The Opportunity
            </h2>
            <p className="font-body" style={{ fontSize: '17px', lineHeight: '1.7', color: 'rgba(10,10,10,0.8)' }}>
              {idea.summary}
            </p>
          </section>

          {/* Pain points */}
          <section className="mb-10">
            <h2
              className="font-body font-semibold uppercase mb-5"
              style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
            >
              Pain Points
            </h2>
            <div className="flex flex-col gap-4">
              {idea.painPoints.map((pt, i) => (
                <div
                  key={i}
                  className="flex gap-4 items-start"
                  style={{
                    background: '#ffffff',
                    borderRadius: '16px',
                    padding: '20px 24px',
                    border: '1px solid rgba(10,10,10,0.07)',
                  }}
                >
                  <span
                    className="font-body font-semibold flex-shrink-0"
                    style={{ fontSize: '12px', color: '#ff4d8b', paddingTop: '3px', fontVariantNumeric: 'tabular-nums' }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="font-body" style={{ fontSize: '15px', lineHeight: '1.6', color: 'rgba(10,10,10,0.75)', margin: 0 }}>
                    {pt}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Target audience */}
          <section className="mb-10">
            <h2
              className="font-body font-semibold uppercase mb-4"
              style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
            >
              Target Audience
            </h2>
            <div
              style={{
                background: '#f5f0e0',
                borderRadius: '16px',
                padding: '24px',
                borderLeft: '3px solid #ff4d8b',
              }}
            >
              <p className="font-body" style={{ fontSize: '15px', lineHeight: '1.65', color: 'rgba(10,10,10,0.75)', margin: 0 }}>
                {idea.targetAudience}
              </p>
            </div>
          </section>

          {/* ── Locked section ── */}
          <div ref={blurRef} style={{ position: 'relative' }}>
            <h2
              className="font-body font-semibold uppercase mb-5"
              style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}
            >
              Full Brief
            </h2>

            <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '20px' }}>
              <div
                style={{
                  filter: idea.isUnlocked ? 'none' : 'blur(12px)',
                  userSelect: idea.isUnlocked ? 'auto' : 'none',
                  pointerEvents: idea.isUnlocked ? 'auto' : 'none',
                  transition: 'filter 0.4s ease',
                }}
              >
                {/* Problem */}
                {idea.problem && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      The Problem
                    </h2>
                    <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.problem}</p>
                  </section>
                )}

                {/* Opportunity */}
                {idea.opportunity && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      Opportunity
                    </h2>
                    <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.opportunity}</p>
                  </section>
                )}

                {/* Competitor gap */}
                <section className="mb-8">
                  <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                    Competitor Gap
                  </h2>
                  <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.competitorGap}</p>
                </section>

                {/* Market fit */}
                {idea.marketFit && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      Market Fit
                    </h2>
                    <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.marketFit}</p>
                  </section>
                )}

                {/* Value proposition */}
                {idea.valueProp && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      Value Proposition
                    </h2>
                    <div style={{ background: '#f5f0e0', borderRadius: '16px', padding: '24px', borderLeft: '3px solid #ff4d8b' }}>
                      <p className="font-body" style={{ fontSize: '17px', lineHeight: '1.6', color: 'rgba(10,10,10,0.85)', margin: 0, fontStyle: 'italic' }}>{idea.valueProp}</p>
                    </div>
                  </section>
                )}

                {/* Why now */}
                {idea.whyNow && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      Why Now
                    </h2>
                    <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.whyNow}</p>
                  </section>
                )}

                {/* Business model */}
                {idea.businessModel && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      Business Model
                    </h2>
                    <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.businessModel}</p>
                  </section>
                )}

                {/* MVP concept */}
                <section className="mb-8">
                  <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                    MVP Concept
                  </h2>
                  <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.mvpConcept}</p>
                </section>

                {/* GTM strategy */}
                <section className="mb-8">
                  <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                    Go-to-Market: First 100 Customers
                  </h2>
                  <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.gtmStrategy}</p>
                </section>

                {/* Proof signals */}
                {idea.proofSignals?.length > 0 && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      Proof &amp; Signals
                    </h2>
                    <div className="flex flex-col gap-3">
                      {idea.proofSignals.map((sig, i) => (
                        <div key={i} className="flex gap-3 items-start" style={{ background: '#ffffff', borderRadius: '12px', padding: '16px 20px', border: '1px solid rgba(10,10,10,0.07)' }}>
                          <span style={{ color: '#ff4d8b', flexShrink: 0, fontWeight: 700, fontSize: '14px' }}>→</span>
                          <p className="font-body" style={{ fontSize: '15px', lineHeight: '1.6', color: 'rgba(10,10,10,0.75)', margin: 0 }}>{sig}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Community signal */}
                {idea.communitySignal && (
                  <section className="mb-8">
                    <h2 className="font-body font-semibold uppercase mb-4" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)' }}>
                      Community Signal
                    </h2>
                    <p className="font-body" style={{ fontSize: '16px', lineHeight: '1.7', color: 'rgba(10,10,10,0.75)' }}>{idea.communitySignal}</p>
                  </section>
                )}
              </div>

              {/* Frosted overlay when locked */}
              {!idea.isUnlocked && (
                <div
                  className="frost-pulse"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(to bottom, rgba(255,250,240,0.1) 0%, rgba(255,250,240,0.92) 60%)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '20px',
                  }}
                >
                  <div
                    style={{
                      background: '#ffffff',
                      borderRadius: '20px',
                      padding: '36px 40px',
                      textAlign: 'center',
                      boxShadow: '0 24px 64px rgba(10,10,10,0.14)',
                      maxWidth: '390px',
                      width: '100%',
                      margin: '32px 16px',
                    }}
                  >
                    <div
                      style={{ color: '#ff4d8b', marginBottom: '16px' }}
                      onMouseEnter={() => setLockHovered(true)}
                      onMouseLeave={() => setLockHovered(false)}
                    >
                      <LockIcon isHovered={lockHovered} />
                    </div>
                    <h3
                      className="font-heading font-medium"
                      style={{ fontSize: '22px', letterSpacing: '-0.75px', color: '#0a0a0a', marginBottom: '8px' }}
                    >
                      Unlock the full brief
                    </h3>
                    <p
                      className="font-body"
                      style={{ fontSize: '14px', lineHeight: '1.6', color: 'rgba(10,10,10,0.5)', marginBottom: '24px' }}
                    >
                      Competitor gap, MVP, GTM, business model — everything you need to start building. One-time unlock.
                    </p>
                    {/* Primary: LemonSqueezy — global */}
                    <a
                      href={`https://ophunt.lemonsqueezy.com/checkout/buy/bccb0865-57d1-4d9c-b84e-07e75d91206c?embed=1&checkout[custom][idea_id]=${idea.id}${user ? `&checkout[custom][user_id]=${user.id}` : ''}`}
                      className="lemonsqueezy-button font-body font-semibold lock-btn"
                      style={{
                        display: 'block',
                        background: '#ff4d8b',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '12px',
                        padding: '14px',
                        fontSize: '15px',
                        textAlign: 'center',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        marginBottom: '10px',
                        transition: 'background 0.15s ease, transform 0.1s ease',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLAnchorElement).style.background = '#e6366f';
                        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLAnchorElement).style.background = '#ff4d8b';
                        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                      }}
                    >
                      Unlock for $1 — Card / PayPal
                    </a>

                    {/* Secondary: Paystack — Nigeria / Africa */}
                    {!paystackLoading ? (
                      paystackEmail === '' && !user ? (
                        <button
                          onClick={() => setPaystackEmail(' ')}
                          style={{
                            display: 'block', width: '100%',
                            background: '#f5f0e0', color: '#0a0a0a',
                            border: '1px solid rgba(10,10,10,0.12)',
                            borderRadius: '12px', padding: '12px 14px',
                            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                            fontFamily: 'inherit', marginBottom: '4px',
                          }}
                        >
                          Pay with Paystack (₦) — Nigeria / Africa
                        </button>
                      ) : (
                        <form
                          onSubmit={async e => {
                            e.preventDefault();
                            const email = user?.email || paystackEmail.trim();
                            if (!email) return;
                            setPaystackLoading(true);
                            setPaystackError('');
                            try {
                              const r = await apiFetch('/api/payments/paystack/initiate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ ideaId: idea.id, email, userId: user?.id }),
                              });
                              const data = await r.json() as { checkoutUrl?: string; error?: string };
                              if (data.checkoutUrl) {
                                startPolling();
                                window.location.href = data.checkoutUrl;
                              } else {
                                setPaystackError(data.error || 'Paystack unavailable');
                                setPaystackLoading(false);
                              }
                            } catch {
                              setPaystackError('Could not reach server');
                              setPaystackLoading(false);
                            }
                          }}
                          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                        >
                          {!user && (
                            <input
                              type="email"
                              placeholder="your@email.com"
                              value={paystackEmail.trim()}
                              onChange={e => setPaystackEmail(e.target.value)}
                              required
                              style={{
                                padding: '10px 12px', fontSize: '14px', borderRadius: '10px',
                                border: '1px solid rgba(10,10,10,0.15)', background: '#fafafa',
                                fontFamily: 'inherit', outline: 'none',
                              }}
                            />
                          )}
                          <button
                            type="submit"
                            style={{
                              display: 'block', width: '100%',
                              background: '#008751', color: '#fff',
                              border: 'none', borderRadius: '12px',
                              padding: '12px 14px', fontSize: '14px',
                              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            {user ? 'Pay with Paystack (₦) →' : 'Continue with Paystack →'}
                          </button>
                        </form>
                      )
                    ) : (
                      <p style={{ fontSize: '13px', color: 'rgba(10,10,10,0.4)', margin: '8px 0' }}>Redirecting to Paystack…</p>
                    )}
                    {paystackError && (
                      <p style={{ fontSize: '12px', color: '#cc2222', margin: '4px 0 0' }}>{paystackError}</p>
                    )}

                    <p className="font-body" style={{ fontSize: '11px', color: 'rgba(10,10,10,0.25)', marginTop: '14px', marginBottom: 0 }}>
                      Secured checkout · Lemon Squeezy or Paystack
                    </p>
                    <button
                      onClick={() => startPolling()}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'rgba(10,10,10,0.4)', fontSize: '12px',
                        cursor: 'pointer', marginTop: '8px', textDecoration: 'underline',
                        fontFamily: 'inherit',
                      }}
                    >
                      Already paid? Click to refresh
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Analytics grid ── */}
          <div
            style={{
              filter: idea.isUnlocked ? 'none' : 'blur(12px)',
              userSelect: idea.isUnlocked ? 'auto' : 'none',
              pointerEvents: idea.isUnlocked ? 'auto' : 'none',
              transition: 'filter 0.4s ease',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginTop: '48px' }}>

              {/* SECTION A — Opportunity Score */}
              <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid rgba(10,10,10,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <svg width="120" height="120" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(10,10,10,0.08)" strokeWidth="10" />
                  <circle
                    cx="60" cy="60" r="50" fill="none"
                    stroke={scoreColor} strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 60 60)"
                  />
                  <text x="60" y="68" textAnchor="middle" fontSize="28" fontWeight="600" fill="#0a0a0a" fontFamily="Inter, sans-serif">
                    {score}
                  </text>
                </svg>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 600, color: 'rgba(10,10,10,0.5)', marginTop: '12px', textAlign: 'center' }}>
                  Opportunity Score
                </p>
              </div>

              {/* SECTION B — Market Size */}
              <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid rgba(10,10,10,0.08)' }}>
                <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', letterSpacing: '-0.5px', color: '#0a0a0a', marginBottom: '16px', marginTop: 0 }}>
                  Market Size Estimate
                </h2>
                {([['TAM', tam, '85%'], ['SAM', sam, '55%'], ['SOM', som, '25%']] as [string, string, string][]).map(([label, value, width]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ width: '60px', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 600, color: '#0a0a0a', flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: '10px', background: '#f5f0e0', borderRadius: '50px', overflow: 'hidden' }}>
                      <div style={{ width, height: '100%', background: '#ff4d8b', borderRadius: '50px' }} />
                    </div>
                    <span style={{ width: '70px', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 600, color: 'rgba(10,10,10,0.6)', textAlign: 'right', flexShrink: 0 }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* SECTION C — Competitor Landscape */}
              <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid rgba(10,10,10,0.08)' }}>
                <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', letterSpacing: '-0.5px', color: '#0a0a0a', marginBottom: '16px', marginTop: 0 }}>
                  Competitor Landscape
                </h2>
                <svg width="200" height="200" viewBox="0 0 200 200" style={{ display: 'block', margin: '0 auto' }}>
                  <line x1="100" y1="0" x2="100" y2="200" stroke="rgba(10,10,10,0.12)" strokeWidth="1" />
                  <line x1="0" y1="100" x2="200" y2="100" stroke="rgba(10,10,10,0.12)" strokeWidth="1" />
                  <text x="20" y="20" fontSize="9" fill="rgba(10,10,10,0.25)" fontFamily="Inter, sans-serif">Blue Ocean</text>
                  <text x="110" y="20" fontSize="9" fill="rgba(10,10,10,0.25)" fontFamily="Inter, sans-serif">Hard but worth it</text>
                  <text x="20" y="180" fontSize="9" fill="rgba(10,10,10,0.25)" fontFamily="Inter, sans-serif">Easy wins</text>
                  <text x="110" y="180" fontSize="9" fill="rgba(10,10,10,0.25)" fontFamily="Inter, sans-serif">Crowded</text>
                  <text x="100" y="198" textAnchor="middle" fontSize="10" fill="rgba(10,10,10,0.4)" fontFamily="Inter, sans-serif">Market Saturation →</text>
                  <text x="10" y="100" textAnchor="middle" fontSize="10" fill="rgba(10,10,10,0.4)" fontFamily="Inter, sans-serif" transform="rotate(-90 10 100)">Execution Difficulty →</text>
                  <circle cx="140" cy="60" r="8" fill="#ff4d8b" opacity="0.8" />
                  <text x="140" y="76" textAnchor="middle" fontSize="9" fill="rgba(10,10,10,0.5)" fontFamily="Inter, sans-serif">Incumbents</text>
                  <circle cx="60" cy="130" r="8" fill="#ff4d8b" opacity="0.8" />
                  <text x="60" y="146" textAnchor="middle" fontSize="9" fill="rgba(10,10,10,0.5)" fontFamily="Inter, sans-serif">Alternatives</text>
                  <circle cx="100" cy="100" r="8" fill="#1a3a3a" opacity="0.9" />
                  <text x="100" y="116" textAnchor="middle" fontSize="9" fill="rgba(10,10,10,0.5)" fontFamily="Inter, sans-serif">You</text>
                </svg>
              </div>

              {/* SECTION D — Signal Sources */}
              <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid rgba(10,10,10,0.08)' }}>
                <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', letterSpacing: '-0.5px', color: '#0a0a0a', marginBottom: '16px', marginTop: 0 }}>
                  Signal Sources
                </h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {([
                    { label: 'Reddit', bg: '#ff4500', color: '#ffffff' },
                    { label: 'Hacker News', bg: '#ff6600', color: '#ffffff' },
                    { label: 'Product Hunt', bg: '#da552f', color: '#ffffff' },
                    { label: 'Tech News', bg: '#1a3a3a', color: '#ffffff' },
                  ] as { label: string; bg: string; color: string }[]).map(({ label, bg, color }) => (
                    <span key={label} style={{ background: bg, color, borderRadius: '999px', padding: '6px 14px', fontSize: '12px', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              {/* SECTION E — Build Complexity */}
              <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid rgba(10,10,10,0.08)' }}>
                <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', letterSpacing: '-0.5px', color: '#0a0a0a', marginBottom: '16px', marginTop: 0 }}>
                  Build Complexity
                </h2>
                {([
                  ['Frontend', feComplexity],
                  ['Backend', beComplexity],
                  ['Infrastructure', infraComplexity],
                ] as [string, string][]).map(([label, complexity]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ width: '90px', fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 600, color: '#0a0a0a', flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: '10px', background: '#f5f0e0', borderRadius: '50px', overflow: 'hidden' }}>
                      <div style={{ width: complexWidth(complexity), height: '100%', background: complexColor(complexity), borderRadius: '50px' }} />
                    </div>
                    <span style={{ width: '56px', fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 600, color: 'rgba(10,10,10,0.5)', textAlign: 'right', textTransform: 'capitalize', flexShrink: 0 }}>{complexity}</span>
                  </div>
                ))}
              </div>

              {/* SECTION F — Time to MVP */}
              <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid rgba(10,10,10,0.08)', gridColumn: 'span 2' }}>
                <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', letterSpacing: '-0.5px', color: '#0a0a0a', marginBottom: '32px', marginTop: 0 }}>
                  Time to MVP
                </h2>
                <div style={{ position: 'relative', padding: '0 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    {Array.from({ length: 8 }, (_, i) => (
                      <span key={i} style={{ fontFamily: 'Inter, sans-serif', fontSize: '10px', color: 'rgba(10,10,10,0.35)', width: '12px', textAlign: 'center' }}>
                        {i + 1}
                      </span>
                    ))}
                  </div>
                  <div style={{ position: 'relative', height: '4px', background: '#f5f0e0', borderRadius: '50px' }}>
                    <div style={{ width: '25%', height: '100%', background: '#ff4d8b', borderRadius: '50px' }} />
                    {([
                      { pct: '25%', week: 'Wk 2', label: 'Prototype' },
                      { pct: '62.5%', week: 'Wk 5', label: 'Beta' },
                      { pct: '100%', week: 'Wk 8', label: 'Launch' },
                    ] as { pct: string; week: string; label: string }[]).map(({ pct, week, label }) => (
                      <div key={label} style={{ position: 'absolute', top: '50%', left: pct, transform: 'translate(-50%, -50%)' }}>
                        <div style={{ width: '12px', height: '12px', background: '#ff4d8b', borderRadius: '50%', border: '2px solid #fffaf0' }} />
                        <div style={{ position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', fontWeight: 600, color: '#0a0a0a' }}>{week}</div>
                          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', color: 'rgba(10,10,10,0.5)' }}>{label}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* SECTION G — Risk Flags */}
              <div style={{ background: '#ffffff', borderRadius: '16px', padding: '24px', border: '1px solid rgba(10,10,10,0.08)', gridColumn: 'span 2' }}>
                <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', letterSpacing: '-0.5px', color: '#0a0a0a', marginBottom: '16px', marginTop: 0 }}>
                  Risk Flags
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {([
                    { title: 'Market Timing', desc: 'The window for this opportunity may be narrow; early movers are already forming.' },
                    { title: 'Competitive Pressure', desc: 'Adjacent incumbents could ship this feature if traction becomes visible.' },
                    { title: 'Monetization Complexity', desc: 'Converting free users to paid requires a clear value inflection point.' },
                  ] as { title: string; desc: string }[]).map(({ title, desc }) => (
                    <div key={title} style={{ background: '#fff8e1', borderLeft: '4px solid #e8b94a', borderRadius: '8px', padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
                      <div>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 600, color: '#0a0a0a', margin: '0 0 4px' }}>{title}</p>
                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: 'rgba(10,10,10,0.6)', margin: 0 }}>{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

        </div>{/* /overview */}

        {/* ══════════════════════════════════════════
            VALIDATE SECTION
        ══════════════════════════════════════════ */}
        <div id="validate" ref={validateRef} style={{ paddingTop: '80px' }}>

          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 500,
              fontSize: '40px',
              letterSpacing: '-1.5px',
              color: '#0a0a0a',
              marginBottom: '32px',
              marginTop: 0,
            }}
          >
            Validate
          </h2>

          {/* ── Name Ideas ── */}
          <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', color: '#0a0a0a', marginBottom: '16px', marginTop: 0 }}>
            Name Ideas
          </h3>

          <div
            style={{
              filter: idea.isUnlocked ? 'none' : 'blur(12px)',
              pointerEvents: idea.isUnlocked ? 'auto' : 'none',
              userSelect: idea.isUnlocked ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                display: 'flex',
                overflowX: 'auto',
                gap: '16px',
                paddingBottom: '8px',
                marginBottom: '40px',
              }}
            >
              {names.map((name, idx) => (
                <NameCard
                  key={name}
                  name={name}
                  tagline={tagline}
                  copied={!!copiedNames[idx]}
                  onCopy={() => copyName(name, idx)}
                />
              ))}
            </div>
          </div>

          {/* ── Social Posts ── */}
          <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', color: '#0a0a0a', marginBottom: '16px', marginTop: '40px' }}>
            Ready to Post
          </h3>

          {/* Platform switcher */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
            {(['reddit', 'twitter'] as const).map(p => (
              <button
                key={p}
                onClick={() => setActivePlatform(p)}
                style={{
                  background: activePlatform === p ? '#0a0a0a' : '#f5f0e0',
                  color: activePlatform === p ? '#ffffff' : '#0a0a0a',
                  borderRadius: '999px',
                  padding: '8px 20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'Inter, sans-serif',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {p === 'reddit' ? 'Reddit' : 'Twitter/X'}
              </button>
            ))}
          </div>

          <div
            style={{
              filter: idea.isUnlocked ? 'none' : 'blur(12px)',
              pointerEvents: idea.isUnlocked ? 'auto' : 'none',
              userSelect: idea.isUnlocked ? 'auto' : 'none',
            }}
          >
            {activePlatform === 'reddit' && redditPosts.map(post => (
              <div
                key={post.key}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e8e0d0',
                  borderRadius: '16px',
                  padding: '24px',
                  marginBottom: '16px',
                }}
              >
                <span
                  style={{
                    background: 'rgba(255,69,0,0.1)',
                    color: '#ff4500',
                    borderRadius: '999px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'Inter, sans-serif',
                    marginBottom: '12px',
                    display: 'inline-block',
                  }}
                >
                  {post.subreddit}
                </span>
                <p style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '16px', color: '#0a0a0a', marginBottom: '8px', marginTop: 0 }}>
                  {post.title}
                </p>
                <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#444', lineHeight: 1.6, marginBottom: '16px', marginTop: 0 }}>
                  {post.body}
                </p>
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => copyPost(post.key, `${post.title}\n\n${post.body}`)}
                    style={{
                      background: '#f5f0e0',
                      color: '#0a0a0a',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                      fontFamily: 'Inter, sans-serif',
                      cursor: 'pointer',
                    }}
                  >
                    {copiedPosts[post.key] ? 'Copied ✓' : 'Copy Post'}
                  </button>
                </div>
              </div>
            ))}

            {activePlatform === 'twitter' && tweets.map(tweet => {
              const charCount = tweet.text.length;
              const charColor = charCount > 280 ? '#e53935' : charCount > 260 ? '#f59e0b' : '#4caf50';
              return (
                <div
                  key={tweet.key}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e8e0d0',
                    borderRadius: '16px',
                    padding: '24px',
                    marginBottom: '16px',
                  }}
                >
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '15px', color: '#0a0a0a', lineHeight: 1.6, marginBottom: '12px', marginTop: 0 }}>
                    {tweet.text}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 600, color: charColor }}>
                      {charCount} / 280
                    </span>
                    <button
                      onClick={() => copyPost(tweet.key, tweet.text)}
                      style={{
                        background: '#f5f0e0',
                        color: '#0a0a0a',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        fontFamily: 'Inter, sans-serif',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedPosts[tweet.key] ? 'Copied ✓' : 'Copy Tweet'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>


        {/* ── SUBSECTION C — Market Discovery Survey ── */}
        <div style={{ marginTop: '48px' }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', color: '#0a0a0a', marginBottom: '8px' }}>
            Market Discovery Survey
          </h3>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#888', marginBottom: '20px' }}>
            One-click deploy a survey to validate demand. Share the link and start collecting real signal.
          </p>
          <div
            style={{
              background: 'white',
              border: '1px solid #e8e0d0',
              borderRadius: '16px',
              padding: '24px',
              filter: idea.isUnlocked ? 'none' : 'blur(12px)',
              pointerEvents: idea.isUnlocked ? 'auto' : 'none',
              userSelect: idea.isUnlocked ? 'auto' : 'none',
            }}
          >
            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Survey preview */}
              <div style={{ flex: 1, minWidth: '220px' }}>
                <p style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '16px', color: '#0a0a0a', marginBottom: '16px' }}>
                  Market Discovery: {idea.title}
                </p>
                {[
                  `How often do you face "${truncate(idea.summary, 60)}"?`,
                  'What tools do you currently use to solve this?',
                  'Would you pay for a better solution? If yes, how much?',
                ].map((q, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' }}>
                    <span style={{
                      background: '#f5f0e0',
                      color: '#0a0a0a',
                      borderRadius: '999px',
                      width: '24px',
                      height: '24px',
                      fontSize: '12px',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontFamily: 'Inter, sans-serif',
                    }}>{i + 1}</span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#444', lineHeight: 1.5 }}>{q}</span>
                  </div>
                ))}
              </div>
              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '180px' }}>
                <button
                  onClick={() => {
                    const surveyTitle = `Market Discovery: ${idea.title}`;
                    const surveyDesc = `We're validating a new product for ${idea.targetAudience}. Help us understand your needs around: ${idea.summary.slice(0, 120)}`;
                    window.open(`https://tally.so/forms/new?title=${encodeURIComponent(surveyTitle)}&description=${encodeURIComponent(surveyDesc)}`, '_blank');
                  }}
                  style={{ background: '#0a0a0a', color: 'white', borderRadius: '12px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}
                >
                  Open in Tally →
                </button>
                <button
                  onClick={() => {
                    const surveyTitle = `Market Discovery: ${idea.title}`;
                    const surveyDesc = `We're validating a new product for ${idea.targetAudience}. Help us understand your needs around: ${idea.summary.slice(0, 120)}`;
                    const url = `https://tally.so/forms/new?title=${encodeURIComponent(surveyTitle)}&description=${encodeURIComponent(surveyDesc)}`;
                    navigator.clipboard.writeText(url);
                    setCopiedSurveyLink(true);
                    setTimeout(() => setCopiedSurveyLink(false), 2000);
                  }}
                  style={{ background: '#f5f0e0', color: '#0a0a0a', border: '1px solid #e0d8c8', borderRadius: '12px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}
                >
                  {copiedSurveyLink ? 'Copied ✓' : 'Copy Survey Link'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── SUBSECTION D — Waitlist Form ── */}
        <div style={{ marginTop: '48px' }}>
          <h3 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '20px', color: '#0a0a0a', marginBottom: '8px' }}>
            Waitlist Form
          </h3>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#888', marginBottom: '20px' }}>
            Capture early interest. Deploy a waitlist in one click and share the link.
          </p>
          <div
            style={{
              background: 'white',
              border: '1px solid #e8e0d0',
              borderRadius: '16px',
              padding: '24px',
              filter: idea.isUnlocked ? 'none' : 'blur(12px)',
              pointerEvents: idea.isUnlocked ? 'auto' : 'none',
              userSelect: idea.isUnlocked ? 'auto' : 'none',
            }}
          >
            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Waitlist preview mockup */}
              <div style={{ flex: 1, minWidth: '220px' }}>
                <p style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: '18px', color: '#0a0a0a', marginBottom: '16px' }}>
                  {idea.title} — Early Access Waitlist
                </p>
                <div style={{ pointerEvents: 'none' }}>
                  {['Your name', 'Your email address'].map((placeholder, i) => (
                    <div key={i} style={{
                      background: '#f5f0e0',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      fontSize: '14px',
                      color: '#aaa',
                      border: '1px solid #e8e0d0',
                      marginBottom: '10px',
                      fontFamily: 'Inter, sans-serif',
                    }}>{placeholder}</div>
                  ))}
                  <div style={{
                    background: '#ff4d8b',
                    color: 'white',
                    borderRadius: '8px',
                    padding: '10px 20px',
                    fontSize: '14px',
                    fontWeight: 600,
                    width: '100%',
                    marginTop: '8px',
                    textAlign: 'center',
                    fontFamily: 'Inter, sans-serif',
                    boxSizing: 'border-box',
                  }}>
                    Join the waitlist →
                  </div>
                </div>
              </div>
              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '180px' }}>
                <button
                  onClick={() => {
                    const waitlistTitle = `${idea.title} — Early Access Waitlist`;
                    const waitlistDesc = `Be the first to know when ${idea.title} launches. We're building for ${idea.targetAudience}.`;
                    window.open(`https://tally.so/forms/new?title=${encodeURIComponent(waitlistTitle)}&description=${encodeURIComponent(waitlistDesc)}`, '_blank');
                  }}
                  style={{ background: '#0a0a0a', color: 'white', borderRadius: '12px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}
                >
                  Open in Tally →
                </button>
                <button
                  onClick={() => {
                    const waitlistTitle = `${idea.title} — Early Access Waitlist`;
                    const waitlistDesc = `Be the first to know when ${idea.title} launches. We're building for ${idea.targetAudience}.`;
                    const url = `https://tally.so/forms/new?title=${encodeURIComponent(waitlistTitle)}&description=${encodeURIComponent(waitlistDesc)}`;
                    navigator.clipboard.writeText(url);
                    setCopiedWaitlistLink(true);
                    setTimeout(() => setCopiedWaitlistLink(false), 2000);
                  }}
                  style={{ background: '#f5f0e0', color: '#0a0a0a', border: '1px solid #e0d8c8', borderRadius: '12px', padding: '12px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}
                >
                  {copiedWaitlistLink ? 'Copied ✓' : 'Copy Waitlist Link'}
                </button>
              </div>
            </div>
          </div>
        </div>

        </div>{/* /validate */}

        {/* ══════════════════════════════════════════
            LAUNCH SECTION
        ══════════════════════════════════════════ */}
        <div id="launch" ref={launchRef} style={{ paddingTop: '80px', paddingBottom: '96px' }}>

          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 500,
              fontSize: '40px',
              letterSpacing: '-1.5px',
              color: '#0a0a0a',
              marginBottom: '32px',
              marginTop: 0,
            }}
          >
            Launch
          </h2>

          {/* Dark launch card */}
          <div
            style={{
              background: '#0a0a0a',
              borderRadius: '24px',
              padding: '48px',
              textAlign: 'center',
            }}
          >
            {idea.isUnlocked ? (
              <>
                <h3
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontWeight: 500,
                    fontSize: '32px',
                    color: '#ffffff',
                    marginBottom: '12px',
                    marginTop: 0,
                    letterSpacing: '-1px',
                  }}
                >
                  Ready to build this?
                </h3>
                <p
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '16px',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '32px',
                    marginTop: 0,
                  }}
                >
                  Hand off this brief to an AI builder and start shipping.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={handleCopyPrompt}
                    style={{
                      background: '#ff4d8b',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '14px 32px',
                      fontSize: '16px',
                      fontWeight: 600,
                      fontFamily: 'Inter, sans-serif',
                      cursor: 'pointer',
                    }}
                  >
                    {copiedPrompt ? 'Copied! ✓' : 'Copy build brief for Claude / Codex →'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontWeight: 500,
                    fontSize: '32px',
                    color: '#ffffff',
                    marginBottom: '12px',
                    marginTop: 0,
                    letterSpacing: '-1px',
                  }}
                >
                  Ready to build this?
                </h3>
                <p
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '16px',
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: '24px',
                    marginTop: 0,
                  }}
                >
                  Hand off this brief to an AI builder and start shipping.
                </p>
                <div
                  style={{
                    height: '200px',
                    filter: 'blur(12px)',
                    pointerEvents: 'none',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                    Unlock the report to access launch tools
                  </p>
                </div>
              </>
            )}
          </div>

        </div>{/* /launch */}

      </article>

      <Footer />
    </div>
  );
}

/* ── Name card sub-component ── */
function NameCard({
  name,
  tagline,
  copied,
  onCopy,
}: {
  name: string;
  tagline: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#ffffff',
        border: `1px solid ${hovered ? '#ff4d8b' : '#e8e0d0'}`,
        borderRadius: '16px',
        padding: '20px 24px',
        minWidth: '180px',
        cursor: 'pointer',
        position: 'relative',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'border-color 0.2s, transform 0.2s',
        flexShrink: 0,
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); onCopy(); }}
        aria-label={`Copy ${name}`}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: '#888',
          fontSize: '16px',
          lineHeight: 1,
          padding: '2px',
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
      <p
        style={{
          fontFamily: 'Fraunces, serif',
          fontWeight: 500,
          fontSize: '22px',
          color: '#0a0a0a',
          marginBottom: '6px',
          marginTop: 0,
        }}
      >
        {name}
      </p>
      <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#888', margin: 0 }}>
        {tagline}
      </p>
    </div>
  );
}