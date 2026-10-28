import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Skeleton, soles, useToast } from '../../../ui';
import { QrImagen } from '../../admin/_parts/medios/QrMiniatura';
import type { MedioResidente } from './tipos';
import { lineasDeNotas } from '../../shared/mantenimiento/formato';
import type { Mantenimiento } from '../../shared/mantenimiento/tipos';

/** Copia un dato al portapapeles y lo avisa en voz alta («Copiado») para lectores de pantalla. */
function CopiarBoton({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiado(false), 2000);
    } catch { toast.error('No se pudo copiar. Mantén presionado el dato para copiarlo a mano.'); }
  }

  return (
    <>
      <Button variant="secondary" className="shrink-0" icon={copiado ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />} aria-label={`${copiado ? 'Copiado: ' : 'Copiar '}${etiqueta}`} onClick={() => void copiar()}>
        {copiado ? 'Copiado' : 'Copiar'}
      </Button>
      <span role="status" className="sr-only">{copiado ? `Copiado: ${etiqueta}` : ''}</span>
    </>
  );
}

function Dato({ etiqueta, valor, copiar }: { etiqueta: string; valor: string; copiar?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">{etiqueta}</p>
        <p className="num break-all text-base font-medium">{valor}</p>
      </div>
      {copiar && <CopiarBoton texto={valor.replace(/\s/g, '')} etiqueta={etiqueta.toLowerCase()} />}
    </div>
  );
}

const NOMBRE = { banco: 'Cuenta bancaria', yape: 'Yape', plin: 'Plin', recaudacion: 'Pago de servicios' } as const;

function Medio({ m }: { m: MedioResidente }) {
  const entidad = m.entidad ?? m.banco ?? 'Banco';
  const titulo = m.tipo === 'banco' ? `${entidad} · cuenta de ${m.tipo_cuenta === 'corriente' ? 'corriente' : 'ahorros'} en ${m.moneda_nombre.toLowerCase()}`
    : m.tipo === 'recaudacion' ? `${NOMBRE.recaudacion} · ${entidad}` : NOMBRE[m.tipo];
  return (
    <li className="space-y-3 p-4">
      <p className="text-sm font-semibold">{titulo}</p>
      {m.tipo === 'banco' && (
        <>
          {m.numero_cuenta && <Dato etiqueta="Número de cuenta" valor={m.numero_cuenta} copiar />}
          {m.cci && <Dato etiqueta="CCI" valor={m.cci} copiar />}
          {m.moneda === 'USD' && <p className="text-sm text-muted">Esta cuenta es en <strong>dólares</strong>: si tu recibo es en soles, consulta con la junta o la administración antes de pagar.</p>}
        </>
      )}
      {m.tipo === 'recaudacion' && (
        <>
          {m.instruccion && <p className="text-sm">{m.instruccion}</p>}
          {m.servicio && <Dato etiqueta="Servicio" valor={m.servicio} copiar />}
        </>
      )}
      {(m.tipo === 'yape' || m.tipo === 'plin') && m.celular && <Dato etiqueta={`Número de ${NOMBRE[m.tipo]}`} valor={m.celular} copiar />}
      <Dato etiqueta="A nombre de" valor={m.titular} />
      {m.tiene_qr && (
        <div className="pt-1">
          <p className="mb-2 text-xs text-muted">O escanea el código QR desde tu app</p>
          <QrImagen id={m.id} alt={`Código QR de ${NOMBRE[m.tipo]} de ${m.titular}`} className="mx-auto h-56 w-56 max-w-full" />
        </div>
      )}
    </li>
  );
}

interface Props { mant: Mantenimiento; saldo: string | null; medios: MedioResidente[] | null; loading: boolean; error: string | null; notas?: string | null; correoVouchers?: string | null }

/** Primer paso de «Pagar mantenimiento»: cuánto, a dónde y con qué referencia; luego se registra el comprobante. */
export function ComoPagar({ mant, saldo, medios, loading, error, notas, correoVouchers }: Props) {
  const lineas = lineasDeNotas(notas);
  return (
    <div className="space-y-5">
      <div className="rounded bg-surface2 p-4">
        <p className="text-sm text-muted">Monto a pagar</p>
        <div className="num text-2xl font-semibold">{saldo !== null ? soles(saldo) : <Skeleton className="mt-1 h-7 w-32" />}</div>
        <p className="mt-1 text-sm text-muted">{mant.titulo.split(' · ')[0]} · todos los conceptos del mes</p>
      </div>
      <Alert tone="info">Haz <strong>una sola transferencia o pago</strong> por el total e indica tu departamento <strong>{mant.unidad.codigo}</strong>{mant.unidad.estructura?.nombre ? ` (${mant.unidad.estructura.nombre})` : ''} en la referencia.</Alert>
      {(lineas.length > 0 || correoVouchers) && (
        <section aria-label="Notas de pago" className="rounded border border-line p-4 text-sm">
          <h3 className="mb-1.5 font-semibold">Notas de pago</h3>
          <ul className="list-disc space-y-1 pl-5">
            {correoVouchers && <li>Envía tu voucher al correo del block: <span className="break-all font-medium">{correoVouchers}</span></li>}
            {lineas.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </section>
      )}
      {loading && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
      {!loading && error && <Alert tone="warn">No pudimos cargar los datos de pago ({error}). Consúltales a la junta o a la administración; igual puedes registrar tu pago.</Alert>}
      {!loading && !error && medios !== null && medios.length === 0 && <Alert tone="warn">La junta aún no cargó los datos de pago. Consúltales o pregunta a la administración.</Alert>}
      {!loading && !error && medios !== null && medios.length > 0 && (
        <ul aria-label="Medios de pago de tu torre" className="divide-y divide-line rounded border border-line">
          {medios.map(m => <Medio key={m.id} m={m} />)}
        </ul>
      )}
    </div>
  );
}
