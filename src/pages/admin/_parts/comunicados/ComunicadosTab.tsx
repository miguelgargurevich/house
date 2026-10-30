import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArchiveBoxIcon, MegaphoneIcon, PencilSquareIcon, PlusIcon } from '@heroicons/react/24/outline';
import { MapPinIcon } from '@heroicons/react/24/solid';
import { useCondominio, useTorreElegida } from '../../../../app/condominio';
import { api, errorText, useList } from '../../../../api';
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, IconButton, SearchBox, Skeleton, Tabs, Toolbar, fechaCorta, useToast } from '../../../../ui';
import type { Column } from '../../../../ui';
import { FiltroSelect } from '../catalogo/FiltroSelect';
import { nombreTorre, palabraEstructura } from '../medios/tipos';
import { ComunicadoModal } from './ComunicadoModal';
import { alcanceLabel, baseDe, enviosDeComunicado, textoEnvios } from './tipos';
import type { Comunicado } from './tipos';
import { useAmbitosComunicados } from './useAmbitos';

type Pestana = 'publicados' | 'archivados';

/** Los comunicados de la pestaña «Comunicados»: publicar, editar y archivar, y cuántos envíos salieron de cada uno. La API ya acota todo a su ámbito (administración o junta). */
export function ComunicadosTab() {
  const toast = useToast();
  const base = baseDe(useLocation().pathname);
  const ambitos = useAmbitosComunicados();
  const [pestana, setPestana] = useState<Pestana>('publicados');
  const { complejo: elegido } = useCondominio();
  const [torre, setTorre] = useTorreElegida();
  const [editando, setEditando] = useState<Comunicado | 'nuevo' | null>(null);
  const [archivar, setArchivar] = useState<Comunicado | null>(null);
  const [busy, setBusy] = useState(false);

  const complejos = useMemo(() => ambitos.data?.complejos ?? [], [ambitos.data]);
  // El condominio es el de la barra superior; la junta (sin selector) y quien tiene uno solo trabajan con ese.
  const complejo = elegido || (complejos.length === 1 ? String(complejos[0]!.id) : '');
  const torres = complejos.find(c => String(c.id) === complejo)?.estructuras ?? [];
  const palabra = palabraEstructura(ambitos.data);

  const list = useList<Comunicado>('/api/comunicados', { params: { archivados: pestana === 'archivados' ? 'true' : undefined, complejo_id: complejo || undefined, estructura_id: torre || undefined } });

  async function confirmarArchivar() {
    if (!archivar) return;
    setBusy(true);
    try {
      await api(`/api/comunicados/${archivar.id}/archivar`, { method: 'POST' });
      toast.ok('Comunicado archivado');
      setArchivar(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Comunicado>[] = [
    { key: 'titulo', header: 'Comunicado', cell: c => (
      <div className="min-w-0 max-w-[16rem] sm:max-w-md">
        <p className="flex items-center gap-1.5 font-medium">
          {c.fijado && <MapPinIcon className="h-4 w-4 shrink-0 text-brand" aria-label="Fijado" />}
          <span className="truncate">{c.titulo}</span>
        </p>
        <p className="truncate text-xs text-muted">{c.cuerpo.replace(/\s+/g, ' ')}</p>
        <p className="truncate text-xs text-muted sm:hidden">{alcanceLabel(c)} · {fechaCorta(c.created_at)} · {textoEnvios(c.envios)}</p>
      </div>
    ) },
    { key: 'alcance', header: 'Para', hideBelow: 'sm', cell: c => (
      <span className="block"><span className="block truncate">{alcanceLabel(c)}</span>{complejos.length > 1 && <span className="block truncate text-xs text-muted">{c.complejo?.nombre}</span>}</span>
    ) },
    { key: 'envios', header: 'Envíos', hideBelow: 'md', cell: c => (
      <span className="block">
        <span className="block">{textoEnvios(c.envios)}</span>
        {!!c.envios?.total && <Link to={enviosDeComunicado(base, c.id)} className="text-xs font-medium text-brand hover:underline">Ver envíos</Link>}
      </span>
    ) },
    { key: 'fecha', header: 'Fecha', hideBelow: 'md', cell: c => <span className="num text-muted">{fechaCorta(c.created_at)}</span> },
    { key: 'autor', header: 'Enviado por', hideBelow: 'lg', cell: c => (
      <span className="block"><span className="block truncate">{c.autor?.nombre ?? '—'}</span><Badge tone={c.origen === 'junta' ? 'info' : 'neutral'}>{c.origen === 'junta' ? 'Junta' : 'Administración'}</Badge></span>
    ) },
    { key: 'acciones', header: '', align: 'right', cell: c => (
      pestana === 'publicados' ? (
        <div className="flex justify-end gap-1">
          <IconButton label={`Editar «${c.titulo}»`} onClick={() => setEditando(c)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
          <IconButton label={`Archivar «${c.titulo}»`} onClick={() => setArchivar(c)}><ArchiveBoxIcon className="h-4 w-4" /></IconButton>
        </div>
      ) : <Badge>Archivado</Badge>
    ) },
  ];

  const hayFiltros = !!list.q || !!torre || (complejos.length > 1 && !!complejo);
  const puedePublicar = !!ambitos.data && complejos.length > 0;

  return (
    <>
      {ambitos.error && <div className="mb-4"><Alert tone="bad">No se pudieron cargar los condominios: {ambitos.error}</Alert></div>}
      <div className="mb-4 flex justify-end">
        <Button icon={<PlusIcon className="h-4 w-4" />} disabled={!puedePublicar} onClick={() => setEditando('nuevo')}>Nuevo comunicado</Button>
      </div>
      <Card>
        <Toolbar>
          <Tabs<Pestana> value={pestana} onChange={setPestana} items={[{ id: 'publicados', label: 'Publicados' }, { id: 'archivados', label: 'Archivados' }]} />
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por título o mensaje" />
          {ambitos.loading ? <Skeleton className="h-9 w-full sm:w-48" /> : (
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              {!ambitos.data?.fijo && torres.length > 0 && (
                <FiltroSelect label={`Filtrar por ${palabra.una}`} value={torre} onChange={setTorre}>
                  <option value="">{palabra.todas[0]!.toUpperCase() + palabra.todas.slice(1)}</option>
                  <option value="ninguna">Todo el condominio</option>
                  {torres.map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
                </FiltroSelect>
              )}
            </div>
          )}
        </Toolbar>
        <DataTable
          caption="Comunicados"
          columns={columns}
          rows={list.items}
          rowKey={c => c.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: hayFiltros ? 'No hay comunicados con estos filtros' : pestana === 'archivados' ? 'No hay comunicados archivados' : 'Aún no hay comunicados',
            description: hayFiltros ? 'Prueba con otra búsqueda, otro condominio (arriba) o ' + palabra.una + '.' : pestana === 'archivados' ? 'Los que archives dejan de verse para los vecinos y quedan guardados aquí.' : 'Publica el primero para avisar a tus vecinos: un corte de agua, una asamblea, un trabajo en el edificio.',
            icon: <MegaphoneIcon />,
            action: puedePublicar && !hayFiltros && pestana === 'publicados' ? <Button onClick={() => setEditando('nuevo')}>Nuevo comunicado</Button> : undefined,
          }}
        />
      </Card>

      {ambitos.data && (
        <ComunicadoModal comunicado={editando} ambitos={ambitos.data} inicial={{ complejo_id: complejo, estructura_id: torre }} onClose={() => setEditando(null)} onSaved={() => void list.reload()} />
      )}
      <ConfirmDialog
        open={!!archivar}
        onClose={() => setArchivar(null)}
        onConfirm={confirmarArchivar}
        loading={busy}
        title="Archivar comunicado"
        message={`«${archivar?.titulo ?? ''}» dejará de verse para los vecinos. Los correos o WhatsApp que ya se enviaron no se pueden retirar.`}
        confirmLabel="Archivar"
      />
    </>
  );
}
