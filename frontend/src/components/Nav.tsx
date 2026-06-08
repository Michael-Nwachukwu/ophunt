import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../App';

export default function Nav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, loading, signOut } = useAuthContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleSignOut() {
    setMenuOpen(false);
    await signOut();
    navigate('/');
  }

  const linkStyle = (active: boolean) => ({
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '14px',
    fontWeight: 500,
    color: '#0a0a0a',
    opacity: active ? 1 : 0.45,
    textDecoration: 'none',
    transition: 'opacity 0.15s',
  });

  return (
    <header
      style={{ background: '#fffaf0', borderBottom: '1px solid rgba(10,10,10,0.08)', position: 'sticky', top: 0, zIndex: 50 }}
    >
      <nav
        style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 24px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        {/* Logo */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
          <img
            src="/ophunt-logo.svg"
            alt="OpHunt"
            style={{ height: '53px', width: 'auto', display: 'block' }}
          />
        </Link>

        {/* Nav links + auth */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <Link to="/explore" style={linkStyle(pathname === '/explore')}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = pathname === '/explore' ? '1' : '0.45')}
          >
            Explore
          </Link>
          <Link to="/" style={linkStyle(pathname === '/')}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = pathname === '/' ? '1' : '0.45')}
          >
            Analyze
          </Link>

          {loading ? (
            <div style={{ width: '80px', height: '34px', background: 'rgba(10,10,10,0.06)', borderRadius: '12px' }} />
          ) : user ? (
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button
                onClick={() => setMenuOpen(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  background: 'transparent', border: '1px solid rgba(10,10,10,0.15)',
                  borderRadius: '12px', padding: '6px 12px', cursor: 'pointer',
                  fontFamily: 'Inter, system-ui, sans-serif',
                  fontSize: '13px', color: '#0a0a0a',
                }}
              >
                <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: '#ff4d8b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>
                    {user.email[0].toUpperCase()}
                  </span>
                </div>
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.email}
                </span>
                <span style={{ opacity: 0.4, fontSize: '10px' }}>▾</span>
              </button>

              {menuOpen && (
                <div
                  style={{
                    position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                    background: '#fff', border: '1px solid rgba(10,10,10,0.1)',
                    borderRadius: '14px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                    minWidth: '180px', overflow: 'hidden', zIndex: 100,
                  }}
                >
                  <Link
                    to="/saved"
                    onClick={() => setMenuOpen(false)}
                    style={{ display: 'block', padding: '12px 16px', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: '#0a0a0a', textDecoration: 'none' }}
                  >
                    Saved ideas
                  </Link>
                  <div style={{ height: '1px', background: 'rgba(10,10,10,0.07)' }} />
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: '#cc2222', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/sign-in"
              style={{
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '13px', fontWeight: 600, color: '#0a0a0a',
                border: '1px solid rgba(10,10,10,0.2)', borderRadius: '12px',
                padding: '7px 16px', textDecoration: 'none', opacity: 0.75,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
