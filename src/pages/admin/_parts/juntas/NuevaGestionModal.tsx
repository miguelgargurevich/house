import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Alert, Button, Input, Modal, Textarea, fechaCorta, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import { MiembrosEditor } from './MiembrosEditor';
import { cargoRepetido, diaSiguiente, filasAApi, nombreAmbito } from './tipos';
import type { FilaMiembro, Junta } from './tipos';

interface Form { desde: string; correo: string; notas: string; misma_cuenta: boolean }

interface Props {
  /** La junta vigente que termina. `null` cierra el diálogo. */
  junta: Junta | null;
  /** «block» o «torre». */
  palabra: string;
  onClose: () => void;
  onSaved: () => void;
}

const MAX_NOTAS = 500;

/** Cierra la gestión vigente y abre otra: la que termina queda en el historial y los cargos pasan solos a los miembros nuevos. */
export function NuevaGestionModal({ junta, palabra, onClose, onSaved }: Props) {
  const toast = useToast();
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Form>();
  const [miembros, setMiembros] = useState<FilaMiembro[]>([]);
  const activas = junta?.medios.filter(m => m.activo) ?? [];

  useEffect(() => {
    if (!junta) return;
    reset({ desde: '', correo: junta.correo ?? '', notas: '', misma_cuenta: activas.length > 0 });
    setMiembros([]);
    // Sólo al abrir: lo que se escribe no debe pisarse al recargar la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [junta?.id]);

  const desde = watch('desde');
  const misma = watch('misma_cuenta');

  async function guardar(v: Form) {
    if (!junta) return;
    const lista = filasAApi(miembros);
    if (miembros.some(f => f.usuario_id === '')) { toast.error('Elige a la persona de cada fila o quita la fila vacía'); return; }
    if (cargoRepetido(lista)) { toast.error(`Sólo puede haber un ${cargoRepetido(lista)}`); return; }
    try {
      await api(`/api/juntas/${junta.id}/nueva-gestion`, {
        method: 'POST',
        json: { desde: v.desde, correo: v.correo.trim() || null, notas: v.notas.trim() || null, miembros: lista, misma_cuenta: activas.length > 0 && v.misma_cuenta },
      });
      toast.ok('Nueva gestión registrada');
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  const idForm = 'form-nueva-gestion';
  return (
    <Modal
      open={junta !== null}
      onClose={onClose}
      size="lg"
      title="Nueva gestión"
      description={junta ? `Junta de ${nombreAmbito(junta.estructura)}: la gestión desde ${fechaCorta(junta.desde)} pasa al historial.` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form={idForm} loading={isSubmitting}>Registrar la nueva gestión</Button></>}
    >
      {junta && (
        <form id={idForm} onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Input
            label="Inicio de la nueva gestión" type="date" className="sm:col-span-2" min={diaSiguiente(junta.desde)}
            hint={desde ? `La gestión actual terminará el día anterior.` : 'El día en que asume la nueva junta; después del inicio de la actual y no futuro.'}
            error={errors.desde && 'Indica desde cuándo es la nueva junta'} {...register('desde', { required: true })}
          />
          <Input
            label="Correo de la nueva junta (opcional)" type="email" autoComplete="off" className="sm:col-span-2"
            hint="Aquí llegarán los vouchers de los vecinos. Viene con el de la junta actual: cámbialo si es otro."
            error={errors.correo && 'Correo inválido'} {...register('correo', { pattern: /^\S+@\S+\.\S+$|^$/ })}
          />
          <Textarea label="Notas (opcional)" className="sm:col-span-2" maxLength={MAX_NOTAS} {...register('notas', { maxLength: MAX_NOTAS })} />
          <MiembrosEditor complejoId={junta.complejo_id} estructuraId={junta.estructura_id} palabra={palabra} value={miembros} onChange={setMiembros} juntaId={junta.id} />
          {activas.length > 0 ? (
            <div className="sm:col-span-2">
              <Interruptor
                label="La cuenta sigue siendo la misma"
                hint={misma ? 'La cuenta se copia a la nueva junta; la de la gestión anterior queda en el historial.' : 'Los vecinos dejarán de ver la cuenta actual. La nueva junta la agrega después, en su ficha.'}
                {...register('misma_cuenta')}
              />
            </div>
          ) : (
            <p className="text-sm text-muted sm:col-span-2">La junta actual no tiene cuenta: la nueva la agrega después, en su ficha.</p>
          )}
          <div className="sm:col-span-2"><Alert tone="warn">Los cargos pasan solos a los miembros nuevos: quien ya no esté en la junta pierde sus permisos y cierra su sesión. Los medios de pago de la gestión anterior dejan de verse para los vecinos.</Alert></div>
        </form>
      )}
    </Modal>
  );
}
