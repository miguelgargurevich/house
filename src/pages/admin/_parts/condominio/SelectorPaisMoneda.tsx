import { MONEDAS, PAISES, monedaDe, monedaDelPais } from '../../../../lib/paises';
import { Select } from '../../../../ui';

export interface PaisMoneda { pais: string; moneda: string }

interface Props {
  valor: PaisMoneda;
  onCambio: (v: PaisMoneda) => void;
  /** Al crear, `''` significa «el de tu empresa» (país) y «el de su país» (moneda): el servidor lo completa. */
  alCrear?: boolean;
}

/** País y moneda de un condominio, del catálogo `src/lib/paises.ts`. Al elegir el país se propone su moneda; se puede cambiar. */
export function SelectorPaisMoneda({ valor, onCambio, alCrear = false }: Props) {
  const elegirPais = (pais: string) => onCambio({ pais, moneda: pais ? monedaDelPais(pais) : '' });
  return (
    <>
      <Select label="País" value={valor.pais} onChange={e => elegirPais(e.target.value)} hint="Define la moneda que se propone para los recibos.">
        {alCrear && <option value="">El de tu empresa</option>}
        {PAISES.map(p => <option key={p.codigo} value={p.codigo}>{p.bandera} {p.nombre}</option>)}
      </Select>
      <Select
        label="Moneda"
        value={valor.moneda}
        onChange={e => onCambio({ ...valor, moneda: e.target.value })}
        hint={alCrear ? 'Los recibos, pagos y avisos de este condominio van en esta moneda. Con recibos emitidos ya no se puede cambiar.' : 'Con recibos emitidos, la moneda ya no se puede cambiar.'}
      >
        {alCrear && <option value="">{valor.pais ? `La de su país (${monedaDe(monedaDelPais(valor.pais))?.codigo})` : 'La de su país'}</option>}
        {MONEDAS.map(m => <option key={m.codigo} value={m.codigo}>{m.simbolo} · {m.nombre} ({m.codigo})</option>)}
      </Select>
    </>
  );
}
