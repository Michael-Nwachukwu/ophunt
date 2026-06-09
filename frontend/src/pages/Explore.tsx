import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import { apiFetch } from '../lib/api';
import { useAuthContext } from '../App';

const CARD_CYCLE = [
  { bg: '#ff4d8b', text: '#ffffff', badge: 'rgba(255,255,255,0.2)' },
  { bg: '#1a3a3a', text: '#ffffff', badge: 'rgba(255,255,255,0.15)' },
  { bg: '#b8a4ed', text: '#0a0a0a', badge: 'rgba(10,10,10,0.1)' },
  { bg: '#ffb084', text: '#0a0a0a', badge: 'rgba(10,10,10,0.1)' },
  { bg: '#e8b94a', text: '#0a0a0a', badge: 'rgba(10,10,10,0.1)' },
  { bg: '#f5f0e0', text: '#0a0a0a', badge: 'rgba(10,10,10,0.08)' },
];

const CATEGORIES = ['AI tools', 'dev tools', 'consumer apps', 'B2B SaaS', 'fintech', 'productivity', 'other'] as const;
const SORT_OPTIONS = [
  { value: 'recent', label: 'Freshest' },
  { value: 'opportunity', label: 'Opportunity' },
  { value: 'novelty', label: 'Novelty' },
  { value: 'timing', label: 'Timing' },
  { value: 'marketfit', label: 'Market Fit' },
] as const;

interface Idea {
  id: string;
  title: string;
  summary: string;
  scores: { opportunity: number; feasibility: number; novelty: number; timing?: number; marketFit?: number };
  tags: string[];
  category?: string;
  source?: string;
  sourceTitle: string;
  createdAt: string;
  isUnlocked: boolean;
}

