import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Button, Input, Modal, Select, Textarea, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import { nombreTorre, palabraEstructura } from '../medios/tipos';
import { TOPE_CUERPO, TOPE_TITULO, alcanceLabel, textoPublicado } from './tipos';
import type { Ambitos, Comunicado } from './tipos';

interface Form {
  complejo_id: string;
  /** '' = todo el condominio. */
  estructura_id: string;
  titulo: string;
  cuerpo: string;
  enviar_correo: boolean;
  enviar_whatsapp: boolean;
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
  return { complejo_id: complejo, estructura_id: estructura, titulo: '', cuerpo: '', enviar_correo: false, enviar_whatsapp: false, fijado: false };
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
      : { complejo_id: String(comunicado.complejo_id), estructura_id: comunicado.estructura_id != null ? String(comunicado.estructura_id) : '', titulo: comunicado.titulo, cuerpo: comunicado.cuerpo, enviar_correo: false, enviar_whatsapp: false, fijado: comunicado.fijado });
    // Sólo al abrir: los filtros de la pantalla cambian y no deben pisar lo que se está escribiendo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comunicado]);

  const complejoId = watch('complejo_id');
  const cuerpo = watch('cuerpo') ?? '';
  const complejo = ambitos.complejos.find(c => String(c.id) === complejoId);
  const bloques = complejo?.estructuras ?? [];
  const palabra = palabraEstructura(ambitos);

  async function guardar(v: Form) {
    try {
      if (nuevo) {
        // Con un solo condominio no hay selector; con la junta de un block el selector de alcance va bloqueado (la API fuerza su block).
        const elegido = v.complejo_id || (ambitos.complejos.length === 1 ? String(ambitos.complejos[0]!.id) : '');
        const r = await api<Comunicado>('/api/comunicados', {
          method: 'POST',
          json: { ...(elegido ? { complejo_id: Number(elegido) } : {}), estructura_id: v.estructura_id ? Number(v.estructura_id) : null, titulo: v.titulo, cuerpo: v.cuerpo, enviar_correo: !!v.enviar_correo, enviar_whatsapp: !!v.enviar_whatsapp, fijado: !!v.fijado },
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
      description={nuevo ? 'Lo verán en su pantalla los propietarios e inquilinos del alcance que elijas.' : 'Los cambios se ven al instante. Editar no vuelve a enviar avisos por correo ni WhatsApp.'}
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
              disabled={ambitos.fijo}
              className={ambitos.complejos.length > 1 ? '' : 'sm:col-span-2'}
              {...register('estructura_id')}
            >
              {!ambitos.fijo && <option value="">Todo el condominio</option>}
              {bloques.map(b => <option key={b.id} value={b.id}>{nombreTorre(b)}</option>)}
            </Select>
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
            <legend className="mb-1 text-sm font-medium">Además de verlo en la app</legend>
            <Interruptor label="Enviar por correo" hint="A los propietarios e inquilinos que tengan los avisos por correo activados." {...register('enviar_correo')} />
            <Interruptor label="Enviar por WhatsApp" hint="Sólo a quienes activaron WhatsApp y tienen celular, si el plan del condominio lo incluye." {...register('enviar_whatsapp')} />
          </fieldset>
        )}
        <Interruptor label="Fijar arriba" hint="Los comunicados fijados aparecen primero, antes que los más nuevos." className="sm:col-span-2" {...register('fijado')} />
      </form>
    </Modal>
  );
}
