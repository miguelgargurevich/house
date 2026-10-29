import type { FichaJunta } from '../juntas/tipos';
import type { GrupoCuentas } from './CuentasPorBlock';
import type { Medio } from './tipos';

/**
 * Una tarjeta por block en el orden de «Juntas directivas» (y la Junta central si existe o tiene cuentas); las cuentas van con su block.
 * Un block sin junta ni cuenta también sale: es justo el que falta completar. `torre` = filtro ('' todos, 'ninguna' = todo el condominio).
 */
export function agrupar(fichas: FichaJunta[], medios: Medio[], torre: string): GrupoCuentas[] {
  const clave = (complejoId: number, estructuraId: number | null) => `${complejoId}:${estructuraId ?? 'condominio'}`;
  const grupos = new Map<string, GrupoCuentas>();
  for (const f of fichas) grupos.set(clave(f.complejo.id, f.estructura?.id ?? null), { clave: clave(f.complejo.id, f.estructura?.id ?? null), complejo: f.complejo, estructura: f.estructura, ficha: f, medios: [] });
  for (const m of medios) {
    const k = clave(m.complejo_id, m.estructura_id);
    let g = grupos.get(k);
    if (!g) {
      g = { clave: k, complejo: m.complejo ?? { id: m.complejo_id, nombre: '' }, estructura: m.estructura ?? (m.estructura_id != null ? { id: m.estructura_id, nombre: null } : null), ficha: null, medios: [] };
      grupos.set(k, g);
    }
    g.medios.push(m);
  }
  return [...grupos.values()].filter(g => (torre === '' ? true : torre === 'ninguna' ? g.estructura === null : String(g.estructura?.id) === torre));
}
