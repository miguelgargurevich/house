import type { ComponentType, SVGProps } from 'react';
import {
  BeakerIcon, ChatBubbleLeftRightIcon, HomeIcon, BuildingOffice2Icon, UsersIcon, ClipboardDocumentListIcon, Cog6ToothIcon, BuildingStorefrontIcon,
  ReceiptPercentIcon, BanknotesIcon, ExclamationTriangleIcon, WrenchScrewdriverIcon, TagIcon, KeyIcon,
  ChartBarIcon, CreditCardIcon, UserCircleIcon, ShieldCheckIcon, LockClosedIcon, BellIcon, QrCodeIcon, TruckIcon, SparklesIcon,
  SunIcon,
} from '@heroicons/react/24/outline';
import { esJunta } from '../auth/junta';
import type { Rol, Usuario } from '../auth/AuthContext';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
export interface NavItem { to: string; label: string; icon: Icon }
export interface NavGroup { label?: string; items: NavItem[] }

/** Condominios: la lista y, desde la ficha, sus torres, unidades, residentes y recibos. */
const condominios: NavItem = { to: '/admin/complejos', label: 'Condominios', icon: BuildingStorefrontIcon };

/** Cobranza: lo que se emite, se cobra y se fiscaliza. */
const cobranza: NavItem[] = [
  { to: '/admin/recibos', label: 'Recibos', icon: ReceiptPercentIcon },
  { to: '/admin/pagos', label: 'Pagos', icon: BanknotesIcon },
  { to: '/admin/medios-pago', label: 'Medios de pago', icon: QrCodeIcon },
  { to: '/admin/morosidad', label: 'Morosidad', icon: ExclamationTriangleIcon },
];

/** Operación: el día a día del condominio. */
const operacion: NavItem[] = [
  { to: '/admin/unidades', label: 'Unidades', icon: KeyIcon },
  { to: '/admin/mantenimientos', label: 'Mantenimiento', icon: WrenchScrewdriverIcon },
  { to: '/admin/conceptos', label: 'Conceptos', icon: TagIcon },
  { to: '/admin/avisos', label: 'Avisos', icon: BellIcon },
  { to: '/admin/whatsapp', label: 'WhatsApp', icon: QrCodeIcon },
  { to: '/admin/proveedores', label: 'Proveedores', icon: TruckIcon },
];

export const NAV: Record<Rol, NavGroup[]> = {
  superadmin: [
    { items: [
      { to: '/superadmin/dashboard', label: 'Resumen', icon: HomeIcon },
      { to: '/superadmin/empresas', label: 'Empresas', icon: BuildingOffice2Icon },
      condominios,
    ] },
    { label: 'Cobranza', items: cobranza },
    // WhatsApp (QR del número) es de cada administradora; el superadmin lo ve todo en «Canales e integraciones».
    { label: 'Operación', items: operacion.filter(i => i.to !== '/admin/whatsapp') },
    {
      label: 'Plataforma',
      items: [
        { to: '/superadmin/usuarios', label: 'Usuarios del sistema', icon: UsersIcon },
        { to: '/superadmin/auditoria', label: 'Auditoría', icon: ClipboardDocumentListIcon },
        { to: '/superadmin/llavero', label: 'Llavero de IA', icon: LockClosedIcon },
        { to: '/superadmin/integraciones', label: 'Canales e integraciones', icon: ChatBubbleLeftRightIcon },
        { to: '/superadmin/suscripciones', label: 'Suscripciones', icon: CreditCardIcon },
      ],
    },
  ],
  admin: [
    { items: [
      { to: '/admin/dashboard', label: 'Resumen', icon: HomeIcon },
      condominios,
    ] },
    { label: 'Cobranza', items: cobranza },
    { label: 'Operación', items: operacion },
    { label: 'Cuenta', items: [{ to: '/admin/configuracion', label: 'Mi empresa', icon: Cog6ToothIcon }, { to: '/admin/mi-plan', label: 'Mi plan', icon: CreditCardIcon }] },
  ],
  propietario: [
    { items: [
      { to: '/propietario/inicio', label: 'Inicio', icon: HomeIcon },
      { to: '/propietario/unidades', label: 'Mis unidades', icon: KeyIcon },
      { to: '/propietario/cargos', label: 'Mis recibos', icon: ReceiptPercentIcon },
      { to: '/propietario/pagos', label: 'Mi historial', icon: ChartBarIcon },
    ] },
  ],
  inquilino: [
    { items: [
      { to: '/inquilino/inicio', label: 'Inicio', icon: HomeIcon },
      { to: '/inquilino/cargos', label: 'Mis recibos', icon: ReceiptPercentIcon },
      { to: '/inquilino/pagos', label: 'Mi historial', icon: ChartBarIcon },
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

/** Grupo «Junta» de presidente y tesorero: reusa las pantallas de la administración, acotadas por la API a su torre. */
const JUNTA: NavGroup = {
  label: 'Junta',
  items: [
    { to: '/junta/medios-pago', label: 'Medios de pago', icon: QrCodeIcon },
    { to: '/junta/pagos', label: 'Pagos por validar', icon: BanknotesIcon },
    { to: '/junta/agua', label: 'Lecturas de agua', icon: BeakerIcon },
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
