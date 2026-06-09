import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../App';

export default function Nav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuthContext();

  // Initialise synchronously so there's no flash on mobile
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Track viewport width changes
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const h = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) setMobileOpen(false);
    };
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  // Close mobile drawer on navigation
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Close desktop user dropdown on outside click
  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  async function handleSignOut() {
    setUserMenuOpen(false);
    setMobileOpen(false);
    await signOut();
    navigate('/');
  }

  const navLink = (active: boolean) => ({
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '14px',
    fontWeight: 500,
    color: '#0a0a0a',
    opacity: active ? 1 : 0.45,
    textDecoration: 'none',
    transition: 'opacity 0.15s',
  } as React.CSSProperties);

  // ── Hamburger icon (animates to × when open) ─────────────────────────────────
  const bar = (transform: string, opacity = 1) => ({
    display: 'block',
    width: '22px',
    height: '2px',
    background: '#0a0a0a',
    borderRadius: '2px',
    transition: 'transform 0.22s ease, opacity 0.15s',
    transform,
    opacity,
  } as React.CSSProperties);

  // ── Desktop user dropdown ─────────────────────────────────────────────────────
  const desktopAuth = loading ? (
    <div style={{ width: '80px', height: '34px', background: 'rgba(10,10,10,0.06)', borderRadius: '12px' }} />
  ) : user ? (
    <div style={{ position: 'relative' }} ref={userMenuRef}>
      <button
        onClick={() => setUserMenuOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'transparent', border: '1px solid rgba(10,10,10,0.15)',
          borderRadius: '12px', padding: '6px 12px', cursor: 'pointer',
          fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px', color: '#0a0a0a',
        }}
      >
        <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#ff4d8b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>{user.email[0].toUpperCase()}</span>
        </div>
        <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.email}
        </span>
        <span style={{ opacity: 0.4, fontSize: '10px' }}>▾</span>
      </button>

      {userMenuOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: '#fff', border: '1px solid rgba(10,10,10,0.1)',
          borderRadius: '14px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
          minWidth: '180px', overflow: 'hidden', zIndex: 100,
        }}>
          <Link to="/saved" onClick={() => setUserMenuOpen(false)} style={{ display: 'block', padding: '12px 16px', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: '#0a0a0a', textDecoration: 'none' }}>
            Saved ideas
          </Link>
          <div style={{ height: '1px', background: 'rgba(10,10,10,0.07)' }} />
          <button onClick={handleSignOut} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: '#cc2222', background: 'none', border: 'none', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  ) : (
    <Link
      to="/sign-in"
      style={{
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px', fontWeight: 600,
        color: '#0a0a0a', border: '1px solid rgba(10,10,10,0.2)', borderRadius: '12px',
        padding: '7px 16px', textDecoration: 'none', opacity: 0.75, transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
    >
      Sign in
    </Link>
  );

  return (
    <header style={{ background: '#fffaf0', borderBottom: '1px solid rgba(10,10,10,0.08)', position: 'sticky', top: 0, zIndex: 50 }}>

      {/* ── Main bar ────────────────────────────────────────────────────────────── */}
      <nav style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 24px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

        {/* Logo */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
          <img src="/ophunt-logo.svg" alt="OpHunt" style={{ height: '53px', width: 'auto', display: 'block' }} />
        </Link>

        {/* Desktop links */}
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
            <Link to="/explore" style={navLink(pathname === '/explore')}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = pathname === '/explore' ? '1' : '0.45')}
            >
              Explore
            </Link>
            <Link to="/" style={navLink(pathname === '/')}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = pathname === '/' ? '1' : '0.45')}
            >
              Analyze
            </Link>
            {desktopAuth}
          </div>
        )}

        {/* Mobile: hamburger */}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(v => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-end' }}
          >
            <span style={bar(mobileOpen ? 'translateY(7px) rotate(45deg)' : 'none')} />
            <span style={bar('none', mobileOpen ? 0 : 1)} />
            <span style={bar(mobileOpen ? 'translateY(-7px) rotate(-45deg)' : 'none')} />
          </button>
        )}
      </nav>

      {/* ── Mobile drawer ────────────────────────────────────────────────────────── */}
      {isMobile && (
        <div
          style={{
            maxHeight: mobileOpen ? '420px' : '0',
            overflow: 'hidden',
            transition: 'max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
            background: '#fffaf0',
            borderTop: mobileOpen ? '1px solid rgba(10,10,10,0.08)' : 'none',
          }}
        >
          <div style={{ padding: '12px 24px 28px', display: 'flex', flexDirection: 'column' }}>

            {/* Nav links */}
            <Link
              to="/explore"
              onClick={() => setMobileOpen(false)}
              style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '17px', fontWeight: 500, color: '#0a0a0a', textDecoration: 'none', padding: '13px 0', opacity: pathname === '/explore' ? 1 : 0.5, borderBottom: '1px solid rgba(10,10,10,0.07)' }}
            >
              Explore
            </Link>
            <Link
              to="/"
              onClick={() => setMobileOpen(false)}
              style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '17px', fontWeight: 500, color: '#0a0a0a', textDecoration: 'none', padding: '13px 0', opacity: pathname === '/' ? 1 : 0.5, borderBottom: '1px solid rgba(10,10,10,0.07)' }}
            >
              Analyze
            </Link>

            {/* Auth section */}
            <div style={{ marginTop: '16px' }}>
              {loading ? (
                <div style={{ height: '44px', background: 'rgba(10,10,10,0.06)', borderRadius: '12px' }} />
              ) : user ? (
                <>
                  {/* User row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '14px', borderBottom: '1px solid rgba(10,10,10,0.07)', marginBottom: '4px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#ff4d8b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>{user.email[0].toUpperCase()}</span>
                    </div>
                    <span style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px', color: 'rgba(10,10,10,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.email}
                    </span>
                  </div>
                  <Link
                    to="/saved"
                    onClick={() => setMobileOpen(false)}
                    style={{ display: 'block', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '17px', fontWeight: 500, color: '#0a0a0a', textDecoration: 'none', padding: '13px 0', opacity: 0.7, borderBottom: '1px solid rgba(10,10,10,0.07)' }}
                  >
                    Saved ideas
                  </Link>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'block', width: '100%', textAlign: 'left', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '17px', fontWeight: 500, color: '#cc2222', background: 'none', border: 'none', cursor: 'pointer', padding: '13px 0' }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  to="/sign-in"
                  onClick={() => setMobileOpen(false)}
                  style={{
                    display: 'block', textAlign: 'center',
                    fontFamily: 'Inter, system-ui, sans-serif', fontSize: '15px', fontWeight: 600,
                    color: '#fff', background: '#0a0a0a',
                    borderRadius: '14px', padding: '13px 20px', textDecoration: 'none',
                  }}
                >
                  Sign in →
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
