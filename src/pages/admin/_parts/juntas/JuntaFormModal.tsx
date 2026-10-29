import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Alert, Button, Input, Modal, Textarea, fechaCorta, useToast } from '../../../../ui';
import { MiembrosEditor } from './MiembrosEditor';
import { cargoRepetido, filasAApi, nombreAmbito } from './tipos';
import type { FilaMiembro, Junta } from './tipos';

/** Registrar la primera junta de un block (`nueva`) o editar la vigente (`junta`) sin cerrar la gestión. */
export type EntradaJunta = { nueva: { complejo_id: number; estructura: { id: number; nombre: string | null } | null } } | { junta: Junta } | null;

interface Form { desde: string; correo: string; notas: string }

interface Props {
  entrada: EntradaJunta;
  /** El presidente y el tesorero sólo cambian el correo de su junta: no ven los miembros ni las notas. */
  soloCorreo?: boolean;
  /** «block» o «torre». */
  palabra: string;
  onClose: () => void;
  onSaved: () => void;
}

const MAX_NOTAS = 500;

export function JuntaFormModal({ entrada, soloCorreo, palabra, onClose, onSaved }: Props) {
  const toast = useToast();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>();
  const [miembros, setMiembros] = useState<FilaMiembro[]>([]);
  const junta = entrada && 'junta' in entrada ? entrada.junta : null;
  const nueva = entrada && 'nueva' in entrada ? entrada.nueva : null;
  const complejoId = junta?.complejo_id ?? nueva?.complejo_id ?? 0;
  const estructura = junta ? junta.estructura : (nueva?.estructura ?? null);

  useEffect(() => {
    if (!entrada) return;
    if ('junta' in entrada) {
      reset({ desde: entrada.junta.desde, correo: entrada.junta.correo ?? '', notas: entrada.junta.notas ?? '' });
      setMiembros(entrada.junta.miembros.map(m => ({ usuario_id: String(m.usuario_id), cargo: m.cargo })));
    } else {
      reset({ desde: '', correo: '', notas: '' });
      setMiembros([]);
    }
  }, [entrada, reset]);

  async function guardar(v: Form) {
    const api_miembros = filasAApi(miembros);
    if (!soloCorreo && cargoRepetido(api_miembros)) { toast.error(`Sólo puede haber un ${cargoRepetido(api_miembros)}`); return; }
    if (!soloCorreo && miembros.some(f => f.usuario_id === '')) { toast.error('Elige a la persona de cada fila o quita la fila vacía'); return; }
    const correo = v.correo.trim() || null;
    try {
      if (junta) {
        await api(`/api/juntas/${junta.id}`, { method: 'PUT', json: soloCorreo ? { correo } : { correo, notas: v.notas.trim() || null, miembros: api_miembros } });
        toast.ok('Cambios guardados');
      } else if (nueva) {
        await api('/api/juntas', { method: 'POST', json: { complejo_id: nueva.complejo_id, estructura_id: nueva.estructura?.id ?? null, desde: v.desde, correo, notas: v.notas.trim() || null, miembros: api_miembros } });
        toast.ok('Junta registrada');
      }
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  const idForm = 'form-junta';
  const titulo = junta ? (soloCorreo ? 'Editar el correo de la junta' : 'Editar la junta') : 'Registrar la junta';
  return (
    <Modal
      open={entrada !== null}
      onClose={onClose}
      size="lg"
      title={titulo}
      description={`${nombreAmbito(estructura)}${junta ? ` · gestión desde ${fechaCorta(junta.desde)}` : ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form={idForm} loading={isSubmitting}>{junta ? 'Guardar cambios' : 'Registrar la junta'}</Button></>}
    >
      <form id={idForm} onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {nueva && (
          <Input
            label="Inicio de la gestión" type="date" className="sm:col-span-2" hint="El día en que esta junta asumió. No puede ser una fecha futura."
            error={errors.desde && 'Indica desde cuándo es la junta'} {...register('desde', { required: true })}
          />
        )}
        <Input
          label="Correo de la junta (opcional)" type="email" autoComplete="off" className="sm:col-span-2"
          hint={`Aquí llegan los vouchers de los vecinos. Si lo dejas vacío se usa el correo anterior del ${palabra}, si lo había.`}
          error={errors.correo && 'Correo inválido'} {...register('correo', { pattern: /^\S+@\S+\.\S+$|^$/ })}
        />
        {!soloCorreo && (
          <>
            <Textarea label="Notas (opcional)" className="sm:col-span-2" maxLength={MAX_NOTAS} hint={`Hasta ${MAX_NOTAS} caracteres; por ejemplo, cómo se eligió esta junta.`} {...register('notas', { maxLength: MAX_NOTAS })} />
            <MiembrosEditor complejoId={complejoId} estructuraId={estructura?.id ?? null} palabra={palabra} value={miembros} onChange={setMiembros} juntaId={junta?.id} />
          </>
        )}
        {junta && !soloCorreo && <div className="sm:col-span-2"><Alert tone="info">Quien cambie de cargo o salga de la junta cerrará su sesión y volverá a entrar con sus permisos nuevos. Para cambiar de junta por completo usa «Nueva gestión».</Alert></div>}
      </form>
    </Modal>
  );
}
