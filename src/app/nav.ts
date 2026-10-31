import type { ComponentType, SVGProps } from 'react';
import {
  BeakerIcon, ChatBubbleLeftRightIcon, HomeIcon, BuildingOffice2Icon, UsersIcon, ClipboardDocumentListIcon, Cog6ToothIcon, BuildingStorefrontIcon,
  ReceiptPercentIcon, BanknotesIcon, ExclamationTriangleIcon, WrenchScrewdriverIcon, TagIcon, KeyIcon,
  ChartBarIcon, CreditCardIcon, UserCircleIcon, ShieldCheckIcon, LockClosedIcon, QrCodeIcon, TruckIcon, SparklesIcon,
  SunIcon, MegaphoneIcon, UserGroupIcon, CalendarDaysIcon, ArchiveBoxArrowDownIcon, BuildingLibraryIcon, HomeModernIcon, CalendarIcon,
} from '@heroicons/react/24/outline';
import { esJunta } from '../auth/junta';
import type { CargoJunta, Rol, Usuario } from '../auth/AuthContext';

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
  { to: '/admin/cierres', label: 'Cierres del mes', icon: CalendarDaysIcon },
];

/** Operación: el día a día del condominio. */
const operacion: NavItem[] = [
  { to: '/admin/unidades', label: 'Unidades', icon: KeyIcon },
  { to: '/admin/mantenimientos', label: 'Mantenimiento', icon: WrenchScrewdriverIcon },
  { to: '/admin/conceptos', label: 'Conceptos', icon: TagIcon },
  { to: '/admin/comunicados', label: 'Comunicados', icon: MegaphoneIcon },
  { to: '/admin/areas-comunes', label: 'Áreas comunes', icon: HomeModernIcon },
  { to: '/admin/juntas', label: 'Juntas directivas', icon: UserGroupIcon },
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
      { to: '/propietario/junta', label: 'Mi junta', icon: UserGroupIcon },
      { to: '/propietario/proveedores', label: 'Proveedores', icon: TruckIcon },
      { to: '/propietario/comunicados', label: 'Comunicados', icon: MegaphoneIcon },
      { to: '/propietario/reservas', label: 'Reservas', icon: CalendarIcon },
    ] },
  ],
  inquilino: [
    { items: [
      { to: '/inquilino/inicio', label: 'Inicio', icon: HomeIcon },
      { to: '/inquilino/cargos', label: 'Mis recibos', icon: ReceiptPercentIcon },
      { to: '/inquilino/pagos', label: 'Mi historial', icon: ChartBarIcon },
      { to: '/inquilino/junta', label: 'Mi junta', icon: UserGroupIcon },
      { to: '/inquilino/proveedores', label: 'Proveedores', icon: TruckIcon },
      { to: '/inquilino/comunicados', label: 'Comunicados', icon: MegaphoneIcon },
      { to: '/inquilino/reservas', label: 'Reservas', icon: CalendarIcon },
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
    { to: '/junta/mi-junta', label: 'Mi junta', icon: UserGroupIcon },
    { to: '/junta/medios-pago', label: 'Medios de pago', icon: QrCodeIcon },
    { to: '/junta/pagos', label: 'Pagos por validar', icon: BanknotesIcon },
    { to: '/junta/cierre', label: 'Cierre del mes', icon: CalendarDaysIcon },
    { to: '/junta/agua', label: 'Lecturas de agua', icon: BeakerIcon },
    { to: '/junta/comunicados', label: 'Comunicados', icon: MegaphoneIcon },
    { to: '/junta/proveedores', label: 'Proveedores', icon: TruckIcon },
  ],
};

/** Sólo la Junta central (presidente o tesorero sin block): lo que cada block transfirió a su cuenta al cerrar el mes. */
const APORTES: NavItem = { to: '/junta/aportes', label: 'Aportes de los blocks', icon: ArchiveBoxArrowDownIcon };

/** Sólo la Junta central: lo que entra y sale de su cuenta (aportes de los blocks, alquiler de estacionamientos, servicios y proveedores) y su Fondo de ahorros. */
const CIERRE_CENTRAL: NavItem = { to: '/junta/cierre-central', label: 'Cierre de la Junta central', icon: BuildingLibraryIcon };

/** La navegación depende del rol y, para propietarios, del cargo en la junta. */
/** Lo único que ve una administradora que todavía no creó su condominio (paso 2 del registro): su bienvenida. El menú completo llega con el primer condominio. */
export const NAV_SIN_CONDOMINIO: NavGroup[] = [{ items: [{ to: '/admin/bienvenida', label: 'Bienvenida', icon: HomeIcon }] }];

export function navPara(user: Pick<Usuario, 'rol' | 'cargo_junta' | 'complejo_id'> & { estructura_id?: number | null }, opts: { sinCondominios?: boolean } = {}): NavGroup[] {
  if (user.rol === 'admin' && opts.sinCondominios) return NAV_SIN_CONDOMINIO;
  if (!esJunta(user)) return NAV[user.rol];
  // La Junta central (sin block) ve además lo que cada block le transfirió.
  const central = user.estructura_id == null;
  return [...NAV[user.rol], central ? { ...JUNTA, items: [...JUNTA.items, APORTES, CIERRE_CENTRAL] } : JUNTA];
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

/** Cargos en masculino genérico, como los muestra la pantalla de Juntas. */
const CARGO_LABEL: Record<CargoJunta, string> = { presidente: 'Presidente', tesorero: 'Tesorero', secretario: 'Secretario', vocal: 'Vocal' };

/**
 * Rótulo del rol con el cargo en la junta: «Propietario · Tesorero del Block 1» o «Propietario · Presidente de la Junta central».
 * Sin cargo, el rol de siempre. Si el block no tiene nombre, el rótulo no lo menciona («Propietario · Tesorero»).
 */
export function rotuloRol(user: Pick<Usuario, 'rol' | 'cargo_junta' | 'estructura_id' | 'estructura_nombre'>): string {
  const rol = ROL_LABEL[user.rol];
  if (!user.cargo_junta) return rol;
  const lugar = user.estructura_id == null ? ' de la Junta central' : user.estructura_nombre ? ` del ${user.estructura_nombre}` : '';
  return `${rol} · ${CARGO_LABEL[user.cargo_junta]}${lugar}`;
}
