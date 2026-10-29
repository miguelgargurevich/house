import { Badge } from '../../../ui';
import type { Tone } from '../../../ui';

/** Un aviso de `GET /api/me/avisos/historial`. Sin cuerpo ni error crudo: el motivo ya viene en palabras del residente. */
export interface AvisoHistorial {
  id: number;
  canal: string;
  tipo: string;
  asunto: string;
  estado: string;
  fecha: string;
  motivo: string | null;
}

const ESTADO: Record<string, { tone: Tone; label: string }> = {
  enviada: { tone: 'ok', label: 'Enviado' },
  pendiente: { tone: 'info', label: 'Pendiente' },
  error: { tone: 'bad', label: 'No se entregó' },
  omitida: { tone: 'warn', label: 'Omitido' },
};
const CANAL: Record<string, string> = { email: 'Correo', whatsapp: 'WhatsApp', telegram: 'Telegram' };

const fechaCorta = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Lista de avisos. El `tipo` no se busca en ningún mapa: un tipo nuevo (p. ej. `comunicado`) se ve con su asunto. */
export function ListaMisAvisos({ avisos }: { avisos: AvisoHistorial[] }) {
  if (avisos.length === 0) return <p className="text-sm text-muted">Todavía no te enviamos avisos.</p>;
  return (
    <ul className="divide-y divide-line">
      {avisos.map(a => {
        const estado = ESTADO[a.estado] ?? { tone: 'neutral' as const, label: a.estado };
        return (
          <li key={a.id} className="grid min-w-0 gap-1 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="num">{fechaCorta.format(new Date(a.fecha))}</span>
              <span aria-hidden="true">·</span>
              <span>{CANAL[a.canal] ?? a.canal}</span>
              <Badge tone={estado.tone}>{estado.label}</Badge>
            </div>
            <p className="break-words text-sm font-medium">{a.asunto}</p>
            {a.motivo && <p className="break-words text-xs text-muted">{a.motivo}</p>}
          </li>
        );
      })}
    </ul>
  );
}
