import { useCondominio } from '../../../../app/condominio';
import { Select, Toolbar } from '../../../../ui';
import { etiquetaTorre, hayVariosCondominios, palabraDeTorres } from './torres';
import { useTorres } from './useTorres';

interface Props {
  torre: string;
  onTorre: (v: string) => void;
  /** Condominio fijo (ficha del condominio): las torres son las suyas y no se mira el condominio de la barra superior. */
  complejoFijo?: number;
  /** La junta no lista torres (sólo ve la suya): no se piden ni se muestran. */
  oculto?: boolean;
  /** Si no hay nada que mostrar no deja ni la barra ni el hueco: `toolbar` = barra de la tarjeta; `fila` = fila suelta sobre la página. */
  envoltura?: 'toolbar' | 'fila';
}

/**
 * Filtro de torre (block) de las listas de cobranza. El condominio ya no se elige aquí sino arriba, en la barra (`SelectorCondominio`): las
 * torres son las del condominio elegido. Con «Todos los condominios» (y más de uno) el filtro se oculta: «Block 1» de un condominio y de
 * otro se confundirían. Cada torre tiene su recibo, su junta y sus cuentas: se filtra por ella. Sólo aparece si hay torres.
 */
export function SelectoresUbicacion({ torre, onTorre, complejoFijo, oculto = false, envoltura }: Props) {
  const { complejo: elegido, varios } = useCondominio();
  const complejo = complejoFijo ? String(complejoFijo) : elegido;
  const sinCondominio = !complejo && varios;
  const torres = useTorres(complejo || null, !oculto && !sinCondominio);
  const opciones = oculto || sinCondominio ? [] : torres.data?.items ?? [];
  if (opciones.length === 0) return null;
  const palabra = palabraDeTorres(opciones);
  const select = (
    <Select label={palabra.titulo} className="w-full sm:w-56 [&_label]:sr-only" value={torre} onChange={e => onTorre(e.target.value)}>
      <option value="">{palabra.todas}</option>
      {opciones.map(t => <option key={t.id} value={t.id}>{etiquetaTorre(t, hayVariosCondominios(opciones))}</option>)}
    </Select>
  );
  return envoltura === 'toolbar' ? <Toolbar>{select}</Toolbar> : envoltura === 'fila' ? <div className="mb-4 flex flex-wrap gap-3">{select}</div> : select;
}
