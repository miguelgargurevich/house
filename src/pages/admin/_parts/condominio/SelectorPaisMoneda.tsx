import { MONEDAS, PAISES, ZONA_POR_DEFECTO, monedaDe, monedaDelPais, zonaDelPais, zonasDe } from '../../../../lib/paises';
import { Select } from '../../../../ui';

/** `zona`: la zona horaria IANA del condominio (`''` al crear = la de su país). */
export interface PaisMoneda { pais: string; moneda: string; zona: string }

interface Props {
  valor: PaisMoneda;
  onCambio: (v: PaisMoneda) => void;
  /** Al crear, `''` significa «el de tu empresa» (país) y «el de su país» (moneda): el servidor lo completa. */
  alCrear?: boolean;
}

/** «Ciudad de México (GMT-6)»: la zona con su desfase de hoy (el de verano o el de invierno, según la fecha). */
export function etiquetaZona(zona: string, ahora: Date = new Date()): string {
  const ciudad = (zona.split('/').pop() ?? zona).replace(/_/g, ' ');
  try {
    const desfase = new Intl.DateTimeFormat('es', { timeZone: zona, timeZoneName: 'shortOffset' }).formatToParts(ahora).find(p => p.type === 'timeZoneName')?.value;
    return desfase ? `${ciudad} (${desfase})` : ciudad;
  } catch {
    return ciudad;
  }
}

/** País, moneda y zona horaria de un condominio, del catálogo `src/lib/paises.ts`. Al elegir el país se proponen su moneda y su zona; se pueden cambiar. */
export function SelectorPaisMoneda({ valor, onCambio, alCrear = false }: Props) {
  const elegirPais = (pais: string) => onCambio({ pais, moneda: pais ? monedaDelPais(pais) : '', zona: pais ? zonaDelPais(pais) : '' });
  // Las zonas del país; si el condominio ya tiene otra (una que se tecleó por la API), se ofrece también para no perderla.
  const zonas = valor.pais ? [...zonasDe(valor.pais)] : [];
  if (valor.zona && !zonas.includes(valor.zona)) zonas.push(valor.zona);
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
      <Select
        label="Zona horaria"
        className="sm:col-span-2"
        value={valor.zona}
        onChange={e => onCambio({ ...valor, zona: e.target.value })}
        hint="Con su hora se cuenta cuándo vence un recibo, desde cuándo hay mora y cuándo salen los avisos."
      >
        {alCrear && <option value="">{valor.pais ? `La de su país (${etiquetaZona(zonaDelPais(valor.pais))})` : 'La de su país'}</option>}
        {zonas.map(z => <option key={z} value={z}>{etiquetaZona(z)}</option>)}
        {!alCrear && !zonas.length && <option value={ZONA_POR_DEFECTO}>{etiquetaZona(ZONA_POR_DEFECTO)}</option>}
      </Select>
    </>
  );
}
