import type { ComponentType, SVGProps } from 'react';
import {
  HomeIcon, BuildingOffice2Icon, UsersIcon, ClipboardDocumentListIcon, Cog6ToothIcon, BuildingStorefrontIcon,
  ReceiptPercentIcon, BanknotesIcon, ExclamationTriangleIcon, WrenchScrewdriverIcon, TagIcon, KeyIcon,
  CreditCardIcon, UserCircleIcon, ShieldCheckIcon, LockClosedIcon, BellIcon, QrCodeIcon, IdentificationIcon, TruckIcon, SparklesIcon,
  SunIcon,
} from '@heroicons/react/24/outline';
import { esJunta } from '../auth/junta';
import type { Rol, Usuario } from '../auth/AuthContext';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
export interface NavItem { to: string; label: string; icon: Icon }
export interface NavGroup { label?: string; items: NavItem[] }

const operacion: NavItem[] = [
  { to: '/admin/complejos', label: 'Condominios', icon: BuildingStorefrontIcon },
  { to: '/admin/unidades', label: 'Unidades', icon: KeyIcon },
  { to: '/admin/recibos', label: 'Recibos', icon: ReceiptPercentIcon },
  { to: '/admin/pagos', label: 'Pagos', icon: BanknotesIcon },
  { to: '/admin/medios-pago', label: 'Medios de pago', icon: QrCodeIcon },
  { to: '/admin/morosidad', label: 'Morosidad', icon: ExclamationTriangleIcon },
  { to: '/admin/mantenimientos', label: 'Mantenimiento', icon: WrenchScrewdriverIcon },
  { to: '/admin/conceptos', label: 'Conceptos', icon: TagIcon },
  { to: '/admin/avisos', label: 'Avisos', icon: BellIcon },
];

/** Personas, cada tipo en su pantalla: residentes (de un condominio), personal (de la empresa) y proveedores (directorio, sin acceso). */
const personas: NavItem[] = [
  { to: '/admin/residentes', label: 'Residentes', icon: UsersIcon },
  { to: '/admin/personal', label: 'Personal', icon: IdentificationIcon },
  { to: '/admin/proveedores', label: 'Proveedores', icon: TruckIcon },
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
    { label: 'Operación', items: operacion },
    { label: 'Personas', items: personas },
  ],
  admin: [
    { items: [{ to: '/admin/dashboard', label: 'Resumen', icon: HomeIcon }] },
    { label: 'Operación', items: operacion },
    { label: 'Personas', items: personas },
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
  limpieza: [
    { items: [
      { to: '/limpieza/inicio', label: 'Inicio', icon: SparklesIcon },
      { to: '/limpieza/tareas', label: 'Mis tareas', icon: WrenchScrewdriverIcon },
    ] },
  ],
  jardineria: [
    { items: [
      { to: '/jardineria/inicio', label: 'Inicio', icon: SunIcon },
      { to: '/jardineria/tareas', label: 'Mis tareas', icon: WrenchScrewdriverIcon },
    ] },
  ],
};

/** Grupo «Junta» de presidente y tesorero: reusa las pantallas de la administración, acotadas por la API a su block. */
const JUNTA: NavGroup = {
  label: 'Junta',
  items: [
    { to: '/junta/medios-pago', label: 'Medios de pago', icon: QrCodeIcon },
    { to: '/junta/pagos', label: 'Pagos por validar', icon: BanknotesIcon },
  ],
};

/** La navegación depende del rol y, para propietarios, del cargo en la junta. */
export function navPara(user: Pick<Usuario, 'rol' | 'cargo_junta' | 'complejo_id'>): NavGroup[] {
  return esJunta(user) ? [...NAV[user.rol], JUNTA] : NAV[user.rol];
}

export const PERFIL: NavItem = { to: '/perfil', label: 'Mi perfil', icon: UserCircleIcon };

export const ROL_LABEL: Record<Rol, string> = {
  superadmin: 'Superadministrador',
  admin: 'Administrador',
  propietario: 'Propietario',
  inquilino: 'Inquilino',
  mantenimiento: 'Mantenimiento',
  seguridad: 'Seguridad',
  limpieza: 'Limpieza',
  jardineria: 'Jardinería',
};
