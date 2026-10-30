import { useMemo, useState } from 'react';
import { PlusIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import { useCondominio, useTorreElegida } from '../../app/condominio';
import { api, errorText, useList, useResource } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, Toolbar, useToast } from '../../ui';
import { FiltroSelect } from './_parts/catalogo/FiltroSelect';
import type { ListaJuntas } from './_parts/juntas/tipos';
import { CuentasBlock } from './_parts/medios/CuentasPorBlock';
import { agrupar } from './_parts/medios/agrupar';
import { MedioFormModal } from './_parts/medios/MedioFormModal';
import { ValidacionAutomaticaIA } from './_parts/medios/ValidacionAutomaticaIA';
import { nombreTorre, palabraEstructura, tipoLabel, useAmbitos } from './_parts/medios/tipos';
import type { Medio } from './_parts/medios/tipos';

/**
 * Medios de pago de las torres, UNA tarjeta por block: su junta vigente arriba y sus cuentas debajo (la cuenta ES la de la junta, así que no se
 * repite en otra lista). La usan la administradora (`/admin/medios-pago`) y la junta (`/junta/medios-pago`); la API ya acota cada lista a su ámbito.
 */
export default function MediosPago() {
  const { user } = useAuth();
  const toast = useToast();
  const esJunta = user?.rol === 'propietario';
  const ambitos = useAmbitos();
  const { complejo: elegido } = useCondominio();
  const [torre, setTorre] = useTorreElegida();
  const [editando, setEditando] = useState<Medio | 'nuevo' | null>(null);
  /** Block (o «Todo el condominio») del medio nuevo: el de la tarjeta donde se tocó «Agregar cuenta», o los filtros. */
  const [inicial, setInicial] = useState<{ complejo_id: string; estructura_id: string }>({ complejo_id: '', estructura_id: '' });
  const [quitar, setQuitar] = useState<Medio | null>(null);
  const [busy, setBusy] = useState(false);

  const complejos = useMemo(() => ambitos.data?.complejos ?? [], [ambitos.data]);
  // El condominio es el de la barra superior; la junta (sin selector) y quien tiene uno solo trabajan con ese.
  const complejo = elegido || (complejos.length === 1 ? String(complejos[0]!.id) : '');
  const torres = complejos.find(c => String(c.id) === complejo)?.estructuras ?? [];
  const palabra = palabraEstructura(ambitos.data);

  // Como mucho 6 activos por block: 100 alcanza para agrupar todo sin paginar (si no, se avisa).
  const list = useList<Medio>('/api/medios-pago', { pageSize: 100, params: { complejo_id: complejo || undefined, estructura_id: torre || undefined } });
  const juntas = useResource<ListaJuntas>(`/api/juntas${complejo ? `?complejo_id=${complejo}` : ''}`);
  const grupos = useMemo(() => agrupar(juntas.data?.items ?? [], list.items, torre), [juntas.data, list.items, torre]);

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

  function nuevo(donde: { complejo_id: string; estructura_id: string }) { setInicial(donde); setEditando('nuevo'); }

  const hayFiltros = !!torre || (complejos.length > 1 && !!complejo);
  const puedeAgregar = !!ambitos.data && complejos.length > 0;

  return (
    <>
      <PageHeader
        title="Medios de pago"
        description={esJunta ? `Las cuentas y los Yape o Plin donde pagan los vecinos de tu ${palabra.una}.` : `Las cuentas bancarias y los Yape o Plin donde pagan los vecinos de cada ${palabra.una}. Los define la administración o la junta directiva.`}
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} disabled={!puedeAgregar} onClick={() => nuevo({ complejo_id: complejo, estructura_id: torre })}>Agregar medio de pago</Button>}
      />
      {!esJunta && <ValidacionAutomaticaIA />}
      {ambitos.error && <div className="mb-4"><Alert tone="bad">No se pudieron cargar los condominios y las torres: {ambitos.error}</Alert></div>}
      {/* Los blocks son los del condominio elegido arriba: con «Todos los condominios» no se listan (se confundirían). */}
      {(ambitos.loading || (!ambitos.data?.fijo && complejo !== '')) && (
      <Card className="mb-4">
        <Toolbar>
          {ambitos.loading ? <Skeleton className="h-9 w-full sm:w-48" /> : (
            <FiltroSelect label={`Filtrar por ${palabra.una}`} value={torre} onChange={setTorre}>
              <option value="">{palabra.todas[0]!.toUpperCase() + palabra.todas.slice(1)}</option>
              <option value="ninguna">Junta central (todo el condominio)</option>
              {torres.map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
            </FiltroSelect>
          )}
        </Toolbar>
      </Card>
      )}
      {list.error ? (
        <Card><ErrorState message={list.error} onRetry={list.reload} /></Card>
      ) : list.loading && !list.items.length ? (
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>
      ) : grupos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<QrCodeIcon />}
            title={hayFiltros ? 'No hay medios de pago con estos filtros' : 'Aún no hay medios de pago'}
            description={hayFiltros ? `Prueba con otro condominio (arriba) o con otro ${palabra.una}.` : 'Agrega la cuenta o el Yape de la junta para que los vecinos sepan cómo pagar.'}
            action={puedeAgregar && !hayFiltros ? <Button onClick={() => nuevo({ complejo_id: complejo, estructura_id: torre })}>Agregar medio de pago</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          {list.total > list.items.length && <div className="mb-4"><Alert tone="warn">Se muestran {list.items.length} de {list.total} medios de pago: elige un condominio (arriba) o filtra por {palabra.una} para ver el resto.</Alert></div>}
          <div className="grid gap-4 lg:grid-cols-2">
            {grupos.map(g => (
              <CuentasBlock
                key={g.clave}
                grupo={g}
                mostrarCondominio={complejos.length > 1}
                enlaceJunta={esJunta ? '/junta/mi-junta' : '/admin/juntas'}
                esJunta={esJunta}
                onAgregar={() => nuevo({ complejo_id: String(g.complejo.id), estructura_id: g.estructura ? String(g.estructura.id) : 'ninguna' })}
                onEditar={setEditando}
                onQuitar={setQuitar}
                onActivo={(m, activo) => void cambiarActivo(m, activo)}
              />
            ))}
          </div>
        </>
      )}

      {ambitos.data && (
        <MedioFormModal medio={editando} ambitos={ambitos.data} inicial={inicial} onClose={() => setEditando(null)} onSaved={() => void list.reload()} />
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
