import { useMemo, useState } from 'react';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import { useCondominio, useTorreElegida } from '../../app/condominio';
import { useResource } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, EmptyState, PageHeader, Skeleton, Toolbar } from '../../ui';
import { FiltroSelect } from './_parts/catalogo/FiltroSelect';
import { HistorialModal } from './_parts/juntas/HistorialModal';
import { JuntaCard } from './_parts/juntas/JuntaCard';
import { JuntaFormModal } from './_parts/juntas/JuntaFormModal';
import type { EntradaJunta } from './_parts/juntas/JuntaFormModal';
import { NuevaGestionModal } from './_parts/juntas/NuevaGestionModal';
import { palabraDe } from './_parts/juntas/tipos';
import type { FichaJunta, Junta, ListaJuntas } from './_parts/juntas/tipos';
import { MedioFormModal } from './_parts/medios/MedioFormModal';
import { useAmbitos } from './_parts/medios/tipos';
import type { Medio } from './_parts/medios/tipos';

/**
 * Juntas directivas por block: la gestión vigente (miembros, correo y cuenta), la nueva gestión y el historial. La usan la administración
 * (`/admin/juntas`) y el presidente o tesorero de la junta (`/junta/mi-junta`, «Mi junta»); la API acota cada lista a su ámbito.
 */
