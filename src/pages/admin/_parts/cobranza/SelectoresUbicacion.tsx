import { useResource } from '../../../../api';
import { Select } from '../../../../ui';
import type { Complejo, Lista } from './comun';
import { etiquetaTorre, hayVariosCondominios } from './torres';
import { useTorres } from './useTorres';

interface Props {
  /** Condominio elegido ('' = todos). */
  complejo: string;
  torre: string;
  onComplejo: (v: string) => void;
  onTorre: (v: string) => void;
  /** Condominio fijo (ficha del condominio): sin selector de condominio y las torres son las suyas. */
  complejoFijo?: number;
  /** La junta no lista condominios ni torres (sólo ve la suya): no se piden ni se muestran. */
  oculto?: boolean;
}

/**
 * Filtros «Condominio» y «Torre» de las listas de cobranza. Cada torre tiene su recibo, su junta y sus cuentas: se filtra por ella.
 * Las torres son las del condominio elegido (o, sin elegir, las de todos; con más de un condominio se rotulan «Block 1 · Condominio»).
 * El selector de condominio sólo aparece si hay más de uno; el de torre, sólo si hay torres.
 */
export function SelectoresUbicacion({ complejo, torre, onComplejo, onTorre, complejoFijo, oculto = false }: Props) {
  const complejos = useResource<Lista<Complejo>>(complejoFijo || oculto ? null : '/api/complejos?pageSize=100');
  const torres = useTorres(complejoFijo ?? (complejo || null), !oculto);
  const opcionesComplejo = complejos.data?.items ?? [];
  const opcionesTorre = torres.data?.items ?? [];
  const varios = hayVariosCondominios(opcionesTorre);
  return (
    <>
      {!complejoFijo && opcionesComplejo.length > 1 && (
        <Select label="Condominio" className="w-full sm:w-56 [&_label]:sr-only" value={complejo} onChange={e => { onComplejo(e.target.value); onTorre(''); }}>
          <option value="">Todos los condominios</option>
          {opcionesComplejo.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </Select>
      )}
      {opcionesTorre.length > 0 && (
        <Select label="Torre" className="w-full sm:w-56 [&_label]:sr-only" value={torre} onChange={e => onTorre(e.target.value)}>
          <option value="">Todas las torres</option>
          {opcionesTorre.map(t => <option key={t.id} value={t.id}>{etiquetaTorre(t, varios)}</option>)}
        </Select>
      )}
    </>
  );
}
