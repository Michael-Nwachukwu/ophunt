import { useState, useEffect } from 'react';
import { apiFetch } from './api';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const res = await apiFetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json() as { user: AuthUser };
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await apiFetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    setUser(null);
  }

  useEffect(() => { refresh(); }, []);

  return { user, loading, signOut, refresh };
}
