import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router-dom';
import { api, errorText } from '../../../../api';
import { esSugerido, type DestinoGrupo } from '../../../../server/services/canales/gruposTipos';
import { Button, Input, Modal, Select, Textarea, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import { nombreTorre, palabraEstructura } from '../medios/tipos';
import { textoDestino } from '../whatsapp/tipos';
import { ElegirDepartamentos } from './ElegirDepartamentos';
import { ELEGIDOS, TOPE_CUERPO, TOPE_TITULO, alcanceLabel, baseDe, textoPublicado } from './tipos';
import type { Ambitos, Comunicado } from './tipos';

interface Form {
  complejo_id: string;
  /** '' = todo el condominio; `ELEGIDOS` = «Departamentos elegidos». */
  estructura_id: string;
  /** Con «Departamentos elegidos»: el block de donde se eligen ('' = todo el condominio). La junta de un block no lo ve: es el suyo. */
  bloque_elegidos: string;
  titulo: string;
  cuerpo: string;
  enviar_correo: boolean;
  /** «Por WhatsApp a cada vecino» (1-a-1). */
  enviar_whatsapp: boolean;
  enviar_junta: boolean;
  fijado: boolean;
}

interface Props {
  /** `'nuevo'` abre el formulario vacío; un comunicado lo edita; `null` lo cierra. */
  comunicado: Comunicado | 'nuevo' | null;
  ambitos: Ambitos;
  /** Condominio/block elegidos en los filtros: valores iniciales del comunicado nuevo. */
  inicial?: { complejo_id: string; estructura_id: string };
  onClose: () => void;
  onSaved: () => void;
}

const vacio = (inicial: Props['inicial'], ambitos: Ambitos): Form => {
  const unico = ambitos.complejos.length === 1 ? ambitos.complejos[0]! : null;
  const complejo = inicial?.complejo_id || (unico ? String(unico.id) : '');
  const bloques = ambitos.complejos.find(c => String(c.id) === complejo)?.estructuras ?? [];
  const estructura = ambitos.fijo ? String(bloques[0]?.id ?? '') : /^\d+$/.test(inicial?.estructura_id ?? '') ? inicial!.estructura_id : '';
  // Los comunicados van a los grupos de WhatsApp (marcados según el alcance, abajo). A la junta, sólo si es urgente: gasta un mensaje por persona.
  return { complejo_id: complejo, estructura_id: estructura, bloque_elegidos: '', titulo: '', cuerpo: '', enviar_correo: false, enviar_whatsapp: false, enviar_junta: false, fijado: false };
};

/** Crear o editar un comunicado. El condominio, el alcance y las casillas de envío sólo se eligen al crear: editar nunca reenvía. */
export function ComunicadoModal({ comunicado, ambitos, inicial, onClose, onSaved }: Props) {
  const toast = useToast();
  const nuevo = comunicado === 'nuevo';
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<Form>();
  useEffect(() => {
    if (comunicado === null) return;
    reset(comunicado === 'nuevo'
      ? vacio(inicial, ambitos)
      : { complejo_id: String(comunicado.complejo_id), estructura_id: comunicado.estructura_id != null ? String(comunicado.estructura_id) : '', bloque_elegidos: '', titulo: comunicado.titulo, cuerpo: comunicado.cuerpo, enviar_correo: false, enviar_whatsapp: false, enviar_junta: false, fijado: comunicado.fijado });
    // Sólo al abrir: los filtros de la pantalla cambian y no deben pisar lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comunicado]);

  const complejoId = watch('complejo_id');
  const cuerpo = watch('cuerpo') ?? '';
  const complejo = ambitos.complejos.find(c => String(c.id) === complejoId);
  const bloques = complejo?.estructuras ?? [];
  const palabra = palabraEstructura(ambitos);
  const estructuraId = watch('estructura_id');
  // «Departamentos elegidos»: el aviso va sólo a los vecinos de los que marques (sin junta ni grupos). La junta de un block elige dentro de SU block.
  const elegidos = estructuraId === ELEGIDOS;
  const bloqueElegidos = watch('bloque_elegidos') ?? '';
  const estructuraEfectiva = elegidos ? (ambitos.fijo ? String(bloques[0]?.id ?? '') : bloqueElegidos) : estructuraId;
  const [unidadesSel, setUnidadesSel] = useState<number[]>([]);
  // Otro condominio o block: la lista cambia y lo marcado ya no vale.
  useEffect(() => { setUnidadesSel([]); }, [complejoId, estructuraEfectiva, comunicado]);
  // Los grupos de WhatsApp en uso de este condominio (la junta de un block sólo recibe los de su block). Vienen marcados los que representan al
  // block elegido, o a todo el condominio; las juntas y otros se marcan a mano.
  const esAdmin = baseDe(useLocation().pathname) === '/admin';
  const grupos = useMemo(() => complejo?.grupos ?? [], [complejo]);
  const sugeridos = useMemo(() => (elegidos ? [] : grupos.filter(g => esSugerido(g, estructuraId ? Number(estructuraId) : null)).map(g => g.id)), [grupos, estructuraId, elegidos]);
  const [gruposSel, setGruposSel] = useState<number[]>([]);
  const claveSugeridos = sugeridos.join(',');
  useEffect(() => {
    // Al elegir otro alcance se vuelve a marcar lo sugerido.
    if (nuevo) setGruposSel(sugeridos);
    // `claveSugeridos` es el contenido de `sugeridos`: no se vuelve a marcar cuando sólo cambia la identidad del arreglo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comunicado, nuevo, claveSugeridos, complejoId]);
  const alternarGrupo = (id: number) => setGruposSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  async function guardar(v: Form) {
    try {
      if (nuevo) {
        // Con un solo condominio no hay selector; con la junta de un block el selector de alcance va bloqueado (la API fuerza su block).
        const elegido = v.complejo_id || (ambitos.complejos.length === 1 ? String(ambitos.complejos[0]!.id) : '');
        if (elegidos && unidadesSel.length === 0) { toast.error('Marca al menos un departamento'); return; }
        const r = await api<Comunicado>('/api/comunicados', {
          method: 'POST',
          json: elegidos
            // Departamentos elegidos: sólo a sus vecinos (la API no admite junta ni grupos con ellos).
            ? { ...(elegido ? { complejo_id: Number(elegido) } : {}), estructura_id: estructuraEfectiva ? Number(estructuraEfectiva) : null, unidades: unidadesSel, titulo: v.titulo, cuerpo: v.cuerpo, enviar_correo: !!v.enviar_correo, enviar_whatsapp: !!v.enviar_whatsapp, fijado: !!v.fijado }
            : { ...(elegido ? { complejo_id: Number(elegido) } : {}), estructura_id: v.estructura_id ? Number(v.estructura_id) : null, titulo: v.titulo, cuerpo: v.cuerpo, enviar_correo: !!v.enviar_correo, enviar_whatsapp: !!v.enviar_whatsapp, enviar_junta: !!v.enviar_junta, ...(gruposSel.length ? { enviar_grupo: true, grupos: gruposSel } : {}), fijado: !!v.fijado },
        });
        toast.ok(textoPublicado(r));
      } else if (comunicado) {
        await api(`/api/comunicados/${comunicado.id}`, { method: 'PUT', json: { titulo: v.titulo, cuerpo: v.cuerpo, fijado: v.fijado } });
        toast.ok('Cambios guardados');
      }
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={comunicado !== null}
      onClose={onClose}
      size="lg"
      title={nuevo ? 'Nuevo comunicado' : 'Editar comunicado'}
      description={nuevo ? (elegidos ? 'Lo verán en su pantalla sólo los vecinos de los departamentos que marques.' : 'Lo verán en su pantalla los propietarios e inquilinos del alcance que elijas.') : 'Los cambios se ven al instante. Editar no vuelve a enviar avisos por correo ni WhatsApp.'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{nuevo ? 'Publicar' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {nuevo ? (
          <>
            {ambitos.complejos.length > 1 && (
              <Select label="Condominio" error={errors.complejo_id && 'Elige el condominio'} {...register('complejo_id', { required: true, onChange: () => setValue('estructura_id', '') })}>
                <option value="">Elige un condominio</option>
                {ambitos.complejos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Select>
            )}
            <Select
              label="Para quién"
              hint={ambitos.fijo ? `Como junta de un ${palabra.una}, publicas sólo para ese ${palabra.una}.` : undefined}
              className={ambitos.complejos.length > 1 ? '' : 'sm:col-span-2'}
              {...register('estructura_id')}
            >
              {!ambitos.fijo && <option value="">Todo el condominio</option>}
              {bloques.map(b => <option key={b.id} value={b.id}>{nombreTorre(b)}</option>)}
              <option value={ELEGIDOS}>Departamentos elegidos</option>
            </Select>
            {elegidos && !ambitos.fijo && (
              <Select label={`De qué ${palabra.una} los eliges`} className="sm:col-span-2" {...register('bloque_elegidos')}>
                <option value="">Todo el condominio</option>
                {bloques.map(b => <option key={b.id} value={b.id}>{nombreTorre(b)}</option>)}
              </Select>
            )}
            {elegidos && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-sm font-medium">Departamentos que lo reciben</p>
                <ElegirDepartamentos complejoId={complejoId} estructuraId={estructuraEfectiva} value={unidadesSel} onChange={setUnidadesSel} />
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted sm:col-span-2">
            Para: <span className="font-medium text-ink">{comunicado ? `${comunicado.complejo?.nombre ?? ''} · ${alcanceLabel(comunicado)}` : ''}</span>
          </p>
        )}
        <Input label="Título" className="sm:col-span-2" maxLength={TOPE_TITULO} error={errors.titulo && 'Escribe un título'} {...register('titulo', { required: true, validate: v => !!v.trim() })} />
        <Textarea
          label="Mensaje"
          className="sm:col-span-2"
          rows={8}
          maxLength={TOPE_CUERPO}
          hint={`Texto simple; los saltos de línea se respetan. ${cuerpo.length} / ${TOPE_CUERPO}`}
          error={errors.cuerpo && 'Escribe el mensaje'}
          {...register('cuerpo', { required: true, validate: v => !!v.trim() })}
        />
        {nuevo && (
          <fieldset className="grid gap-1 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">{elegidos ? 'Avisarles además por' : 'Además de verlo en la app'}</legend>
            {!elegidos && (
              <Interruptor
                label={estructuraId ? `A la junta del ${palabra.una}` : 'A las juntas del condominio'}
                hint="Correo y WhatsApp a cada miembro de la junta vigente, uno por persona. Úsalo si es urgente: el grupo ya lo recibe."
                {...register('enviar_junta')}
              />
            )}
            <Interruptor label="Enviar por correo a cada vecino" hint="A los propietarios e inquilinos que tengan los avisos por correo activados." {...register('enviar_correo')} />
            <Interruptor label="Por WhatsApp a cada vecino" hint="Un mensaje a cada uno, de a poco y con pausas. Gasta la cuota mensual de WhatsApp del condominio: úsalo para lo urgente." {...register('enviar_whatsapp')} />
            {elegidos && <p className="text-xs text-muted">Sólo lo ven en su pantalla, y reciben el aviso, los vecinos de los departamentos marcados que reciben comunicados. No va a la junta ni a los grupos de WhatsApp.</p>}
          </fieldset>
        )}
        {nuevo && !elegidos && (
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">A los grupos de WhatsApp</legend>
            <p className="text-xs text-muted">Los comunicados van a los grupos. Directo a la junta o a cada vecino, sólo si es urgente: gasta un mensaje por persona.</p>
            {grupos.length === 0 ? (
              <p className="text-sm text-muted">
                {estructuraId ? `Este ${palabra.una} aún no tiene` : 'Este condominio aún no tiene'} grupos de WhatsApp en uso. La administración los elige en «WhatsApp» › Mis grupos.{' '}
                {esAdmin && <Link to="/admin/whatsapp" className="font-medium text-brand underline">Ir a WhatsApp</Link>}
              </p>
            ) : (
              <>
                <ul className="grid gap-1 rounded border border-line">
                  {grupos.map(g => (
                    <li key={g.id}>
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2">
                        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand" checked={gruposSel.includes(g.id)} onChange={() => alternarGrupo(g.id)} />
                        <span className="min-w-0">
                          <span className="block break-words text-sm font-medium">{g.nombre}</span>
                          <span className="block text-xs text-muted">{textoDestino({ destino: g.destino as DestinoGrupo | null, complejo_id: complejo?.id ?? null, estructura_id: g.estructura_id }, complejo ? [{ id: complejo.id, nombre: complejo.nombre, estructuras: complejo.estructuras }] : [])}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">
                  {gruposSel.length === 0 ? 'Ninguno marcado: no se escribe a ningún grupo.' : `${gruposSel.length} ${gruposSel.length === 1 ? 'grupo marcado' : 'grupos marcados'}: un mensaje a cada uno, con el título, un extracto y el enlace a Torre.`} Cada mensaje cuenta para el tope diario del número y la cuota mensual de WhatsApp del condominio.
                </p>
              </>
            )}
          </fieldset>
        )}
        <Interruptor label="Fijar arriba" hint="Los comunicados fijados aparecen primero, antes que los más nuevos." className="sm:col-span-2" {...register('fijado')} />
      </form>
    </Modal>
  );
}
