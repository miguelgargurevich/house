import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircleIcon, ExclamationTriangleIcon, MinusCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { api } from '../../api';
import { Alert, Badge, Button, Spinner, fechaCorta, soles } from '../../ui';
import type { Tone } from '../../ui';
import {
  AVISO_TARDA_GESTION, AVISO_TARDA_MS, AVISO_TARDA_RESIDENTE, INTERVALO_EVALUACION_MS,
  estaEvaluando, etiquetaReintento, faseDeEspera, mensajeSinResultado,
} from './esperaEvaluacion';
import type { FaseEspera } from './esperaEvaluacion';

// ---------- Lo que ve quien valida (admin y junta) ----------
export type VeredictoIA = 'coincide' | 'revisar' | 'no_coincide' | 'ilegible';
export type Comprobacion = boolean | null;

export interface EvaluacionCompleta {
  estado: 'pendiente' | 'completada' | 'error' | 'no_disponible';
  veredicto: VeredictoIA | null;
  confianza: number | null;
  resumen: string | null;
  alertas: string[] | null;
  coincidencias: { monto: Comprobacion; destino: Comprobacion; fecha: Comprobacion; estado_operacion: Comprobacion } | null;
  extraido: {
    monto: number | null; moneda: string | null; fecha: string | null; numero_operacion: string | null; medio: string | null;
    estado_operacion: string; destinatario_nombre: string | null; destino_numero: string | null;
    /** Sólo en lecturas por OCR: el «Mensaje» que escribió quien pagó. */
    mensaje?: string | null;
  } | null;
  proveedor: string | null;
  error: string | null;
}

const VEREDICTOS: Record<VeredictoIA, { tone: Tone; label: string }> = {
  coincide: { tone: 'ok', label: 'Coincide' },
  revisar: { tone: 'warn', label: 'Revisar' },
  no_coincide: { tone: 'bad', label: 'No coincide' },
  ilegible: { tone: 'neutral', label: 'Ilegible' },
};

/** Insignia del resultado de la IA; sin evaluación (pago sin comprobante) no muestra nada. */
export function VeredictoBadge({ evaluacion }: { evaluacion?: Pick<EvaluacionCompleta, 'estado' | 'veredicto'> | null }) {
  if (!evaluacion) return <span className="text-muted">—</span>;
  if (evaluacion.estado === 'pendiente') return <Badge tone="info">Evaluando…</Badge>;
  if (evaluacion.estado === 'no_disponible') return <Badge>No disponible</Badge>;
  if (evaluacion.estado === 'error') return <Badge tone="warn">Sin evaluar</Badge>;
  const v = evaluacion.veredicto ? VEREDICTOS[evaluacion.veredicto] : null;
  return v ? <Badge tone={v.tone}>{v.label}</Badge> : <span className="text-muted">—</span>;
}

const Marca = ({ ok }: { ok: Comprobacion }) =>
  ok === true ? <><CheckCircleIcon className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" /><span className="sr-only">Coincide</span></>
  : ok === false ? <><XCircleIcon className="h-4 w-4 shrink-0 text-bad" aria-hidden="true" /><span className="sr-only">No coincide</span></>
  : <><MinusCircleIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" /><span className="sr-only">Sin verificar</span></>;

