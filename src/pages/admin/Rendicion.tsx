import { useEffect, useState } from 'react';
import { ArrowDownTrayIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../auth/AuthContext';
import { esJunta } from '../../auth/junta';
import { useCondominio } from '../../app/condominio';
import { Alert, Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '../../ui';
import { AvisoModulo } from '../shared/_parts/AvisoModulo';
import { ZonaImprimible } from '../shared/mantenimiento/ZonaImprimible';
import { useImprimir } from './_parts/consolidado/useImprimir';
import { periodoPorDefecto } from './_parts/cierres/vista';
import { PeriodoSelect } from './_parts/cierres/PeriodoSelect';
import { HojaImprimible } from './_parts/rendicion/HojaImprimible';
import { Cuadre, Egresos, Fondos, Ingresos, Morosidad, PorBlock, Resumen } from './_parts/rendicion/Secciones';
import { urlRendicion, urlRendicionExcel, tituloRendicion } from './_parts/rendicion/vista';
import { useRendicion } from './_parts/rendicion/useRendicion';

/**
 * Rendición de cuentas del mes: el informe que la administración entrega a la junta o a la asamblea (ingresos, egresos, cuadre, fondos y morosidad), del condominio
 * completo o de un block, con descarga a Excel e impresión / PDF. La ven la administración y la junta (la de un block, sólo su block): el servidor decide el alcance.
 * Es del plan Torre Pro («Reportes y exportes»): sin él, el aviso de módulo.
 */
export default function Rendicion() {
  const { user } = useAuth();
  const { condominios } = useCondominio();
  const esAdmin = user?.rol === 'admin' || user?.rol === 'superadmin';
  // La junta de un block ve sólo su block; la Junta central (sin block) elige entre el condominio y sus blocks.
  const bloqueFijo = !esAdmin && esJunta(user) && user?.estructura_id != null;
  const [periodo, setPeriodo] = useState(periodoPorDefecto);
  const [elegido, setElegido] = useState<number | null>(null);
  const [estructuraId, setEstructuraId] = useState<number | null>(null);
  const [opciones, setOpciones] = useState<{ id: number; nombre: string }[]>([]);
  const { imprimiendo, imprimir } = useImprimir();

  const complejoId = esAdmin ? (elegido ?? condominios[0]?.id ?? null) : null;
  const params = { complejoId, estructuraId: bloqueFijo ? null : estructuraId, mes: periodo.mes, anio: periodo.anio };
  const lista = esAdmin ? complejoId !== null : true;
  const { data, loading, error, errorCode, reload } = useRendicion(lista ? urlRendicion(params) : null);

  // Otro condominio: los blocks son otros.
  useEffect(() => { setEstructuraId(null); setOpciones([]); }, [complejoId]);
  // Los blocks para elegir salen de la rendición del condominio completo (una fila por block, sin «Sin block»).
  useEffect(() => {
    if (data?.alcance === 'condominio' && data.blocks) setOpciones(data.blocks.filter(b => b.estructura.id !== null).map(b => ({ id: b.estructura.id!, nombre: b.estructura.nombre })));
  }, [data]);

  const anioActual = new Date().getFullYear();
  const descripcion = esAdmin
    ? 'El informe del mes para la junta: lo cobrado, lo pagado, el saldo, los fondos y la morosidad, del condominio o de un block.'
    : 'El informe del mes de tu junta: lo cobrado, lo pagado, el saldo, los fondos y la morosidad.';

  const acciones = (
    <>
      <Button variant="secondary" icon={<ArrowDownTrayIcon className="h-4 w-4" />} disabled={!data} onClick={() => window.location.assign(urlRendicionExcel(params))}>Descargar Excel</Button>
      <Button variant="secondary" icon={<PrinterIcon className="h-4 w-4" />} disabled={!data} onClick={imprimir}>Imprimir / PDF</Button>
    </>
  );

  // Sin el módulo `reportes` el servidor responde 403 MODULO_NO_ACTIVO: se muestra el aviso con el plan que lo trae, no un error.
  if (errorCode === 'MODULO_NO_ACTIVO') {
    return (
      <>
        <PageHeader title="Rendición del mes" description={descripcion} />
        <Card><div className="p-5"><AvisoModulo modulo="reportes" /><p className="mt-3 text-sm text-muted">La cobranza sigue igual: tus recibos, pagos y cierres están en sus pantallas. La rendición de cuentas y sus exportes a Excel e impresión son del plan Torre Pro.</p></div></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Rendición del mes" description={descripcion} actions={acciones} />
      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        {esAdmin && (
          <div className="w-full sm:w-72">
            {condominios.length > 1
              ? <Select label="Condominio" value={complejoId ?? ''} onChange={e => setElegido(Number(e.target.value))}>{condominios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select>
              : <p className="text-sm"><span className="block text-xs text-muted">Condominio</span><span className="font-medium">{condominios[0]?.nombre ?? '—'}</span></p>}
          </div>
        )}
        <PeriodoSelect mes={periodo.mes} anio={periodo.anio} anioActual={anioActual} onChange={setPeriodo} />
        {!bloqueFijo && opciones.length > 0 && (
          <div className="w-full sm:w-56">
            <Select label="Block" value={estructuraId ?? ''} onChange={e => setEstructuraId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Condominio completo</option>
              {opciones.map(b => <option key={b.id} value={b.id}>{b.nombre ?? 'Block'}</option>)}
            </Select>
          </div>
        )}
      </div>

      {esAdmin && complejoId === null && <Alert tone="info">Elige un condominio para ver su rendición.</Alert>}
      {lista && loading && !data && <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>}
      {lista && error && !data && <Card><ErrorState message={error} onRetry={() => void reload()} /></Card>}
      {lista && !error && !loading && !data && <EmptyState title="Sin datos" description="Elige un mes para ver su rendición." />}
      {data && (
        <div className={loading ? 'space-y-5 opacity-60 transition-opacity' : 'space-y-5'} aria-busy={loading}>
          <p className="text-sm font-medium" aria-live="polite">{data.complejo.nombre} · {tituloRendicion(data)}</p>
          <Resumen r={data} />
          <Ingresos r={data} />
          <Egresos r={data} />
          <Cuadre r={data} />
          <Fondos r={data} />
          <Morosidad r={data} />
          <PorBlock r={data} />
        </div>
      )}
      {imprimiendo && data && <ZonaImprimible><HojaImprimible r={data} /></ZonaImprimible>}
    </>
  );
}
