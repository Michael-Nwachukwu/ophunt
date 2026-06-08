import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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

interface Idea {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  scores: { opportunity: number; feasibility: number; novelty: number };
  source: string;
  isUnlocked: boolean;
}

function MiniCard({ idea, index, onUnsave }: { idea: Idea; index: number; onUnsave?: () => void }) {
  const { bg, text, badge } = CARD_CYCLE[index % CARD_CYCLE.length];
  const avgScore = Math.round(
    (idea.scores.opportunity + idea.scores.feasibility + idea.scores.novelty) / 3
  );

  return (
    <div style={{ position: 'relative' }}>
      <Link
        to={`/report/${idea.id}`}
        className="no-underline block card-lift"
        style={{ background: bg, borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ background: badge, borderRadius: '999px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: text, fontFamily: 'Inter, sans-serif' }}>
            {avgScore} / 100
          </span>
          {idea.category && (
            <span style={{ background: badge, color: text, borderRadius: '999px', padding: '3px 10px', fontSize: '11px', fontWeight: 700, opacity: 0.9, fontFamily: 'Inter, sans-serif' }}>
              {idea.category}
            </span>
          )}
        </div>

        <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500, fontSize: '20px', letterSpacing: '-0.5px', color: text, margin: 0, lineHeight: 1.2 }}>
          {idea.title}
        </h3>

        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', lineHeight: '1.6', color: text, opacity: 0.75, margin: 0, flex: 1 }}>
          {idea.summary.length > 120 ? idea.summary.slice(0, 120) + '…' : idea.summary}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: `1px solid ${badge}` }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: text, opacity: 0.5 }}>
            {idea.isUnlocked ? 'Unlocked' : 'Locked'} · {idea.source !== 'url' ? `via ${idea.source}` : 'Web'}
          </span>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', fontWeight: 600, color: text, opacity: 0.8 }}>
            Read →
          </span>
        </div>
      </Link>

      {/* Unsave button — only shown on Saved tab */}
      {onUnsave && (
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onUnsave(); }}
          title="Remove from saved"
          style={{
            position: 'absolute', top: '14px', right: '14px',
            background: 'rgba(0,0,0,0.15)', border: 'none', borderRadius: '50%',
            width: '30px', height: '30px', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: '15px',
            backdropFilter: 'blur(4px)', zIndex: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

type Tab = 'saved' | 'unlocked';

export default function Saved() {
  const { user, loading: authLoading } = useAuthContext();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('saved');
  const [saved, setSaved] = useState<Idea[]>([]);
  const [unlocked, setUnlocked] = useState<Idea[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [loadingUnlocked, setLoadingUnlocked] = useState(true);

  // Redirect to sign-in if not authed
  useEffect(() => {
    if (!authLoading && !user) navigate('/sign-in');
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    apiFetch('/api/me/saved', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { ideas: Idea[] }) => { setSaved(d.ideas); setLoadingSaved(false); })
      .catch(() => setLoadingSaved(false));

    apiFetch('/api/me/unlocked', { credentials: 'include' })
      .then(r => r.json())
      .then((d: { ideas: Idea[] }) => { setUnlocked(d.ideas); setLoadingUnlocked(false); })
      .catch(() => setLoadingUnlocked(false));
  }, [user]);

  async function handleUnsave(ideaId: string) {
    await apiFetch(`/api/ideas/${ideaId}/save`, { method: 'DELETE', credentials: 'include' });
    setSaved(prev => prev.filter(i => i.id !== ideaId));
  }

  const tabBtn = (t: Tab, label: string, count: number) => (
    <button
      onClick={() => setTab(t)}
      style={{
        padding: '10px 20px', fontSize: '14px', fontWeight: 600,
        fontFamily: 'Inter, sans-serif', cursor: 'pointer', border: 'none',
        background: 'transparent',
        borderBottom: tab === t ? '2px solid #ff4d8b' : '2px solid transparent',
        color: tab === t ? '#0a0a0a' : 'rgba(10,10,10,0.4)',
        transition: 'color 0.15s, border-color 0.15s',
        whiteSpace: 'nowrap' as const,
      }}
    >
      {label}
      <span style={{
        marginLeft: '8px', background: tab === t ? '#ff4d8b' : 'rgba(10,10,10,0.08)',
        color: tab === t ? '#fff' : 'rgba(10,10,10,0.4)',
        borderRadius: '999px', padding: '1px 8px', fontSize: '11px', fontWeight: 700,
      }}>
        {count}
      </span>
    </button>
  );

  const currentIdeas = tab === 'saved' ? saved : unlocked;
  const currentLoading = tab === 'saved' ? loadingSaved : loadingUnlocked;

  if (authLoading) {
    return (
      <div style={{ background: '#fffaf0', minHeight: '100vh' }}>
        <Nav />
      </div>
    );
  }

  return (
    <div style={{ background: '#fffaf0', minHeight: '100vh' }}>
      <Nav />

      <section style={{ maxWidth: '1152px', margin: '0 auto', padding: '56px 24px 96px' }}>
        {/* Header */}
        <div style={{ marginBottom: '40px' }}>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', fontWeight: 600, letterSpacing: '2px', color: 'rgba(10,10,10,0.4)', textTransform: 'uppercase', marginBottom: '10px' }}>
            Your library
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500, fontSize: 'clamp(32px, 5vw, 48px)', letterSpacing: '-1.5px', color: '#0a0a0a', margin: 0 }}>
            Ideas you've collected
          </h1>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(10,10,10,0.1)', marginBottom: '40px', gap: '4px' }}>
          {tabBtn('saved', 'Saved', saved.length)}
          {tabBtn('unlocked', 'Unlocked', unlocked.length)}
        </div>

        {/* Content */}
        {currentLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ background: CARD_CYCLE[i % CARD_CYCLE.length].bg, borderRadius: '20px', height: '240px', opacity: 0.3 }} />
            ))}
          </div>
        ) : currentIdeas.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '80px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>{tab === 'saved' ? '🔖' : '🔓'}</div>
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 500, fontSize: '26px', color: '#0a0a0a', margin: '0 0 10px' }}>
              {tab === 'saved' ? 'No saved ideas yet' : 'No unlocked reports yet'}
            </h2>
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '15px', color: 'rgba(10,10,10,0.45)', marginBottom: '28px' }}>
              {tab === 'saved'
                ? 'Hit the ❤️ on any idea card to save it here for later.'
                : "Unlock a report for $1 to get the full brief — it'll appear here."}
            </p>
            <Link
              to="/explore"
              style={{ display: 'inline-block', background: '#ff4d8b', color: '#fff', textDecoration: 'none', padding: '12px 28px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}
            >
              Browse ideas →
            </Link>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {currentIdeas.map((idea, i) => (
              <MiniCard
                key={idea.id}
                idea={idea}
                index={i}
                onUnsave={tab === 'saved' ? () => handleUnsave(idea.id) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
