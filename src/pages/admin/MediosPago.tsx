import { useEffect, useMemo, useState } from 'react';
import { BuildingLibraryIcon, DevicePhoneMobileIcon, PencilSquareIcon, PlusIcon, QrCodeIcon, ReceiptPercentIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, ConfirmDialog, DataTable, IconButton, PageHeader, Skeleton, Toolbar, useToast } from '../../ui';
import type { Column } from '../../ui';
import { FiltroSelect } from './_parts/catalogo/FiltroSelect';
import { Interruptor } from './_parts/catalogo/Interruptor';
import { MedioFormModal } from './_parts/medios/MedioFormModal';
import { ValidacionAutomaticaIA } from './_parts/medios/ValidacionAutomaticaIA';
import { ambitoLabel, datoPrincipal, monedaCorta, nombreTorre, tipoLabel, useAmbitos } from './_parts/medios/tipos';
import type { Medio } from './_parts/medios/tipos';

/** Medios de pago de las torres. La usan la administradora (`/admin/medios-pago`) y la junta (`/junta/medios-pago`); la API ya acota cada lista a su ámbito. */
export default function MediosPago() {
  const { user } = useAuth();
  const toast = useToast();
  const esJunta = user?.rol === 'propietario';
  const ambitos = useAmbitos();
  const [complejo, setComplejo] = useState('');
  const [torre, setTorre] = useState('');
  const [editando, setEditando] = useState<Medio | 'nuevo' | null>(null);
  const [quitar, setQuitar] = useState<Medio | null>(null);
  const [busy, setBusy] = useState(false);

  const complejos = useMemo(() => ambitos.data?.complejos ?? [], [ambitos.data]);
  // Con un solo condominio no hay nada que elegir: se usa ese.
  useEffect(() => { if (complejos.length === 1 && !complejo) setComplejo(String(complejos[0]!.id)); }, [complejos, complejo]);
  const torres = complejos.find(c => String(c.id) === complejo)?.estructuras ?? [];

  const list = useList<Medio>('/api/medios-pago', { params: { complejo_id: complejo || undefined, estructura_id: torre || undefined } });

  async function cambiarActivo(m: Medio, activo: boolean) {
    try {
      await api(`/api/medios-pago/${m.id}`, { method: 'PATCH', json: { activo } });
      toast.ok(activo ? 'Medio de pago activado' : 'Medio de pago desactivado');
    } catch (e) { toast.error(errorText(e)); }
    void list.reload();
  }

  async function eliminar() {
    if (!quitar) return;
    setBusy(true);
    try {
      await api(`/api/medios-pago/${quitar.id}`, { method: 'DELETE' });
      toast.ok('Medio de pago quitado');
      setQuitar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Medio>[] = [
    { key: 'tipo', header: 'Medio', cell: m => (
      <span className="flex items-center gap-2.5 font-medium">
        {m.tipo === 'banco' ? <BuildingLibraryIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : m.tipo === 'recaudacion' ? <ReceiptPercentIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : <DevicePhoneMobileIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
        <span>{tipoLabel(m.tipo)}<span className="block text-xs font-normal text-muted">{m.tipo === 'banco' ? `${m.entidad ?? ''} · ${monedaCorta(m.moneda)}` : m.tipo === 'recaudacion' ? [m.entidad, m.servicio].filter(Boolean).join(' · ') : m.tiene_qr ? 'Con código QR' : 'Sin código QR'}</span></span>
      </span>
    ) },
    { key: 'titular', header: 'Titular', cell: m => <span className="block max-w-[12rem]"><span className="block truncate">{m.titular}</span><span className="block truncate text-xs text-muted">{ambitoLabel(m)}</span></span> },
    { key: 'dato', header: 'Cuenta o celular', hideBelow: 'md', cell: m => <span className="num">{datoPrincipal(m)}</span> },
    { key: 'activo', header: 'Estado', cell: m => <Interruptor className="min-h-0 [&>span:last-child]:sr-only" label={m.activo ? 'Activo' : 'Inactivo'} aria-label={`Mostrar a los vecinos: ${tipoLabel(m.tipo)} de ${m.titular}`} checked={m.activo} onChange={e => void cambiarActivo(m, e.target.checked)} /> },
    { key: 'acciones', header: '', align: 'right', cell: m => (
      <div className="flex justify-end gap-1">
        <IconButton label={`Editar ${tipoLabel(m.tipo)} de ${m.titular}`} onClick={() => setEditando(m)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Quitar ${tipoLabel(m.tipo)} de ${m.titular}`} onClick={() => setQuitar(m)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    ) },
  ];

  const hayFiltros = !!torre || (complejos.length > 1 && !!complejo);
  const puedeAgregar = !!ambitos.data && complejos.length > 0;

  return (
    <>
      <PageHeader
        title="Medios de pago"
        description={esJunta ? 'Las cuentas y los Yape o Plin donde pagan los vecinos de tu torre.' : 'Las cuentas bancarias y los Yape o Plin donde pagan los vecinos de cada torre. Los define la administración o la junta directiva.'}
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} disabled={!puedeAgregar} onClick={() => setEditando('nuevo')}>Agregar medio de pago</Button>}
      />
      {!esJunta && <ValidacionAutomaticaIA />}
      {ambitos.error && <div className="mb-4"><Alert tone="bad">No se pudieron cargar los condominios y las torres: {ambitos.error}</Alert></div>}
      <Card>
        <Toolbar>
          {ambitos.loading ? <Skeleton className="h-9 w-full sm:w-48" /> : (
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              {complejos.length > 1 && (
                <FiltroSelect label="Filtrar por condominio" value={complejo} onChange={v => { setComplejo(v); setTorre(''); }}>
                  <option value="">Todos los condominios</option>
                  {complejos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </FiltroSelect>
              )}
              {!ambitos.data?.fijo && (
                <FiltroSelect label="Filtrar por torre" value={torre} onChange={setTorre}>
                  <option value="">Todas las torres</option>
                  <option value="ninguna">Todo el condominio</option>
                  {torres.map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
                </FiltroSelect>
              )}
            </div>
          )}
        </Toolbar>
        <DataTable
          caption="Medios de pago"
          columns={columns}
          rows={list.items}
          rowKey={m => m.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: hayFiltros ? 'No hay medios de pago con estos filtros' : 'Aún no hay medios de pago',
            description: hayFiltros ? 'Prueba con otro condominio o torre.' : 'Agrega la cuenta o el Yape de la junta para que los vecinos sepan cómo pagar.',
            icon: <QrCodeIcon />,
            action: puedeAgregar && !hayFiltros ? <Button onClick={() => setEditando('nuevo')}>Agregar medio de pago</Button> : undefined,
          }}
        />
      </Card>

      {ambitos.data && (
        <MedioFormModal medio={editando} ambitos={ambitos.data} inicial={{ complejo_id: complejo, estructura_id: torre }} onClose={() => setEditando(null)} onSaved={() => void list.reload()} />
      )}
      <ConfirmDialog
        open={!!quitar}
        onClose={() => setQuitar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Quitar medio de pago"
        message={quitar ? `Los vecinos dejarán de ver ${tipoLabel(quitar.tipo)} de ${quitar.titular}. Esta acción no se puede deshacer.` : ''}
        confirmLabel="Quitar"
      />
    </>
  );
}
