import { ChatBubbleLeftRightIcon, EnvelopeIcon, PhoneIcon } from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import { Badge, Card, CardBody, CardHeader } from '../../../../ui';
import { rubroLabel } from '../../../admin/_parts/personas/proveedores';
import { enlaceEscribir, enlaceLlamar, enlaceWhatsApp } from './enlaces';
import type { GrupoProveedores, ProveedorVecino } from './enlaces';

function Accion({ href, icon: Icon, children, nombre }: { href: string; icon: ComponentType<SVGProps<SVGSVGElement>>; children: string; nombre: string }) {
  const externo = href.startsWith('https://');
  return (
    <a
      href={href}
      aria-label={`${children} a ${nombre}`}
      {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="inline-flex h-10 items-center justify-center gap-2 rounded border border-line bg-surface px-3 text-sm font-medium text-brand transition-colors duration-150 hover:bg-surface2"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{children}
    </a>
  );
}

function Ficha({ p }: { p: ProveedorVecino }) {
  const llamar = enlaceLlamar(p.telefono);
  const whatsapp = enlaceWhatsApp(p.telefono);
  const escribir = enlaceEscribir(p.email);
  return (
    <li className="min-w-0 rounded-lg border border-line p-3 text-sm">
      <p className="break-words font-medium">{p.razon_social}</p>
      {p.contacto_nombre && <p className="break-words text-muted">Contacto: {p.contacto_nombre}</p>}
      {p.telefono && <p className="num break-words text-muted">{p.telefono}</p>}
      {p.email && <p className="break-all text-muted">{p.email}</p>}
      {(llamar || whatsapp || escribir) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {llamar && <Accion href={llamar} icon={PhoneIcon} nombre={p.razon_social}>Llamar</Accion>}
          {whatsapp && <Accion href={whatsapp} icon={ChatBubbleLeftRightIcon} nombre={p.razon_social}>WhatsApp</Accion>}
          {escribir && <Accion href={escribir} icon={EnvelopeIcon} nombre={p.razon_social}>Escribir</Accion>}
        </div>
      ) : <p className="mt-2 text-xs text-muted">Sin datos de contacto: pregunta a tu administración.</p>}
    </li>
  );
}

/** Los proveedores de un rubro: una tarjeta por rubro, una ficha por proveedor con sus botones de contacto. */
export function ProveedorVecinoCard({ grupo }: { grupo: GrupoProveedores }) {
  return (
    <Card>
      <CardHeader title={rubroLabel(grupo.rubro)} action={<Badge tone="brand">{grupo.proveedores.length}</Badge>} />
      <CardBody>
        <ul className="grid gap-2 sm:grid-cols-2">
          {grupo.proveedores.map((p, i) => <Ficha key={`${p.razon_social}-${i}`} p={p} />)}
        </ul>
      </CardBody>
    </Card>
  );
}
