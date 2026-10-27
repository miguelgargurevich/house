import { Badge, Card, CardBody, CardHeader, Skeleton } from '../../../../ui';
import { Link } from 'react-router-dom';
import { useResource } from '../../../../api';
import { AvisoModulo } from '../../../shared/_parts/AvisoModulo';

type Canal = 'email' | 'whatsapp';
type Estado = Record<Canal, { configurado: boolean; faltan: string[]; sinNumero?: boolean }> & { sin_modulo_whatsapp?: boolean };

const NOMBRE: Record<Canal, { titulo: string; detalle: string }> = {
  email: { titulo: 'Correo', detalle: 'Se envía por Resend.' },
  whatsapp: { titulo: 'WhatsApp', detalle: 'Se envía por la Evolution API.' },
};

/** Estado de cada canal. Sólo muestra el NOMBRE de la variable que falta, nunca su valor. */
export function Canales() {
  const { data, loading, error } = useResource<Estado>('/api/notificaciones/canales');
  return (
    <Card className="mb-6">
      <CardHeader title="Canales" description="Si un canal no está configurado, sus avisos quedan como omitidos y no se pierde nada." />
      <CardBody>
        {loading && <Skeleton className="h-12 w-full" />}
        {error && <p className="text-sm text-bad">{error}</p>}
        {data && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {(Object.keys(NOMBRE) as Canal[]).map(c => (
              <li key={c} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{NOMBRE[c].titulo}</p>
                  <p className="text-xs text-muted">
                    {data[c].configurado
                      ? NOMBRE[c].detalle
                      : data[c].sinNumero
                        ? <>Falta vincular el número de WhatsApp de tu administración. <Link to="/admin/whatsapp" className="font-medium text-brand underline">Vincularlo</Link></>
                        : <>Falta definir: <span className="font-medium text-ink">{data[c].faltan.join(', ')}</span></>}
                  </p>
                </div>
                <Badge tone={data[c].configurado ? 'ok' : 'warn'}>{data[c].configurado ? 'Configurado' : data[c].sinNumero ? 'Sin número' : 'No configurado'}</Badge>
              </li>
            ))}
          </ul>
        )}
        {data?.sin_modulo_whatsapp && <AvisoModulo modulo="whatsapp_avisos" className="mt-4" />}
      </CardBody>
    </Card>
  );
}
