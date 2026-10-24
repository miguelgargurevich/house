import type { ComponentType, SVGProps } from 'react';
import {
  HomeIcon, BuildingOffice2Icon, UsersIcon, ClipboardDocumentListIcon, Cog6ToothIcon, BuildingStorefrontIcon,
  ReceiptPercentIcon, BanknotesIcon, ExclamationTriangleIcon, WrenchScrewdriverIcon, TagIcon, KeyIcon,
  CreditCardIcon, UserCircleIcon, ShieldCheckIcon, LockClosedIcon, BellIcon,
} from '@heroicons/react/24/outline';
import type { Rol } from '../auth/AuthContext';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
export interface NavItem { to: string; label: string; icon: Icon }
export interface NavGroup { label?: string; items: NavItem[] }

const operacion: NavItem[] = [
  { to: '/admin/complejos', label: 'Condominios', icon: BuildingStorefrontIcon },
  { to: '/admin/unidades', label: 'Unidades', icon: KeyIcon },
  { to: '/admin/recibos', label: 'Recibos', icon: ReceiptPercentIcon },
  { to: '/admin/pagos', label: 'Pagos', icon: BanknotesIcon },
  { to: '/admin/morosidad', label: 'Morosidad', icon: ExclamationTriangleIcon },
  { to: '/admin/mantenimientos', label: 'Mantenimiento', icon: WrenchScrewdriverIcon },
  { to: '/admin/conceptos', label: 'Conceptos', icon: TagIcon },
  { to: '/admin/usuarios', label: 'Usuarios', icon: UsersIcon },
  { to: '/admin/avisos', label: 'Avisos', icon: BellIcon },
];

export const NAV: Record<Rol, NavGroup[]> = {
  superadmin: [
    { items: [{ to: '/superadmin/dashboard', label: 'Resumen', icon: HomeIcon }] },
    {
      label: 'Plataforma',
      items: [
        { to: '/superadmin/empresas', label: 'Empresas', icon: BuildingOffice2Icon },
        { to: '/superadmin/usuarios', label: 'Usuarios globales', icon: UsersIcon },
        { to: '/superadmin/auditoria', label: 'Auditoría', icon: ClipboardDocumentListIcon },
        { to: '/superadmin/llavero', label: 'Llavero de IA', icon: LockClosedIcon },
      ],
    },
    { label: 'Operación', items: operacion.filter(i => i.to !== '/admin/usuarios') },
  ],
  admin: [
    { items: [{ to: '/admin/dashboard', label: 'Resumen', icon: HomeIcon }] },
    { label: 'Operación', items: operacion },
    { label: 'Cuenta', items: [{ to: '/admin/configuracion', label: 'Mi empresa', icon: Cog6ToothIcon }] },
  ],
  propietario: [
    { items: [
      { to: '/propietario/inicio', label: 'Inicio', icon: HomeIcon },
      { to: '/propietario/unidades', label: 'Mis unidades', icon: KeyIcon },
      { to: '/propietario/cargos', label: 'Mis recibos', icon: ReceiptPercentIcon },
      { to: '/propietario/pagos', label: 'Mis pagos', icon: CreditCardIcon },
    ] },
  ],
  inquilino: [
    { items: [
      { to: '/inquilino/inicio', label: 'Inicio', icon: HomeIcon },
      { to: '/inquilino/cargos', label: 'Mis recibos', icon: ReceiptPercentIcon },
      { to: '/inquilino/pagos', label: 'Mis pagos', icon: CreditCardIcon },
    ] },
  ],
  mantenimiento: [
    { items: [
      { to: '/mantenimiento/inicio', label: 'Inicio', icon: HomeIcon },
      { to: '/mantenimiento/tareas', label: 'Mis tareas', icon: WrenchScrewdriverIcon },
    ] },
  ],
  seguridad: [
    { items: [
      { to: '/seguridad/inicio', label: 'Inicio', icon: ShieldCheckIcon },
      { to: '/seguridad/unidades', label: 'Unidades', icon: KeyIcon },
    ] },
  ],
};

export const PERFIL: NavItem = { to: '/perfil', label: 'Mi perfil', icon: UserCircleIcon };

export const ROL_LABEL: Record<Rol, string> = {
  superadmin: 'Superadministrador',
  admin: 'Administrador',
  propietario: 'Propietario',
  inquilino: 'Inquilino',
  mantenimiento: 'Mantenimiento',
  seguridad: 'Seguridad',
};
