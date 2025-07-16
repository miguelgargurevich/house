import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Login from './pages/Login';
import SuperAdminDashboard from './pages/superadmin/Dashboard';

type User = { email: string; role: string };

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes() {
  const [user, setUser] = useState<User | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  function decodeToken(token: string): User | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const role = payload.rol || payload.role;
      return role ? { email: payload.email, role } : null;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      const u = decodeToken(token);
      setUser(u);
      // Redirige solo si es superadmin y está en login
      if (location.pathname === '/login' && u?.role === 'superadmin') {
        navigate('/superadmin/dashboard');
      }
    } else {
      setUser(null);
      if (location.pathname !== '/login') {
        navigate('/login');
      }
    }
  }, [location.pathname, navigate]);


  // Protege la ruta solo para superadmin
  function ProtectedSuperAdmin({ children }: { children: React.ReactNode }) {
    if (!user || user.role !== 'superadmin') {
      return <Navigate to="/login" replace />;
    }
    return <>{children}</>;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login onLogin={(u: User) => setUser(u)} />} />
      <Route path="/superadmin/dashboard" element={
        <ProtectedSuperAdmin>
          <SuperAdminDashboard user={user!} onLogout={() => {
            localStorage.removeItem('token');
            setUser(null);
            navigate('/login');
          }} />
        </ProtectedSuperAdmin>
      } />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

                
