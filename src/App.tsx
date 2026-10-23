import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, HOME, useAuth } from './auth/AuthContext';
import { RequireAuth, RequireRole } from './auth/guards';
import { Shell } from './app/Shell';
import { ToastProvider, Skeleton } from './ui';
import Login from './pages/Login';

const SuperadminDashboard = lazy(() => import('./pages/superadmin/Dashboard'));
const SuperadminEmpresas = lazy(() => import('./pages/superadmin/Empresas'));
const SuperadminUsuarios = lazy(() => import('./pages/superadmin/Usuarios'));
const SuperadminAuditoria = lazy(() => import('./pages/superadmin/Auditoria'));
const SuperadminLlavero = lazy(() => import('./pages/superadmin/Llavero'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const AdminComplejos = lazy(() => import('./pages/admin/Complejos'));
const AdminUnidades = lazy(() => import('./pages/admin/Unidades'));
const AdminRecibos = lazy(() => import('./pages/admin/Recibos'));
const AdminPagos = lazy(() => import('./pages/admin/Pagos'));
const AdminMorosidad = lazy(() => import('./pages/admin/Morosidad'));
const AdminMantenimientos = lazy(() => import('./pages/admin/Mantenimientos'));
const AdminConceptos = lazy(() => import('./pages/admin/Conceptos'));
const AdminUsuarios = lazy(() => import('./pages/admin/Usuarios'));
const AdminConfiguracion = lazy(() => import('./pages/admin/Configuracion'));
const PropietarioInicio = lazy(() => import('./pages/propietario/Inicio'));
const PropietarioUnidades = lazy(() => import('./pages/propietario/Unidades'));
const PropietarioCargos = lazy(() => import('./pages/propietario/Cargos'));
const PropietarioPagos = lazy(() => import('./pages/propietario/Pagos'));
const InquilinoInicio = lazy(() => import('./pages/inquilino/Inicio'));
const InquilinoCargos = lazy(() => import('./pages/inquilino/Cargos'));
const InquilinoPagos = lazy(() => import('./pages/inquilino/Pagos'));
const MantenimientoInicio = lazy(() => import('./pages/mantenimiento/Inicio'));
const MantenimientoTareas = lazy(() => import('./pages/mantenimiento/Tareas'));
const SeguridadInicio = lazy(() => import('./pages/seguridad/Inicio'));
const SeguridadUnidades = lazy(() => import('./pages/seguridad/Unidades'));
const Perfil = lazy(() => import('./pages/shared/Perfil'));

function Fallback() {
  return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;
}

function Landing() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? HOME[user.rol] : '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<div className="p-8"><Fallback /></div>}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route element={<Shell />}>
        <Route element={<RequireRole roles={['superadmin']} />}>
          <Route path="/superadmin/dashboard" element={<SuperadminDashboard />} />
          <Route path="/superadmin/empresas" element={<SuperadminEmpresas />} />
          <Route path="/superadmin/usuarios" element={<SuperadminUsuarios />} />
          <Route path="/superadmin/auditoria" element={<SuperadminAuditoria />} />
          <Route path="/superadmin/llavero" element={<SuperadminLlavero />} />
        </Route>
        <Route element={<RequireRole roles={['superadmin','admin']} />}>
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          <Route path="/admin/complejos" element={<AdminComplejos />} />
          <Route path="/admin/unidades" element={<AdminUnidades />} />
          <Route path="/admin/recibos" element={<AdminRecibos />} />
          <Route path="/admin/pagos" element={<AdminPagos />} />
          <Route path="/admin/morosidad" element={<AdminMorosidad />} />
          <Route path="/admin/mantenimientos" element={<AdminMantenimientos />} />
          <Route path="/admin/conceptos" element={<AdminConceptos />} />
          <Route path="/admin/usuarios" element={<AdminUsuarios />} />
          <Route path="/admin/configuracion" element={<AdminConfiguracion />} />
        </Route>
        <Route element={<RequireRole roles={['propietario']} />}>
          <Route path="/propietario/inicio" element={<PropietarioInicio />} />
          <Route path="/propietario/unidades" element={<PropietarioUnidades />} />
          <Route path="/propietario/cargos" element={<PropietarioCargos />} />
          <Route path="/propietario/pagos" element={<PropietarioPagos />} />
        </Route>
        <Route element={<RequireRole roles={['inquilino']} />}>
          <Route path="/inquilino/inicio" element={<InquilinoInicio />} />
          <Route path="/inquilino/cargos" element={<InquilinoCargos />} />
          <Route path="/inquilino/pagos" element={<InquilinoPagos />} />
        </Route>
        <Route element={<RequireRole roles={['mantenimiento']} />}>
          <Route path="/mantenimiento/inicio" element={<MantenimientoInicio />} />
          <Route path="/mantenimiento/tareas" element={<MantenimientoTareas />} />
        </Route>
        <Route element={<RequireRole roles={['seguridad']} />}>
          <Route path="/seguridad/inicio" element={<SeguridadInicio />} />
          <Route path="/seguridad/unidades" element={<SeguridadUnidades />} />
        </Route>
                  <Route path="/perfil" element={<Perfil />} />
                </Route>
              </Route>
              <Route path="*" element={<Landing />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
