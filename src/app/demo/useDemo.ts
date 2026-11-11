// ¿Esta instancia es una demo? Lo dice `GET /api/demo/estado` (200 sólo con el modo demostración encendido; 404 en cualquier otra instancia).
// Sólo preguntan las direcciones donde puede haber una demo (`demo.…` y local): en torrecondominios.com no se hace ninguna petición de más.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { casillasDe, claveDeCasillas } from './guia';
import { puedeSerDemo } from './enlaces';
import type { RolDemo } from './roles';

export interface EstadoDemo { demo: true; roles: string[]; reinicia_a_las: string; sembrada_at: string | null; reiniciando: boolean }

export { URL_DEMO, URL_TORRE, puedeSerDemo } from './enlaces';

let consulta: Promise<EstadoDemo | null> | null = null;
function consultarDemo(): Promise<EstadoDemo | null> {
  if (typeof window === 'undefined' || !puedeSerDemo(window.location.hostname)) return Promise.resolve(null);
  consulta ??= api<EstadoDemo>('/api/demo/estado').then((e) => (e?.demo === true ? e : null), () => null);
  return consulta;
}

export function useModoDemo(): { demo: boolean; cargando: boolean; estado: EstadoDemo | null } {
  const [estado, setEstado] = useState<EstadoDemo | null>(null);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vivo = true;
    void consultarDemo().then((e) => { if (vivo) { setEstado(e); setCargando(false); } });
    return () => { vivo = false; };
  }, []);
  return { demo: estado != null, cargando, estado };
}

// El navegador puede negarse a guardar (modo privado, datos bloqueados): todo funciona igual, sin recordar.
const leer = (almacen: 'local' | 'sesion', clave: string): string | null => {
  try { return (almacen === 'local' ? localStorage : sessionStorage).getItem(clave); } catch { return null; }
};
const guardar = (almacen: 'local' | 'sesion', clave: string, valor: string) => {
  try { (almacen === 'local' ? localStorage : sessionStorage).setItem(clave, valor); } catch { /* sin almacenamiento */ }
};

export const CLAVE_ROL_DEMO = 'house-demo-rol';
const CLAVE_ABRIR_GUIA = 'house-demo-abrir-guia';

/** Lo que `/demo` anota al entrar: el rol elegido y que la guía «Qué probar» se abra sola una vez. */
export function anotarEntrada(rol: RolDemo): void {
  guardar('sesion', CLAVE_ROL_DEMO, rol);
  guardar('sesion', CLAVE_ABRIR_GUIA, '1');
}
export const rolGuardado = (): string | null => leer('sesion', CLAVE_ROL_DEMO);
/** ¿Se debe abrir la guía al llegar? Una sola vez por entrada. */
export function consumirAbrirGuia(): boolean {
  const v = leer('sesion', CLAVE_ABRIR_GUIA) === '1';
  if (v) guardar('sesion', CLAVE_ABRIR_GUIA, '0');
  return v;
}

/** Las casillas de «Qué probar» de un rol; se recuerdan en este navegador. */
export function useCasillas(rol: RolDemo | null) {
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(() => (rol ? casillasDe(rol, leer('local', claveDeCasillas(rol))) : new Set()));
  useEffect(() => { setMarcadas(rol ? casillasDe(rol, leer('local', claveDeCasillas(rol))) : new Set()); }, [rol]);
  const alternar = (id: string) => {
    if (!rol) return;
    const sig = new Set(marcadas);
    if (!sig.delete(id)) sig.add(id);
    setMarcadas(sig);
    guardar('local', claveDeCasillas(rol), JSON.stringify([...sig]));
  };
  const limpiar = () => {
    if (!rol) return;
    setMarcadas(new Set());
    guardar('local', claveDeCasillas(rol), '[]');
  };
  return { marcadas, alternar, limpiar };
}
