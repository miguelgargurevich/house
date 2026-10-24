import { Card, CardHeader, EmptyState, Badge, type Tone } from '../../../../ui';
import { fechaHora } from '../fechas';
import type { CambioModelo, ConsultaReciente } from './tipos';

const CAMBIO: Record<CambioModelo['tipo'], { tone: Tone; label: string }> = {
  nuevo: { tone: 'ok', label: 'Nuevo' },
  retirado: { tone: 'bad', label: 'Retirado' },
  reactivado: { tone: 'info', label: 'Reactivado' },
};

const segundos = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

/** Qué cambió en los catálogos de modelos (descubiertos, retirados, reactivados) y qué pasó con las últimas consultas del asistente. Nunca el contenido de las conversaciones. */
export function Actividad({ cambios, consultas }: { cambios: CambioModelo[]; consultas: ConsultaReciente[] }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Cambios recientes" description="Modelos que el servidor descubrió, retiró o reactivó solo." />
        {cambios.length === 0 ? (
          <EmptyState title="Sin cambios todavía" description="Aparecerán aquí cuando un proveedor agregue o retire un modelo." />
        ) : (
          <ul className="divide-y divide-line">
            {cambios.map((c, i) => (
              <li key={`${c.fecha}-${c.modelo}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                <Badge tone={CAMBIO[c.tipo].tone}>{CAMBIO[c.tipo].label}</Badge>
                <span className="num min-w-0 break-all font-medium">{c.modelo}</span>
                <span className="text-xs text-muted">{c.proveedor} ({c.etiqueta}) · {fechaHora(c.fecha)}{c.origen === 'chat' && ' · detectado en el chat'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Consultas recientes" description="Las últimas 20 respuestas del asistente: proveedor, modelo, estado y rapidez." />
        {consultas.length === 0 ? (
          <EmptyState title="Aún no hay consultas" description="Cuando alguien use el asistente, verás aquí con qué proveedor y modelo se respondió." />
        ) : (
          <ul className="divide-y divide-line">
            {consultas.map(c => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
                {c.modo === 'contingencia' ? <Badge tone="warn">Sin IA</Badge> : c.estado === 'ok' ? <Badge tone="ok">Respondió</Badge> : <Badge tone="bad">Falló</Badge>}
                <span className="num min-w-0 break-all">{c.modo === 'contingencia' ? 'Respuesta armada con los datos de la cuenta' : `${c.proveedor ?? '—'} · ${c.modelo ?? '—'}`}</span>
                <span className="num ml-auto text-xs text-muted">{segundos(c.latencia_ms)} · {fechaHora(c.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