const MEDIOS: Record<string, string> = { yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia', deposito: 'Depósito', otro: 'Otro' };
const ESTADOS_OP: Record<string, string> = { exitosa: 'Exitosa', pendiente: 'Pendiente', fallida: 'Fallida', desconocido: 'No se ve' };
// Las fechas «YYYY-MM-DD» se leen a mediodía local: a medianoche UTC caerían en el día anterior en Lima.
const fechaDia = (f: string | null) => (f ? fechaCorta(`${f}T12:00:00`) : null);

interface Props {
  evaluacion: EvaluacionCompleta | null;
  /** Lo que se esperaba: monto del pago y fecha de emisión del recibo (el rango válido arranca 3 días antes). */
  montoEsperado: number | string;
  validadoPorIA: boolean;
  puedeReevaluar: boolean;
  reevaluando: boolean;
  onReevaluar: () => void;
  errorReevaluar?: string | null;
  /** Cuánto lleva esperando una evaluación pendiente (`useEvaluacionCompleta`); sin ella, no se avisa de la demora. */
  fase?: FaseEspera;
}

/** Panel «Evaluación automática» del modal de validar: la IA lee el comprobante y el código lo compara con lo esperado. */
export function EvaluacionPanel({ evaluacion: ev, montoEsperado, validadoPorIA, puedeReevaluar, reevaluando, onReevaluar, errorReevaluar, fase = 'normal' }: Props) {
  const evaluando = estaEvaluando(ev?.estado, reevaluando, fase);
  const sinResultado = evaluando ? null : ev ? mensajeSinResultado(ev.estado, ev.error, fase === 'agotada') : null;
  const x = ev?.estado === 'completada' ? ev.extraido : null;
  const c = ev?.estado === 'completada' ? ev.coincidencias : null;
  const filas: { etiqueta: string; detectado: string | null; esperado?: string; ok: Comprobacion }[] = x && c ? [
    { etiqueta: 'Monto', detectado: x.monto != null ? `${x.moneda === 'USD' ? 'US$ ' : ''}${x.moneda === 'USD' ? x.monto.toFixed(2) : soles(x.monto)}` : null, esperado: soles(montoEsperado), ok: c.monto },
    { etiqueta: 'Destino', detectado: [x.destinatario_nombre, x.destino_numero ? `…${x.destino_numero}` : null].filter(Boolean).join(' · ') || null, esperado: 'Medios de pago activos', ok: c.destino },
    { etiqueta: 'Fecha', detectado: fechaDia(x.fecha), esperado: 'Dentro del rango del recibo', ok: c.fecha },
    { etiqueta: 'N.º de operación', detectado: x.numero_operacion, ok: x.numero_operacion ? true : null },
    { etiqueta: 'Estado de la operación', detectado: ESTADOS_OP[x.estado_operacion] ?? x.estado_operacion, esperado: 'Exitosa', ok: c.estado_operacion },
    ...(x.mensaje ? [{ etiqueta: 'Mensaje del voucher', detectado: x.mensaje, ok: null as Comprobacion }] : []),
  ] : [];

  return (
    <section aria-label="Evaluación automática" className="rounded border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Evaluación automática</h3>
        {evaluando ? <Badge tone="info">Evaluando…</Badge> : ev?.estado === 'pendiente' ? <Badge tone="warn">Sin respuesta</Badge> : <VeredictoBadge evaluacion={ev} />}
      </div>

      {!ev && !evaluando && <p className="mt-2 text-sm text-muted">Aún no se evaluó este comprobante.</p>}
      {evaluando && <p className="mt-2 flex items-center gap-2 text-sm text-muted" role="status"><Spinner />Leyendo el comprobante…</p>}
      {evaluando && fase === 'tarda' && <div className="mt-2"><Alert tone="warn">{AVISO_TARDA_GESTION}</Alert></div>}
      {sinResultado && <div className="mt-2"><Alert tone="warn">{sinResultado}</Alert></div>}

      {!evaluando && filas.length > 0 && (
        <>
          <ul className="mt-3 divide-y divide-line text-sm">
            {filas.map(f => (
              <li key={f.etiqueta} className="flex items-start gap-2 py-2">
                <span className="mt-0.5"><Marca ok={f.ok} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{f.etiqueta}</span>
                  <span className="block break-words text-muted">
                    Detectado: <span className="num text-ink">{f.detectado ?? 'no se pudo leer'}</span>
                    {f.esperado && <> · Esperado: <span className="num">{f.esperado}</span></>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {x?.medio && <p className="mt-2 text-xs text-muted">Medio que parece usado: {MEDIOS[x.medio] ?? x.medio}.</p>}
        </>
      )}

      {!evaluando && ev?.alertas && ev.alertas.length > 0 && (
        <ul className="mt-3 space-y-2">
          {ev.alertas.map(a => (
            <li key={a} className="flex items-start gap-2 rounded bg-warn-soft px-3 py-2 text-sm text-warn">
              <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{a}</span>
            </li>
          ))}
        </ul>
      )}

      {!evaluando && ev?.estado === 'completada' && ev.resumen && <p className="mt-3 text-sm">{ev.resumen}</p>}
      {!evaluando && ev?.estado === 'completada' && ev.proveedor === 'ocr' && <p className="mt-2 text-xs text-muted">Esta lectura la hizo el OCR propio porque la IA no respondió: es menos fiable y nunca valida sola.</p>}

      {errorReevaluar && <div className="mt-3"><Alert tone="bad">{errorReevaluar}</Alert></div>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{validadoPorIA ? 'Validado automáticamente por la IA.' : 'La IA ayuda; la decisión final es tuya.'}</p>
        {puedeReevaluar && <Button size="sm" variant="secondary" loading={evaluando} onClick={onReevaluar}>{etiquetaReintento(ev?.estado, fase)}</Button>}
      </div>
    </section>
  );
}

/**
 * Sigue la evaluación de un pago: parte de lo que ya trae la lista y, mientras esté «pendiente», consulta cada 3 s.
 * `reevaluar()` pide una evaluación nueva y espera su resultado.
 */
export function useEvaluacionCompleta(pagoId: number | null, inicial: EvaluacionCompleta | null) {
  const [ev, setEv] = useState<EvaluacionCompleta | null>(inicial);
  const [validadoPorIA, setValidadoPorIA] = useState(false);
  const [esperando, setEsperando] = useState(false);
  const [fase, setFase] = useState<FaseEspera>('normal');
  /** Se suma al pedir otra evaluación: reinicia el conteo de la espera aunque el estado siga «pendiente». */
  const [ciclo, setCiclo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => { setEv(inicial); setValidadoPorIA(false); setError(null); setEsperando(false); setFase('normal'); }, [pagoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendiente = esperando || ev?.estado === 'pendiente';
  useEffect(() => {
    if (pagoId === null || !pendiente) { setFase('normal'); return; }
    const desde = Date.now();
    setFase('normal');
    const t = setInterval(() => {
      const f = faseDeEspera(Date.now() - desde);
      setFase(f);
      if (f === 'agotada') { clearInterval(t); setEsperando(false); return; } // ~3 min: no se queda dando vueltas para siempre; el panel muestra el estado
      api<{ evaluacion: EvaluacionCompleta | null; validado_por_ia: boolean }>(`/api/pagos/${pagoId}/evaluacion`)
        .then(r => {
          if (!vivo.current) return;
          setEv(r.evaluacion);
          setValidadoPorIA(r.validado_por_ia);
          if (r.evaluacion && r.evaluacion.estado !== 'pendiente') setEsperando(false);
        })
        .catch(() => undefined);
    }, INTERVALO_EVALUACION_MS);
    return () => clearInterval(t);
  }, [pagoId, pendiente, ciclo]);

  const reevaluar = useCallback(async () => {
    if (pagoId === null) return;
    setError(null);
    setEsperando(true);
    setCiclo(c => c + 1);
    try {
      const r = await api<{ evaluacion: EvaluacionCompleta | null }>(`/api/pagos/${pagoId}/evaluacion`, { method: 'POST', json: {} });
      if (vivo.current) setEv(r.evaluacion);
    } catch (e) {
      if (vivo.current) { setEsperando(false); setError(e instanceof Error ? e.message : 'No se pudo pedir la evaluación'); }
    }
  }, [pagoId]);

  /** Sigue la evaluación que el servidor acaba de iniciar al subir el comprobante, sin pedir otra. */
  const seguir = useCallback(() => { setError(null); setEsperando(true); setCiclo(c => c + 1); }, []);

  return { ev, validadoPorIA, esperando, fase, error, reevaluar, seguir };
}

// ---------- Lo que ve el residente ----------
export type EstadoEvaluacionResidente = 'evaluando' | 'revisado' | 'necesita_revision' | 'no_disponible';
export interface EvaluacionResidente { estado: EstadoEvaluacionResidente }

const MENSAJES: Record<EstadoEvaluacionResidente, { tone: 'info' | 'ok' | 'warn'; texto: string }> = {
  evaluando: { tone: 'info', texto: 'Evaluando tu comprobante…' },
  revisado: { tone: 'ok', texto: 'Revisado automáticamente: parece correcto, queda para validación.' },
  necesita_revision: { tone: 'warn', texto: 'Necesita revisión manual: la junta lo revisará.' },
  no_disponible: { tone: 'info', texto: 'Tu comprobante quedó en revisión: la administración lo validará.' },
};

/**
 * Mensaje de la revisión automática para el residente (nunca detalla qué encontró la IA). Si «evaluando» se alarga (> 20 s) le dice que, si la IA
 * no responde, lo revisará una persona: no se queda mirando un spinner sin explicación.
 */
export function EstadoEvaluacion({ estado }: { estado: EstadoEvaluacionResidente }) {
  const [tarda, setTarda] = useState(false);
  useEffect(() => {
    setTarda(false);
    if (estado !== 'evaluando') return;
    const t = setTimeout(() => setTarda(true), AVISO_TARDA_MS);
    return () => clearTimeout(t);
  }, [estado]);
  const m = MENSAJES[estado];
  return (
    <Alert tone={m.tone}>
      {estado === 'evaluando' ? <span className="flex items-center gap-2"><Spinner />{m.texto}{tarda && <> {AVISO_TARDA_RESIDENTE}</>}</span> : m.texto}
    </Alert>
  );
}

/** Insignia de pagos validados por la IA; no muestra nada en los demás. */
export function ValidadoPorIABadge({ validado }: { validado?: boolean }) {
  return validado ? <Badge tone="brand">Validado automáticamente</Badge> : null;
}

/**
 * Tras subir la captura: consulta el estado simple cada 3 s, máximo ~3 min, y se detiene al salir de «evaluando».
 * Si pasa el tiempo sin respuesta muestra «no disponible» (quedó en revisión de una persona), nunca un spinner infinito.
 */
export function useEvaluacionResidente(pagoId: number | null) {
  const [estado, setEstado] = useState<EstadoEvaluacionResidente | null>(null);
  const [validadoPorIA, setValidadoPorIA] = useState(false);
  useEffect(() => {
    if (pagoId === null) { setEstado(null); setValidadoPorIA(false); return; }
    let vivo = true;
    const desde = Date.now();
    setEstado('evaluando');
    const consultar = () => {
      if (faseDeEspera(Date.now() - desde) === 'agotada') { clearInterval(t); if (vivo) setEstado(prev => (prev === 'evaluando' ? 'no_disponible' : prev)); return; }
      api<{ evaluacion: EvaluacionResidente | null; validado_por_ia: boolean }>(`/api/pagos/${pagoId}/evaluacion`)
        .then(r => {
          if (!vivo) return;
          setValidadoPorIA(r.validado_por_ia);
          const e = r.evaluacion?.estado ?? null;
          if (e && e !== 'evaluando') { setEstado(e); clearInterval(t); }
        })
        .catch(() => undefined);
    };
    const t = setInterval(consultar, INTERVALO_EVALUACION_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [pagoId]);
  return { estado, validadoPorIA };
}
