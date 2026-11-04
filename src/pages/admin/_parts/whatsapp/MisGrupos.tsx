import { useMemo, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../../api';
import { DESTINOS_GRUPO, ROTULO_DESTINO, type DestinoGrupo } from '../../../../server/services/canales/gruposTipos';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Select, SearchBox, Skeleton, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import { filtrarGrupos, textoDestino, textoSincronizado } from './tipos';
import type { CondominioConBlocks, GrupoGuardado, MisGrupos as Datos } from './tipos';

const nombreBlock = (e: { id: number; nombre: string | null }) => e.nombre?.trim() || `Block ${e.id}`;

interface Borrador { destino: DestinoGrupo; complejo_id: string; estructura_id: string }

/** Lo que se propone al activar un grupo: el que ya tenía o, si no, vecinos del primer block del primer condominio. */
function borradorInicial(g: GrupoGuardado, condominios: CondominioConBlocks[]): Borrador {
  const complejo = condominios.find(c => c.id === g.complejo_id) ?? condominios[0];
  return {
    destino: g.destino ?? 'block',
    complejo_id: complejo ? String(complejo.id) : '',
    estructura_id: g.estructura_id != null ? String(g.estructura_id) : complejo?.estructuras[0] ? String(complejo.estructuras[0].id) : '',
  };
}

/** Una fila de la lista: el interruptor «Usar en Torre» y, mientras se elige, a quién representa. En el celular todo va apilado. */
function FilaGrupo({ g, condominios, onGuardado }: { g: GrupoGuardado; condominios: CondominioConBlocks[]; onGuardado: (nuevo: GrupoGuardado) => void }) {
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [b, setB] = useState<Borrador>(() => borradorInicial(g, condominios));
  const [busy, setBusy] = useState(false);
  const complejo = condominios.find(c => String(c.id) === b.complejo_id);
  const necesitaBlock = b.destino !== 'condominio';
  const valido = !!complejo && (!necesitaBlock || !!b.estructura_id);

  async function enviar(cuerpo: Record<string, unknown>, mensaje: string) {
    setBusy(true);
    try {
      onGuardado(await api<GrupoGuardado>(`/api/whatsapp/grupos/${g.id}`, { method: 'PUT', json: cuerpo }));
      toast.ok(mensaje);
      setEditando(false);
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }
  const guardar = () => enviar(b.destino === 'condominio' ? { en_uso: true, destino: b.destino, complejo_id: Number(b.complejo_id) } : { en_uso: true, destino: b.destino, complejo_id: Number(b.complejo_id), estructura_id: Number(b.estructura_id) }, 'Grupo guardado');

  function alternar(activar: boolean) {
    if (!activar) {
      // Si aún no estaba guardado, apagar sólo cierra el editor: no hay nada que borrar en el servidor.
      if (g.en_uso) void enviar({ en_uso: false }, 'Ya no se usa este grupo'); else setEditando(false);
      return;
    }
    setB(borradorInicial(g, condominios));
    setEditando(true);
  }

  return (
    <li className="grid gap-3 px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium">{g.nombre}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {g.miembros != null && <span className="num">{g.miembros} {g.miembros === 1 ? 'miembro' : 'miembros'}</span>}
            {g.ya_no_esta && <Badge tone="bad">Ya no estás en este grupo</Badge>}
            {g.en_uso && !editando && <Badge tone="ok">{textoDestino(g, condominios)}</Badge>}
          </p>
          {g.aviso && <p className="mt-1 text-xs text-bad">{g.aviso}</p>}
        </div>
        <Interruptor
          label={`Usar «${g.nombre}» en Torre`}
          className="shrink-0"
          checked={g.en_uso || editando}
          disabled={busy || (g.ya_no_esta && !g.en_uso)}
          onChange={e => alternar(e.target.checked)}
        />
      </div>
      {g.en_uso && !editando && !g.ya_no_esta && (
        <div><Button size="sm" variant="secondary" onClick={() => { setB(borradorInicial(g, condominios)); setEditando(true); }}>Cambiar a quién representa</Button></div>
      )}
      {editando && (
        <div className="grid gap-3 rounded border border-line bg-surface2 p-3 sm:grid-cols-3">
          <Select label="Este grupo es de…" value={b.destino} onChange={e => setB({ ...b, destino: e.target.value as DestinoGrupo })}>
            {DESTINOS_GRUPO.map(d => <option key={d} value={d}>{ROTULO_DESTINO[d]}</option>)}
          </Select>
          <Select label="Condominio" value={b.complejo_id} onChange={e => setB({ ...b, complejo_id: e.target.value, estructura_id: String(condominios.find(c => String(c.id) === e.target.value)?.estructuras[0]?.id ?? '') })}>
            {condominios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
          {necesitaBlock && (
            <Select label="Block" value={b.estructura_id} onChange={e => setB({ ...b, estructura_id: e.target.value })} error={!b.estructura_id ? 'Este condominio aún no tiene blocks' : undefined}>
              {(complejo?.estructuras ?? []).map(e => <option key={e.id} value={e.id}>{nombreBlock(e)}</option>)}
            </Select>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button size="sm" loading={busy} disabled={!valido} onClick={() => void guardar()}>Guardar</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditando(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * «Mis grupos»: los grupos de WhatsApp del número, guardados en Torre. «Traer mis grupos» le pregunta a WhatsApp UNA vez (tarda hasta medio minuto);
 * después la lista sale de la base. Los que se marcan «Usar en Torre» y dicen a quién representan son los que aparecen al publicar un comunicado.
 */
export function MisGrupos() {
  const toast = useToast();
  const datos = useResource<Datos>('/api/whatsapp/grupos');
  const [traidos, setTraidos] = useState<Datos | null>(null);
  const [trayendo, setTrayendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [soloEnUso, setSoloEnUso] = useState(false);
  // Cambios de una fila sin volver a pedir toda la lista.
  const [cambios, setCambios] = useState<Record<number, GrupoGuardado>>({});

  const actual = traidos ?? datos.data;
  const grupos = useMemo(() => (actual?.grupos ?? []).map(g => cambios[g.id] ?? g), [actual, cambios]);
  const visibles = useMemo(() => filtrarGrupos(grupos, q, soloEnUso), [grupos, q, soloEnUso]);
  const enUso = grupos.filter(g => g.en_uso).length;

  async function traer() {
    setTrayendo(true);
    setError(null);
    try {
      const r = await api<Datos>('/api/whatsapp/grupos/sincronizar', { method: 'POST' });
      setTraidos(r);
      setCambios({});
      const { nuevos = 0, ya_no_estan = 0 } = r.resumen ?? {};
      toast.ok(`Listo: ${r.grupos.length} ${r.grupos.length === 1 ? 'grupo' : 'grupos'}${nuevos ? `, ${nuevos} ${nuevos === 1 ? 'nuevo' : 'nuevos'}` : ''}${ya_no_estan ? `, ${ya_no_estan} donde ya no estás` : ''}`);
    } catch (e) { setError(errorText(e)); } finally { setTrayendo(false); }
  }

  return (
    <Card>
      <CardHeader
        title="Mis grupos"
        description="Elige los grupos de WhatsApp donde Torre puede publicar comunicados. Al publicar, tú decides a cuáles va cada uno."
        action={<Button size="sm" icon={<ArrowPathIcon className="h-4 w-4" />} loading={trayendo} onClick={() => void traer()}>Traer mis grupos</Button>}
      />
      <CardBody className="grid gap-4">
        {trayendo && <Alert tone="info">Pidiéndole a WhatsApp tus grupos. Puede tardar hasta 30 segundos: no cierres esta pantalla.</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
        {datos.error && !actual && <Alert tone="bad">{datos.error}</Alert>}
        {!actual ? (datos.loading ? <Skeleton className="h-24 w-full" /> : null) : (
          <>
            <p className="text-xs text-muted">{textoSincronizado(actual.sincronizado_at)} · {grupos.length} {grupos.length === 1 ? 'grupo' : 'grupos'} · {enUso} en uso</p>
            {grupos.length === 0 ? (
              <EmptyState title="Aún no tienes grupos guardados" description="Toca «Traer mis grupos» para ver aquí los grupos de WhatsApp donde está tu número." />
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <SearchBox value={q} onChange={setQ} placeholder="Buscar un grupo" />
                  <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={soloEnUso} onChange={e => setSoloEnUso(e.target.checked)} />Sólo los que uso</label>
                </div>
                {visibles.length === 0 ? <p className="text-sm text-muted">Ningún grupo coincide con «{q}».</p> : (
                  <ul className="-mx-5 divide-y divide-line border-y border-line" aria-label="Mis grupos de WhatsApp">
                    {visibles.map(g => <FilaGrupo key={g.id} g={g} condominios={actual.condominios} onGuardado={nuevo => setCambios(c => ({ ...c, [nuevo.id]: nuevo }))} />)}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
