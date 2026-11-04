import type { CSSProperties } from 'react';
import { inicialDeMarca, variablesCss, type PaletaDeMarca } from '../../../../lib/marca';
import { ImagenRecibo } from '../../../shared/mantenimiento/ImagenRecibo';

interface Props {
  paleta: PaletaDeMarca;
  /** Nombre que se vería (el comercial, o la razón social si está vacío). */
  nombre: string;
  logoUrl: string | null;
  oscuro: boolean;
}

/** Logo (o la inicial en un cuadro del color de la marca) de las muestras. */
function Sello({ nombre, logoUrl }: { nombre: string; logoUrl: string | null }) {
  return logoUrl
    ? <ImagenRecibo src={logoUrl} alt="" className="h-7 w-auto max-w-[2.75rem] shrink-0 rounded object-contain" />
    : <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded bg-brand text-sm font-bold text-on-brand">{inicialDeMarca(nombre)}</span>;
}

/**
 * Vista previa EN VIVO de la marca: un botón, el encabezado del menú y la cabecera de un recibo. Las variables CSS se ponen sólo en este contenedor (con el tema que
 * se está usando), así que elegir un color no cambia el resto de la pantalla hasta guardar.
 */
export function VistaPrevia({ paleta, nombre, logoUrl, oscuro }: Props) {
  const estilo = variablesCss(oscuro ? paleta.oscuro : paleta.claro) as CSSProperties;
  return (
    <div style={estilo} className="grid gap-3 rounded border border-line bg-bg p-3 sm:grid-cols-2" aria-label="Vista previa de tu marca" role="group">
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Botón</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex h-10 items-center rounded bg-brand px-4 text-sm font-medium text-on-brand">Pagar mi recibo</span>
            <span className="text-sm font-medium text-brand">Ver detalle</span>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Encabezado del menú</p>
          <div className="rounded border border-line bg-surface">
            <div className="flex h-14 items-center gap-2.5 px-4 font-semibold tracking-tight"><Sello nombre={nombre} logoUrl={logoUrl} /><span className="truncate">{nombre}</span></div>
            <p className="rounded-b bg-brand-soft px-4 py-2 text-sm font-medium text-brand">Recibos</p>
            <p className="border-t border-line px-4 py-2 text-xs text-muted">con Torre</p>
          </div>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Cabecera del recibo</p>
        {/* El recibo es una hoja blanca en los dos temas: la franja usa el color del tema claro. */}
        <div className="overflow-hidden rounded border border-neutral-300 bg-white text-neutral-900">
          <div className="h-1.5" style={{ backgroundColor: paleta.hex.claro.brand }} />
          <div className="flex items-center gap-2.5 px-3 py-3">
            {logoUrl
              ? <ImagenRecibo src={logoUrl} alt="" className="h-9 w-auto max-w-[3.5rem] shrink-0 object-contain" />
              : <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded text-base font-bold" style={{ backgroundColor: paleta.hex.claro.brand, color: paleta.hex.claro.onBrand }}>{inicialDeMarca(nombre)}</span>}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold uppercase">{nombre}</p>
              <p className="text-xs text-neutral-600">Recibo de mantenimiento mensual</p>
            </div>
          </div>
          <p className="border-t border-neutral-200 px-3 py-1.5 text-[0.7rem] text-neutral-500">con Torre</p>
        </div>
      </div>
    </div>
  );
}
