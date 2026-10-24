import { useState } from 'react';
import { ComputerDesktopIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, useToast } from '../../ui';

interface Sesion { id: string; ip: string | null; user_agent: string | null; creada: string; ultimo_uso: string; actual: boolean }

const fechaHora = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** «Chrome en macOS» a partir del user-agent; si no se reconoce, «Navegador desconocido». */
function dispositivo(ua: string | null): string {
  if (!ua) return 'Navegador desconocido';
  const navegador = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const sistema = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  if (navegador && sistema) return `${navegador} en ${sistema}`;
  return navegador ?? sistema ?? 'Navegador desconocido';
}

export default function SesionesActivas() {
  const { data, loading, error, reload } = useResource<Sesion[]>('/api/auth/sesiones');
  const toast = useToast();
  const [cerrando, setCerrando] = useState<string | null>(null); // id de la sesión, o 'otras'

  async function cerrar(id: string) {
    setCerrando(id);
    try {
      await api(`/api/auth/sesiones/${id}`, { method: 'DELETE' });
      toast.ok('Sesión cerrada');
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setCerrando(null); }
  }

  async function cerrarOtras() {
    setCerrando('otras');
    try {
      const r = await api<{ cerradas: number }>('/api/auth/sesiones/cerrar-otras', { method: 'POST', json: {} });
      toast.ok(r.cerradas === 1 ? 'Se cerró 1 sesión' : `Se cerraron ${r.cerradas} sesiones`);
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setCerrando(null); }
  }

  const otras = (data ?? []).filter(s => !s.actual).length;

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Sesiones activas"
        description="Los dispositivos donde tienes la sesión abierta. Cierra los que no reconozcas."
        action={otras > 0 && <Button variant="secondary" size="sm" loading={cerrando === 'otras'} onClick={cerrarOtras}>Cerrar las demás</Button>}
      />
      <CardBody>
        {loading && !data ? (
          <div className="grid gap-3"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.length ? (
          <EmptyState icon={<ComputerDesktopIcon />} title="No hay sesiones activas" description="Vuelve a iniciar sesión para ver aquí tus dispositivos." />
        ) : (
          <ul className="divide-y divide-line">
            {data.map(s => (
              <li key={s.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{dispositivo(s.user_agent)}</span>
                    {s.actual && <Badge tone="ok">Esta sesión</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    <span className="num">{s.ip ?? 'IP desconocida'}</span> · Último uso: {fechaHora.format(new Date(s.ultimo_uso))} · Inicio: {fechaHora.format(new Date(s.creada))}
                  </p>
                </div>
                {!s.actual && <Button variant="ghost" size="sm" loading={cerrando === s.id} onClick={() => cerrar(s.id)} aria-label={`Cerrar la sesión de ${dispositivo(s.user_agent)}`}>Cerrar</Button>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