function IdeaCard({ idea, index, isSaved, onToggleSave }: { idea: Idea; index: number; isSaved: boolean; onToggleSave: () => void }) {
  const { bg, text, badge } = CARD_CYCLE[index % CARD_CYCLE.length];
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => el.classList.add('visible'), (index % 3) * 80);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [index]);

  const avgScore = Math.round(
    (idea.scores.opportunity + idea.scores.feasibility + idea.scores.novelty) / 3
  );

  return (
    <div ref={cardRef} className="reveal" style={{ position: 'relative' }}>
      <Link
        to={`/report/${idea.id}`}
        className="no-underline block card-lift"
        style={{ background: bg, borderRadius: '24px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%' }}
      >
        {/* Score + category badges */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 font-body font-semibold" style={{ background: badge, borderRadius: '999px', padding: '5px 12px', fontSize: '12px', color: text }}>
            <span style={{ opacity: 0.7 }}>⬤</span>
            <span>{avgScore} / 100</span>
          </div>
          <div className="flex items-center gap-2">
            {idea.category && (
              <span className="font-body" style={{ background: badge, color: text, borderRadius: '999px', padding: '3px 10px', fontSize: '11px', fontWeight: 700, opacity: 0.9 }}>
                {idea.category}
              </span>
            )}
            {idea.isUnlocked && (
              <span style={{ fontSize: '12px', color: text, opacity: 0.5 }}>Unlocked</span>
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="font-heading font-medium" style={{ fontSize: '22px', letterSpacing: '-0.75px', color: text, margin: 0, lineHeight: 1.2 }}>
          {idea.title}
        </h3>

        {/* Summary */}
        <p className="font-body flex-1" style={{ fontSize: '14px', lineHeight: '1.6', color: text, opacity: 0.75, margin: 0 }}>
          {idea.summary.length > 140 ? idea.summary.slice(0, 140) + '…' : idea.summary}
        </p>

        {/* Tags */}
        {idea.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {idea.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="font-body" style={{ background: badge, color: text, borderRadius: '999px', padding: '3px 10px', fontSize: '12px', opacity: 0.85 }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Source + CTA */}
        <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${badge}` }}>
          <span className="font-body" style={{ fontSize: '12px', color: text, opacity: 0.5 }}>
            {idea.source && idea.source !== 'url' ? `via ${idea.source}` : idea.sourceTitle || 'Web source'}
          </span>
          <span className="font-body font-semibold" style={{ fontSize: '13px', color: text, opacity: 0.8 }}>
            Read brief →
          </span>
        </div>
      </Link>

      {/* Save heart button — floats over card, stops link navigation */}
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSave(); }}
        title={isSaved ? 'Remove from saved' : 'Save idea'}
        style={{
          position: 'absolute', bottom: '20px', right: '20px',
          background: isSaved ? '#ff4d8b' : 'rgba(255,255,255,0.25)',
          border: 'none', borderRadius: '50%',
          width: '36px', height: '36px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', backdropFilter: 'blur(6px)',
          transition: 'background 0.2s, transform 0.15s',
          zIndex: 1,
        }}
        onMouseEnter={e => { if (!isSaved) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.45)'; }}
        onMouseLeave={e => { if (!isSaved) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.25)'; }}
      >
        {isSaved ? '❤️' : '🤍'}
      </button>
    </div>
  );
}

export default function Explore() {
  const { user } = useAuthContext();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('recent');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const fetchIdeas = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (sort) params.set('sort', sort);
    params.set('limit', '60');
    apiFetch(`/api/ideas?${params}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: { ideas: Idea[] }) => { setIdeas(data.ideas); setLoading(false); })
      .catch((err: unknown) => { setError(String(err)); setLoading(false); });
  }, [category, sort]);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  // Fetch saved idea IDs when user is logged in
  useEffect(() => {
    if (!user) { setSavedIds(new Set()); return; }
    apiFetch('/api/me/saved', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((d: { ideas: { id: string }[] } | null) => {
        if (d) setSavedIds(new Set(d.ideas.map(i => i.id)));
      })
      .catch(() => {});
  }, [user]);

  async function handleToggleSave(ideaId: string) {
    if (!user) { window.location.href = '/sign-in'; return; }
    const isSaved = savedIds.has(ideaId);
    if (isSaved) {
      await apiFetch(`/api/ideas/${ideaId}/save`, { method: 'DELETE', credentials: 'include' });
      setSavedIds(prev => { const s = new Set(prev); s.delete(ideaId); return s; });
    } else {
      await apiFetch(`/api/ideas/${ideaId}/save`, { method: 'POST', credentials: 'include' });
      setSavedIds(prev => new Set([...prev, ideaId]));
    }
  }

  return (
    <div style={{ background: '#fffaf0', minHeight: '100vh' }}>
      <Nav />

      <section style={{ padding: '64px 24px 96px' }} className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <p className="font-body font-semibold uppercase" style={{ fontSize: '11px', letterSpacing: '2px', color: 'rgba(10,10,10,0.4)', margin: 0 }}>
              Idea Feed
            </p>
            <a
              href="https://argens.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-body no-underline inline-flex items-center gap-1"
              style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.3px', color: 'rgba(10,10,10,0.3)', background: 'rgba(10,10,10,0.05)', borderRadius: '999px', padding: '2px 8px', transition: 'color 0.15s, background 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'rgba(10,10,10,0.6)'; e.currentTarget.style.background = 'rgba(10,10,10,0.09)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(10,10,10,0.3)'; e.currentTarget.style.background = 'rgba(10,10,10,0.05)'; }}
            >
              <img src="/argens-icon.svg" alt="" style={{ width: '11px', height: '11px', display: 'block', opacity: 0.7 }} />
              argens.xyz
            </a>
          </div>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <h1 className="font-heading font-medium" style={{ fontSize: 'clamp(32px, 5vw, 48px)', letterSpacing: '-1.5px', color: '#0a0a0a', margin: 0 }}>
              Recent opportunities
            </h1>
            <Link to="/" className="font-body text-sm no-underline self-start md:self-auto" style={{ color: '#ff4d8b', fontWeight: 600 }}>
              + Analyze a new URL
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-8 items-center">
          {/* Category pills */}
          <button
            onClick={() => setCategory('')}
            className="font-body font-semibold"
            style={{ borderRadius: '999px', padding: '6px 16px', fontSize: '13px', border: 'none', cursor: 'pointer', background: category === '' ? '#0a0a0a' : 'rgba(10,10,10,0.07)', color: category === '' ? '#ffffff' : 'rgba(10,10,10,0.6)', transition: 'all 0.15s' }}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat === category ? '' : cat)}
              className="font-body font-semibold"
              style={{ borderRadius: '999px', padding: '6px 16px', fontSize: '13px', border: 'none', cursor: 'pointer', background: category === cat ? '#ff4d8b' : 'rgba(10,10,10,0.07)', color: category === cat ? '#ffffff' : 'rgba(10,10,10,0.6)', transition: 'all 0.15s' }}
            >
              {cat}
            </button>
          ))}

          {/* Sort */}
          <div style={{ marginLeft: 'auto' }}>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="font-body"
              style={{ background: 'rgba(10,10,10,0.07)', border: 'none', borderRadius: '999px', padding: '6px 16px', fontSize: '13px', color: 'rgba(10,10,10,0.7)', cursor: 'pointer', fontWeight: 600 }}
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* States */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ background: CARD_CYCLE[i % CARD_CYCLE.length].bg, borderRadius: '24px', padding: '32px', height: '280px', opacity: 0.4 }} />
            ))}
          </div>
        )}

        {error && (
          <div className="font-body text-center py-24" style={{ color: 'rgba(10,10,10,0.4)', fontSize: '16px' }}>
            Couldn't load ideas — {error}. Is the API running?
          </div>
        )}

        {!loading && !error && ideas.length === 0 && (
          <div className="text-center py-24">
            <p className="font-body" style={{ fontSize: '17px', color: 'rgba(10,10,10,0.45)', marginBottom: '24px' }}>
              {category ? `No ideas yet in "${category}". Try a different category or` : 'The feed is empty. Be the first to hunt an idea —'}{' '}
            </p>
            <Link to="/" className="font-body font-semibold no-underline inline-block" style={{ background: '#ff4d8b', color: '#ffffff', padding: '12px 28px', borderRadius: '12px', fontSize: '15px' }}>
              Analyze a URL →
            </Link>
          </div>
        )}

        {!loading && !error && ideas.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ideas.map((idea, i) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                index={i}
                isSaved={savedIds.has(idea.id)}
                onToggleSave={() => handleToggleSave(idea.id)}
              />
            ))}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
