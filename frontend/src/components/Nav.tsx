import { Link, useLocation } from 'react-router-dom';

export default function Nav() {
  const { pathname } = useLocation();

  return (
    <header
      className="sticky top-0 z-50"
      style={{ background: '#fffaf0', borderBottom: '1px solid rgba(10,10,10,0.08)' }}
    >
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link
          to="/"
          className="no-underline"
          style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: '#ff4d8b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span
              className="font-heading"
              style={{ fontSize: '18px', fontWeight: 500, color: '#ffffff', letterSpacing: '-1px', lineHeight: 1 }}
            >
              O
            </span>
          </div>
          <span
            className="font-heading font-medium"
            style={{ fontSize: '20px', letterSpacing: '-0.5px', color: '#0a0a0a' }}
          >
            OpHunt
          </span>
        </Link>

        <div className="flex items-center gap-6">
          <Link
            to="/explore"
            className="font-body text-sm font-medium no-underline transition-opacity hover:opacity-100"
            style={{ color: '#0a0a0a', opacity: pathname === '/explore' ? 1 : 0.5 }}
          >
            Explore
          </Link>
          <Link
            to="/analyze"
            className="font-body text-sm font-medium no-underline transition-opacity hover:opacity-100"
            style={{ color: '#0a0a0a', opacity: pathname === '/analyze' ? 1 : 0.5 }}
          >
            Analyze
          </Link>
          <button
            disabled
            className="font-body text-sm font-semibold px-4 py-2 cursor-not-allowed"
            style={{
              background: 'transparent',
              border: '1px solid rgba(10,10,10,0.2)',
              borderRadius: '12px',
              color: 'rgba(10,10,10,0.35)',
            }}
          >
            Sign in
          </button>
        </div>
      </nav>
    </header>
  );
}
