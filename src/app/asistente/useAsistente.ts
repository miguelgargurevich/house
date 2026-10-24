import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, avisarSesionPerdida, csrfHeader, errorText } from '../../api';
import { guardarAjustes, guardarBorrador, leerBorrador, leerJson, normalizarAjustes, cuerpoDeAjustes, AJUSTES_DEFECTO } from './ajustes';
import { enviarMensaje } from './cliente';
import { errorDeExcepcion } from './errores';
import type { Ajustes, ConversacionResumen, MensajeChat, OpcionesChat } from './tipos';

let contador = 0;
const idLocal = () => `m${Date.now().toString(36)}${(contador++).toString(36)}`;

interface DetalleApi {
  id: string;
  mensajes: { id: number; rol: 'user' | 'assistant'; contenido: string; estado: string; modo: string | null; proveedor?: string | null; modelo?: string | null; latencia_ms?: number | null }[];
}

export type Fase = 'libre' | 'pensando' | 'escribiendo';

/** Estado del panel: conversación, streaming, historial de conversaciones, opciones y ajustes por usuario. */
export function useAsistente(usuarioId: number, ruta: string, activo: boolean) {
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [fase, setFase] = useState<Fase>('libre');
  const [texto, setTextoEstado] = useState(() => leerBorrador(usuarioId));
  const [opciones, setOpciones] = useState<OpcionesChat | null>(null);
  const [ajustes, setAjustesEstado] = useState<Ajustes>(() => normalizarAjustes(leerJson(usuarioId), null));
  const [lista, setLista] = useState<ConversacionResumen[] | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const control = useRef<AbortController | null>(null);
  const ultimoTexto = useRef('');

  // Borrador: se conserva al cerrar y reabrir (y al recargar), por usuario.
  const setTexto = useCallback((t: string) => { setTextoEstado(t); }, []);
  useEffect(() => {
    const t = setTimeout(() => guardarBorrador(usuarioId, texto), 250);
    return () => clearTimeout(t);
  }, [usuarioId, texto]);

  const setAjustes = useCallback((a: Ajustes) => { setAjustesEstado(a); guardarAjustes(usuarioId, a); }, [usuarioId]);

  // Opciones del usuario (qué puede elegir): una vez al abrir. Las elecciones guardadas se validan contra ellas.
  useEffect(() => {
    if (!activo || opciones) return;
    let vivo = true;
    api<OpcionesChat>('/api/ai-chat/opciones')
      .then((o) => { if (vivo) { setOpciones(o); setAjustesEstado((a) => normalizarAjustes(a, o)); } })
      .catch(() => undefined); // sin opciones el compositor sigue funcionando con los valores por omisión
    return () => { vivo = false; };
  }, [activo, opciones]);

  const cargarLista = useCallback(async () => {
    setErrorLista(null);
    try { setLista(await api<ConversacionResumen[]>('/api/ai-chat/conversaciones')); }
    catch (e) { setErrorLista(errorText(e)); }
  }, []);

  const deps = useMemo(() => ({ fetch: (u: RequestInfo | URL, i?: RequestInit) => fetch(u, i), csrf: csrfHeader, sesionPerdida: avisarSesionPerdida, base: (import.meta.env.VITE_API_URL as string | undefined) ?? '' }), []);

  const ejecutar = useCallback(async (mensaje: string, conId: string | null, usuarioYa: boolean) => {
    const ac = new AbortController();
    control.current = ac;
    ultimoTexto.current = mensaje;
    const idResp = idLocal();
    setMensajes((m) => [...m, ...(usuarioYa ? [] : [{ id: idLocal(), rol: 'user' as const, texto: mensaje, estado: 'ok' as const }]), { id: idResp, rol: 'assistant', texto: '', estado: 'transmitiendo' }]);
    setFase('pensando');
    const actualizar = (cambio: (m: MensajeChat) => MensajeChat) => setMensajes((ms) => ms.map((m) => (m.id === idResp ? cambio(m) : m)));
    try {
      for await (const ev of enviarMensaje(deps, { message: mensaje, conversacion_id: conId ?? undefined, ruta, ...cuerpoDeAjustes(ajustes, opciones) }, ac.signal)) {
        if (ev.tipo === 'meta') setConversacionId(ev.conversacion_id);
        else if (ev.tipo === 'delta') { setFase('escribiendo'); actualizar((m) => ({ ...m, texto: m.texto + ev.texto })); }
        else if (ev.tipo === 'fin') actualizar((m) => ({ ...m, estado: 'ok', modelo: ev.modelo, proveedor: ev.proveedor, latencia_ms: ev.latencia_ms, modo: ev.modo }));
        else actualizar((m) => ({ ...m, estado: 'error', error: ev.error }));
      }
      // Cancelado por la persona («Detener» o «Nueva conversación»): lo que llegó se queda como respuesta.
      if (ac.signal.aborted) setMensajes((ms) => ms.flatMap((m) => (m.id !== idResp ? [m] : m.texto ? [{ ...m, estado: 'ok' as const }] : [])));
    } catch (e) {
      actualizar((m) => ({ ...m, estado: 'error', error: errorDeExcepcion(e) }));
    } finally {
      if (control.current === ac) { control.current = null; setFase('libre'); }
      void cargarLista();
    }
  }, [deps, ruta, ajustes, opciones, cargarLista]);

  const enviar = useCallback(() => {
    const t = texto.trim();
    if (!t || fase !== 'libre') return;
    setTextoEstado('');
    guardarBorrador(usuarioId, '');
    void ejecutar(t, conversacionId, false);
  }, [texto, fase, usuarioId, ejecutar, conversacionId]);

  const enviarTexto = useCallback((t: string) => { if (fase === 'libre') void ejecutar(t, conversacionId, false); }, [fase, ejecutar, conversacionId]);

  const detener = useCallback(() => { control.current?.abort(); }, []);

  const reintentar = useCallback(() => {
    if (fase !== 'libre') return;
    setMensajes((ms) => (ms.at(-1)?.estado === 'error' ? ms.slice(0, -1) : ms)); // quita la respuesta fallida; el mensaje del usuario se queda
    void ejecutar(ultimoTexto.current, conversacionId, true);
  }, [fase, ejecutar, conversacionId]);

  const nueva = useCallback(() => {
    control.current?.abort();
    control.current = null;
    setMensajes([]);
    setConversacionId(null);
    setFase('libre');
  }, []);

  const abrir = useCallback(async (id: string) => {
    control.current?.abort();
    setFase('libre');
    try {
      const d = await api<DetalleApi>(`/api/ai-chat/conversaciones/${encodeURIComponent(id)}`);
      setMensajes(d.mensajes.map((m): MensajeChat => ({
        id: `s${m.id}`, rol: m.rol, texto: m.contenido, estado: m.estado === 'error' ? 'error' : 'ok',
        ...(m.estado === 'error' ? { error: { causa: 'cortada' as const, mensaje: 'La respuesta se cortó.' } } : {}),
        modelo: m.modelo ?? null, proveedor: m.proveedor ?? null, latencia_ms: m.latencia_ms ?? null, modo: m.modo === 'contingencia' ? 'contingencia' : null,
      })).filter((m) => m.rol === 'user' || m.texto));
      setConversacionId(d.id);
      return true;
    } catch { return false; }
  }, []);

  const borrar = useCallback(async (id: string) => {
    await api(`/api/ai-chat/conversaciones/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (id === conversacionId) nueva();
    await cargarLista();
  }, [conversacionId, nueva, cargarLista]);

  // El usuario cambió (otra sesión en el mismo navegador): se parte de cero con SUS ajustes y borrador.
  useEffect(() => {
    setAjustesEstado(normalizarAjustes(leerJson(usuarioId), opciones));
    setTextoEstado(leerBorrador(usuarioId));
    nueva();
    setLista(null);
    setOpciones(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioId]);

  return { mensajes, conversacionId, fase, ocupado: fase !== 'libre', texto, setTexto, enviar, enviarTexto, detener, reintentar, nueva, abrir, borrar, lista, errorLista, cargarLista, opciones, ajustes, setAjustes, AJUSTES_DEFECTO };
}
