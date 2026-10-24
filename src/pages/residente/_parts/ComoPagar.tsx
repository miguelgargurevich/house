import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Skeleton, periodo, soles, useToast } from '../../../ui';
import { QrImagen } from '../../admin/_parts/medios/QrMiniatura';
import type { Cargo, MedioResidente } from './tipos';

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

const NOMBRE = { banco: 'Cuenta bancaria', yape: 'Yape', plin: 'Plin' } as const;

function Medio({ m }: { m: MedioResidente }) {
  const titulo = m.tipo === 'banco' ? `${m.banco ?? 'Banco'} · cuenta de ${m.tipo_cuenta === 'corriente' ? 'corriente' : 'ahorros'}` : NOMBRE[m.tipo];
  return (
    <li className="space-y-3 p-4">
      <p className="text-sm font-semibold">{titulo}</p>
      {m.tipo === 'banco' ? (
        <>
          {m.numero_cuenta && <Dato etiqueta="Número de cuenta" valor={m.numero_cuenta} copiar />}
          {m.cci && <Dato etiqueta="CCI" valor={m.cci} copiar />}
        </>
      ) : (
        m.celular && <Dato etiqueta={`Número de ${NOMBRE[m.tipo]}`} valor={m.celular} copiar />
      )}
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

interface Props { cargo: Cargo; medios: MedioResidente[] | null; loading: boolean; error: string | null }

/** Primer paso de «Pagar»: cuánto, a dónde y con qué referencia; luego se registra el comprobante. */
export function ComoPagar({ cargo, medios, loading, error }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded bg-surface2 p-4">
        <p className="text-sm text-muted">Monto a pagar</p>
        <p className="num text-2xl font-semibold">{soles(cargo.monto)}</p>
        <p className="mt-1 text-sm text-muted">{cargo.concepto.nombre} · {periodo(cargo.recibo.mes, cargo.recibo.anio)}</p>
      </div>
      <Alert tone="info">Indica tu unidad <strong>{cargo.unidad.codigo}</strong> en la referencia de tu pago.</Alert>
      {loading && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
      {!loading && error && <Alert tone="warn">No pudimos cargar los datos de pago ({error}). Consúltales a la junta o a la administración; igual puedes registrar tu pago.</Alert>}
      {!loading && !error && medios !== null && medios.length === 0 && <Alert tone="warn">La junta aún no cargó los datos de pago. Consúltales o pregunta a la administración.</Alert>}
      {!loading && !error && medios !== null && medios.length > 0 && (
        <ul aria-label="Medios de pago de tu block" className="divide-y divide-line rounded border border-line">
          {medios.map(m => <Medio key={m.id} m={m} />)}
        </ul>
      )}
    </div>
  );
}