export default function Juntas() {
  const { user } = useAuth();
  const esJunta = user?.rol === 'propietario';
  const { complejo } = useCondominio(); // el condominio es el de la barra superior (la junta no tiene selector: la API la acota a su block)
  const lista = useResource<ListaJuntas>(`/api/juntas${complejo ? `?complejo_id=${complejo}` : ''}`);
  const ambitos = useAmbitos();
  const [registrando, setRegistrando] = useState<EntradaJunta>(null);
  const [nueva, setNueva] = useState<Junta | null>(null);
  const [historial, setHistorial] = useState<FichaJunta | null>(null);
  const [cuenta, setCuenta] = useState<{ junta: Junta; medio: Medio | 'nuevo' } | null>(null);

  const complejos = useMemo(() => lista.data?.complejos ?? [], [lista.data]);
  const puedeGestionar = lista.data?.puede_gestionar ?? false;
  const items = lista.data?.items ?? [];
  const palabra = palabraDe(items);
  const complejoElegido = complejos.find(c => String(c.id) === complejo) ?? (complejos.length === 1 ? complejos[0]! : null);
  const hayJuntaDelCondominio = items.some(i => i.estructura === null && i.complejo.id === complejoElegido?.id);
  // Junta única (el condominio sólo tiene la junta de todo el condominio): la pantalla no muestra blocks «Sin junta» a su junta.
  const unica = complejoElegido?.junta_unica === true;
  const [torre, setTorre] = useTorreElegida();
  // Filtro por block (sólo la administración, con un condominio elegido y más de un block): la junta de todo el condominio sale con «Junta del condominio».
  const blocksDeJuntas = [...new Map(items.filter(i => i.estructura && i.complejo.id === complejoElegido?.id).map(i => [i.estructura!.id, i.estructura!])).values()];
  const conFiltro = !esJunta && !!complejoElegido && blocksDeJuntas.length > 1;
  const base = esJunta && unica ? items.filter(i => i.estructura === null) : items;
  const visibles = conFiltro && torre ? base.filter(i => (torre === 'condominio' ? i.estructura === null : String(i.estructura?.id ?? '') === torre)) : base;
  // Sin junta de block, la junta de todo el condominio se llama «Junta directiva» (la junta) o «Junta directiva del condominio» (la administración), no «Junta central».
  const sinBlocksConJunta = (complejoId: number) => !items.some(i => i.estructura !== null && i.vigente !== null && i.complejo.id === complejoId);
  const tituloCentralDe = (complejoId: number) => (sinBlocksConJunta(complejoId) ? (esJunta ? 'Junta directiva' : 'Junta directiva del condominio') : undefined);
  const tituloRegistro = registrando ? tituloCentralDe('nueva' in registrando ? registrando.nueva.complejo_id : registrando.junta.complejo_id) : undefined;
  const recargar = () => void lista.reload();

  return (
    <>
      <PageHeader
        title={esJunta ? 'Mi junta' : 'Juntas directivas'}
        description={unica
          ? (esJunta
            ? 'Los miembros de la junta directiva de tu edificio, su correo y la cuenta donde pagan los vecinos. Puedes editar el correo y la cuenta; los miembros y las gestiones nuevas las registra la administración.'
            : 'La junta directiva del condominio con sus miembros, su correo y la cuenta donde pagan los vecinos. Cuando cambia la junta, registra una nueva gestión: los permisos pasan solos y la anterior queda en el historial.')
          : esJunta
            ? 'Los miembros de tu junta, su correo y la cuenta donde pagan los vecinos. Puedes editar el correo y la cuenta; los miembros y las gestiones nuevas las registra la administración.'
            : `La junta de cada ${palabra} con sus miembros, su correo y la cuenta donde pagan los vecinos. Cuando cambia la junta, registra una nueva gestión: los permisos pasan solos y la anterior queda en el historial.`}
        actions={puedeGestionar && complejoElegido && !hayJuntaDelCondominio && !lista.loading
          ? <Button variant="secondary" icon={<UserGroupIcon className="h-4 w-4" />} onClick={() => setRegistrando({ nueva: { complejo_id: complejoElegido.id, estructura: null } })}>{sinBlocksConJunta(complejoElegido.id) ? 'Junta directiva del condominio' : 'Junta central'}</Button>
          : undefined}
      />
      {lista.error && <div className="mb-4"><Alert tone="bad">No se pudieron cargar las juntas: {lista.error}</Alert></div>}
      {conFiltro && (
        <Card className="mb-4">
          <Toolbar>
            <FiltroSelect label={`Filtrar por ${palabra}`} value={torre} onChange={setTorre} className="sm:w-56">
              <option value="">Todos los {palabra}s</option>
              {hayJuntaDelCondominio && <option value="condominio">Junta del condominio</option>}
              {blocksDeJuntas.map(b => <option key={b.id} value={b.id}>{b.nombre ?? `${palabra} ${b.id}`}</option>)}
            </FiltroSelect>
          </Toolbar>
        </Card>
      )}
      {lista.loading && !lista.data ? (
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
      ) : visibles.length === 0 && !lista.error ? (
        <EmptyState icon={<UserGroupIcon />} title={`No hay ${palabra}s para mostrar`} description={`Cuando el condominio tenga ${palabra}s, aquí verás la junta de cada uno.`} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibles.map(f => (
            <JuntaCard
              key={`${f.complejo.id}:${f.estructura?.id ?? 'condominio'}`}
              ficha={f}
              puedeGestionar={puedeGestionar}
              mostrarCondominio={complejos.length > 1}
              palabra={palabra}
              tituloCentral={tituloCentralDe(f.complejo.id)}
              onRegistrar={() => setRegistrando({ nueva: { complejo_id: f.complejo.id, estructura: f.estructura } })}
              onEditar={j => setRegistrando({ junta: j })}
              onNuevaGestion={setNueva}
              onHistorial={() => setHistorial(f)}
              onCuenta={(junta, medio) => setCuenta({ junta, medio })}
            />
          ))}
        </div>
      )}

      <JuntaFormModal entrada={registrando} soloCorreo={!puedeGestionar} palabra={palabra} tituloCentral={tituloRegistro} onClose={() => setRegistrando(null)} onSaved={recargar} />
      <NuevaGestionModal junta={nueva} palabra={palabra} tituloCentral={nueva ? tituloCentralDe(nueva.complejo_id) : undefined} onClose={() => setNueva(null)} onSaved={(j, cuentaNueva) => { recargar(); if (cuentaNueva) setCuenta({ junta: j, medio: 'nuevo' }); }} />
      <HistorialModal ambito={historial ? { complejo_id: historial.complejo.id, estructura: historial.estructura } : null} onClose={() => setHistorial(null)} />
      {ambitos.data && (
        <MedioFormModal
          medio={cuenta?.medio ?? null}
          ambitos={ambitos.data}
          junta={cuenta ? { complejo_id: cuenta.junta.complejo_id, estructura: cuenta.junta.estructura, desde: cuenta.junta.desde } : undefined}
          onClose={() => setCuenta(null)}
          onSaved={recargar}
        />
      )}
    </>
  );
}
