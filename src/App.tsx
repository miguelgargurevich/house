import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import AdminLayout from './layouts/AdminLayout';
import OwnerLayout from './layouts/OwnerLayout';
import Dashboard from './pages/Dashboard';
import Receipts from './pages/Receipts';
import UsuariosPage from './pages/Usuarios';
import EmpresasPage from './pages/Empresas';
import OwnerReceipt from './pages/OwnerReceipt';
import Login from './pages/Login';
import AIChatFab from './components/AIChatFab';

type User = { email: string; role: 'admin' | 'owner' | 'propietario' | 'superadmin' } | null;

function ProtectedRoute({ children, allowedRoles, user }: { children: ReactElement, allowedRoles: string[], user: User }) {
  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AdminLayoutWithOutlet() {
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}

function OwnerLayoutWithOutlet() {
  return (
    <OwnerLayout>
      <Outlet />
    </OwnerLayout>
  );
}

export default function App() {
  const [user, setUser] = useState<User>(null);

  // Decodifica el JWT para obtener email y rol
  function decodeToken(token: string): User {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      // El backend usa "rol" (no "role")
      return { email: payload.email, role: payload.rol };
    } catch {
      return null;
    }
  }

  // Al iniciar la app, si hay token, setea el usuario
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      const u = decodeToken(token);
      setUser(u);
    }
  }, []);

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login onLogin={setUser} />} />

          {/* Rutas Admin */}
          <Route element={<AdminLayoutWithOutlet />}>
            <Route path="/dashboard" element={
              <ProtectedRoute allowedRoles={["admin","superadmin"]} user={user}>
                <Dashboard />
              </ProtectedRoute>
            } />
            <Route path="/usuarios" element={
              <ProtectedRoute allowedRoles={["admin","superadmin"]} user={user}>
                <UsuariosPage />
              </ProtectedRoute>
            } />
            <Route path="/empresas" element={
              <ProtectedRoute allowedRoles={["admin","superadmin"]} user={user}>
                <EmpresasPage />
              </ProtectedRoute>
            } />
            <Route path="/receipts" element={
              <ProtectedRoute allowedRoles={["admin","superadmin"]} user={user}>
                <Receipts />
              </ProtectedRoute>
            } />
          </Route>

          {/* Rutas Propietario */}
          <Route element={<OwnerLayoutWithOutlet />}>
            <Route path="/owner/receipt" element={
              <ProtectedRoute allowedRoles={["owner","propietario"]} user={user}>
                <OwnerReceipt />
              </ProtectedRoute>
            } />
          </Route>

          {/* Redirección por defecto */}
          <Route path="*" element={<Navigate to={user?.role === 'admin' || user?.role === 'superadmin' ? '/dashboard' : user?.role === 'owner' || user?.role === 'propietario' ? '/owner/receipt' : '/login'} replace />} />
        </Routes>
      </BrowserRouter>
      {user && <AIChatFab />}
    </>
  );
}
