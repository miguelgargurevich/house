import { useEffect, useMemo, useState } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList, useResource } from '../../../../api';
import { Bloqueable } from '../../../../app/Bloqueable';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Select, Skeleton, useToast } from '../../../../ui';
import { finesPosibles, hoyEn, iniciosLibres, minutosAhoraEn, reglasDe, sumarDias } from '../../../shared/_parts/reservas/tipos';
import type { AreaComun, Disponibilidad, Reserva } from '../../../shared/_parts/reservas/tipos';
import { LineaDelDia } from './LineaDelDia';

interface UnidadMia { id: number; codigo: string; complejo: { id: number; nombre: string } | null }

/**
 * Elegir área y día, ver qué bloques están ocupados y reservar. Los horarios se leen en la zona del condominio (no la del celular): por eso
 * «hoy», el límite de anticipación y la hora mínima se calculan con la zona del área.
 */
export function NuevaReserva({ onCreada }: { onCreada: () => void }) {
  const toast = useToast();
  const areas = useList<AreaComun>('/api/areas-comunes', { pageSize: 100 });
  const unidades = useList<UnidadMia>('/api/me/unidades', { pageSize: 100 });
  const [areaId, setAreaId] = useState('');
  const [dia, setDia] = useState('');
  const [unidadId, setUnidadId] = useState('');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [enviando, setEnviando] = useState(false);

  const area = areas.items.find(a => String(a.id) === areaId) ?? null;
  // Con una sola área no hay nada que elegir.
  useEffect(() => { if (!areaId && areas.items.length === 1) setAreaId(String(areas.items[0]!.id)); }, [areas.items, areaId]);

  const hoy = area ? hoyEn(area.zona_horaria) : '';
  const ultimo = area ? sumarDias(hoy, area.dias_anticipacion_max) : '';
  // Al cambiar de área el día vuelve a hoy (de su zona) y se limpia la hora.
  useEffect(() => { setDia(area ? hoyEn(area.zona_horaria) : ''); setInicio(''); setFin(''); }, [areaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const disp = useResource<Disponibilidad>(area && dia ? `/api/areas-comunes/${area.id}/disponibilidad?dia=${dia}` : null);
  const ocupados = useMemo(() => disp.data?.ocupados ?? [], [disp.data]);

  const unidadesDelArea = useMemo(() => unidades.items.filter(u => u.complejo?.id === area?.complejo_id), [unidades.items, area]);
  useEffect(() => { if (unidadesDelArea.length === 1) setUnidadId(String(unidadesDelArea[0]!.id)); else if (!unidadesDelArea.some(u => String(u.id) === unidadId)) setUnidadId(''); }, [unidadesDelArea]); // eslint-disable-line react-hooks/exhaustive-deps

  const minimo = area && dia === hoy ? Math.ceil(minutosAhoraEn(area.zona_horaria) / 30) * 30 : 0;
  const inicios = useMemo(() => (area && disp.data ? iniciosLibres(area, ocupados, minimo) : []), [area, disp.data, ocupados, minimo]);
  const fines = useMemo(() => (area && inicio ? finesPosibles(area, ocupados, inicio) : []), [area, ocupados, inicio]);
  // Si lo elegido ya no es válido (cambió el día o alguien reservó), se limpia.
  useEffect(() => { if (inicio && !inicios.includes(inicio)) { setInicio(''); setFin(''); } }, [inicios]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fin && !fines.includes(fin)) setFin(''); }, [fines]); // eslint-disable-line react-hooks/exhaustive-deps

  async function reservar() {
    if (!area || !dia || !inicio || !fin || !unidadId) return;
    setEnviando(true);
    try {
      const r = await api<Reserva>('/api/reservas', { method: 'POST', json: { area_id: area.id, unidad_id: Number(unidadId), dia, hora_inicio: inicio, hora_fin: fin } });
      toast.ok(r.estado === 'pendiente' ? 'Pedido enviado: la administración debe aprobarlo' : 'Reserva confirmada');
      setInicio('');
      setFin('');
      onCreada();
    } catch (e) { toast.error(errorText(e)); } finally { setEnviando(false); void disp.reload(); }
  }

  const listo = !!area && !!dia && !!inicio && !!fin && !!unidadId;

  return (
    <Card>
      <CardHeader title="Reservar un área" description="Elige el área y el día, mira los horarios libres y reserva." />
      <CardBody className="space-y-4">
        {areas.error ? <ErrorState message={areas.error} onRetry={areas.reload} />
          : areas.loading && areas.items.length === 0 ? <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          : areas.items.length === 0 ? <EmptyState icon={<CalendarDaysIcon />} title="Aún no hay áreas para reservar" description="Cuando la administración de tu condominio habilite el salón, la parrilla u otra área común, la verás aquí." />
          : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Área" value={areaId} onChange={e => setAreaId(e.target.value)}>
                  <option value="">Elige un área</option>
                  {areas.items.map(a => <option key={a.id} value={a.id}>{areas.items.some(x => x.id !== a.id && x.complejo_id !== a.complejo_id) ? `${a.nombre} · ${a.complejo.nombre}` : a.nombre}</option>)}
                </Select>
                <Input label="Día" type="date" value={dia} min={hoy || undefined} max={ultimo || undefined} disabled={!area} onChange={e => { setDia(e.target.value); setInicio(''); setFin(''); }} />
              </div>
              {area && (
                <>
                  {area.descripcion && <p className="break-words text-sm">{area.descripcion}</p>}
                  <p className="text-xs text-muted">{reglasDe(area)}{area.capacidad ? ` · Capacidad: ${area.capacidad} personas` : ''}</p>
                  {dia && (
                    <section aria-label="Disponibilidad del día">
                      {disp.error ? <ErrorState message={disp.error} onRetry={disp.reload} />
                        : !disp.data ? <Skeleton className="h-16 w-full" />
                        : <LineaDelDia apertura={area.hora_apertura} cierre={area.hora_cierre} ocupados={ocupados} eleccion={inicio && fin ? { inicio, fin } : null} />}
                    </section>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label="Desde" value={inicio} disabled={!disp.data || inicios.length === 0} onChange={e => { setInicio(e.target.value); setFin(''); }} hint={disp.data && inicios.length === 0 ? 'No quedan horarios libres este día.' : undefined}>
                      <option value="">Elige la hora</option>
                      {inicios.map(h => <option key={h} value={h}>{h}</option>)}
                    </Select>
                    <Select label="Hasta" value={fin} disabled={!inicio} onChange={e => setFin(e.target.value)}>
                      <option value="">Elige la hora</option>
                      {fines.map(h => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </div>
                  {unidadesDelArea.length > 1 && (
                    <Select label="Para la unidad" value={unidadId} onChange={e => setUnidadId(e.target.value)}>
                      <option value="">Elige la unidad</option>
                      {unidadesDelArea.map(u => <option key={u.id} value={u.id}>{u.codigo}</option>)}
                    </Select>
                  )}
                  {unidadesDelArea.length === 1 && <p className="text-sm text-muted">Reservas para tu unidad <span className="font-medium text-ink">{unidadesDelArea[0]!.codigo}</span>.</p>}
                  {!unidades.loading && unidadesDelArea.length === 0 && <Alert tone="warn">No tienes una unidad en este condominio, así que no puedes reservar esta área.</Alert>}
                  <div className="flex justify-end">
                    <Bloqueable>{b => <Button loading={enviando} disabled={!listo || b} onClick={() => void reservar()}>{area.requiere_aprobacion ? 'Pedir reserva' : 'Reservar'}</Button>}</Bloqueable>
                  </div>
                </>
              )}
            </>
          )}
      </CardBody>
    </Card>
  );
}
