import { lazy } from 'react';
import SuperAdminLayout from '../layouts/SuperAdminLayout';
import AdminLayout from '../layouts/AdminLayout';
import PropietarioLayout from '../layouts/PropietarioLayout';
import InquilinoLayout from '../layouts/InquilinoLayout';
import MantenimientoLayout from '../layouts/MantenimientoLayout';

// SuperAdmin
const SuperAdminDashboard = lazy(() => import('../pages/superadmin/Dashboard'));
const SuperAdminEmpresas = lazy(() => import('../pages/superadmin/Empresas'));
const SuperAdminUsuarios = lazy(() => import('../pages/superadmin/Usuarios'));
const SuperAdminAuditoria = lazy(() => import('../pages/superadmin/Auditoria'));
const SuperAdminConfiguracion = lazy(() => import('../pages/superadmin/Configuracion'));

// Admin
const AdminDashboard = lazy(() => import('../pages/admin/Dashboard'));
const AdminEmpresas = lazy(() => import('../pages/admin/Empresas'));
const AdminPropiedades = lazy(() => import('../pages/admin/Propiedades'));
const AdminPropietarios = lazy(() => import('../pages/admin/Propietarios'));
const AdminPagos = lazy(() => import('../pages/admin/Pagos'));
const AdminReportes = lazy(() => import('../pages/admin/Reportes'));
const AdminUsuarios = lazy(() => import('../pages/admin/Usuarios'));
const AdminConfiguracion = lazy(() => import('../pages/admin/Configuracion'));
const AdminMantenimientos = lazy(() => import('../pages/admin/Mantenimientos'));

// Propietario
const PropietarioPanel = lazy(() => import('../pages/propietario/Panel'));
const PropietarioPropiedades = lazy(() => import('../pages/propietario/Propiedades'));
const PropietarioPagos = lazy(() => import('../pages/propietario/Pagos'));
const PropietarioPendientes = lazy(() => import('../pages/propietario/Pendientes'));
const PropietarioPerfil = lazy(() => import('../pages/propietario/Perfil'));
const PropietarioComprobante = lazy(() => import('../pages/propietario/Comprobante'));

// Inquilino
const InquilinoPanel = lazy(() => import('../pages/inquilino/Panel'));
const InquilinoDeudas = lazy(() => import('../pages/inquilino/Deudas'));
const InquilinoPagos = lazy(() => import('../pages/inquilino/Pagos'));
const InquilinoComprobante = lazy(() => import('../pages/inquilino/Comprobante'));

// Mantenimiento
const MantenimientoTareas = lazy(() => import('../pages/mantenimiento/Tareas'));
const MantenimientoNuevaTarea = lazy(() => import('../pages/mantenimiento/NuevaTarea'));
const MantenimientoEstado = lazy(() => import('../pages/mantenimiento/Estado'));

// Auth
const Signup = lazy(() => import('../pages/Signup'));


export const routes = [
  // SuperAdmin (todas protegidas por lógica de roles)
  { path: '/superadmin/dashboard', element: <SuperAdminLayout><SuperAdminDashboard /></SuperAdminLayout> },
  { path: '/superadmin/empresas', element: <SuperAdminLayout><SuperAdminEmpresas /></SuperAdminLayout> },
  { path: '/superadmin/usuarios', element: <SuperAdminLayout><SuperAdminUsuarios /></SuperAdminLayout> },
  { path: '/superadmin/auditoria', element: <SuperAdminLayout><SuperAdminAuditoria /></SuperAdminLayout> },
  { path: '/superadmin/configuracion', element: <SuperAdminLayout><SuperAdminConfiguracion /></SuperAdminLayout> },
  // Auth
  { path: '/signup', element: <Signup /> },

  // Admin
  { path: '/admin/dashboard', element: <AdminLayout><AdminDashboard /></AdminLayout> },
  { path: '/admin/empresas', element: <AdminLayout><AdminEmpresas /></AdminLayout> },
  { path: '/admin/propiedades', element: <AdminLayout><AdminPropiedades /></AdminLayout> },
  { path: '/admin/propietarios', element: <AdminLayout><AdminPropietarios /></AdminLayout> },
  { path: '/admin/pagos', element: <AdminLayout><AdminPagos /></AdminLayout> },
  { path: '/admin/reportes', element: <AdminLayout><AdminReportes /></AdminLayout> },
  { path: '/admin/usuarios', element: <AdminLayout><AdminUsuarios /></AdminLayout> },
  { path: '/admin/configuracion', element: <AdminLayout><AdminConfiguracion /></AdminLayout> },
  { path: '/admin/mantenimientos', element: <AdminLayout><AdminMantenimientos /></AdminLayout> },

  // Propietario
  { path: '/propietario/mi-panel', element: <PropietarioLayout><PropietarioPanel /></PropietarioLayout> },
  { path: '/propietario/mis-propiedades', element: <PropietarioLayout><PropietarioPropiedades /></PropietarioLayout> },
  { path: '/propietario/mis-pagos', element: <PropietarioLayout><PropietarioPagos /></PropietarioLayout> },
  { path: '/propietario/pendientes', element: <PropietarioLayout><PropietarioPendientes /></PropietarioLayout> },
  { path: '/propietario/perfil', element: <PropietarioLayout><PropietarioPerfil /></PropietarioLayout> },
  { path: '/propietario/comprobante', element: <PropietarioLayout><PropietarioComprobante /></PropietarioLayout> },

  // Inquilino
  { path: '/inquilino/mi-panel', element: <InquilinoLayout><InquilinoPanel /></InquilinoLayout> },
  { path: '/inquilino/deudas', element: <InquilinoLayout><InquilinoDeudas /></InquilinoLayout> },
  { path: '/inquilino/pagos', element: <InquilinoLayout><InquilinoPagos /></InquilinoLayout> },
  { path: '/inquilino/comprobante', element: <InquilinoLayout><InquilinoComprobante /></InquilinoLayout> },

  // Mantenimiento
  { path: '/mantenimiento/tareas', element: <MantenimientoLayout><MantenimientoTareas /></MantenimientoLayout> },
  { path: '/mantenimiento/nueva-tarea', element: <MantenimientoLayout><MantenimientoNuevaTarea /></MantenimientoLayout> },
  { path: '/mantenimiento/estado', element: <MantenimientoLayout><MantenimientoEstado /></MantenimientoLayout> },
];
