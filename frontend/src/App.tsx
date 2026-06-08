import { createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import Explore from './pages/Explore';
import Report from './pages/Report';
import SignIn from './pages/SignIn';
import Saved from './pages/Saved';
import { useAuth, type AuthState } from './lib/auth';

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signOut: async () => {},
  refresh: async () => {},
});

export const useAuthContext = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/report/:id" element={<Report />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/saved" element={<Saved />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
