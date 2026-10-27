import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Button, Input, Modal, Select, Textarea, useToast } from '../../../../ui';
import { TIPOS_COMPLEJO, useOpciones } from '../catalogo/opciones';

export interface FilaComplejo {
  id: number;
  nombre: string;
  tipo: string;
  direccion: string | null;
  descripcion: string | null;
  empresa_id: number | null;
  empresa?: { id: number; nombre: string } | null;
  _count?: { unidades: number };
  unidades_count?: number;
  /** Número de torres del condominio. */
  blocks_count?: number;
  /** Mora (S/) por pago fuera de fecha, en el recibo del mes siguiente; «0.00» = sin mora. */
  mora_monto?: string;
  /** Contrato de administración vigente (desde cuándo la administra su empresa). */
  contrato_vigente?: { id: number; fecha_inicio: string } | null;
}

interface Form { nombre: string; tipo: string; direccion: string; descripcion: string; empresa_id: string; mora_monto: string }

/** Alta/edición de un condominio. La administradora se elige al crear; después se cambia con «Cambiar de administradora». */
export function ModalDeComplejo({ complejo, esSuper, onClose, onGuardado }: { complejo: FilaComplejo | 'nuevo' | null; esSuper: boolean; onClose: () => void; onGuardado: () => void }) {
  const toast = useToast();
  const nuevo = complejo === 'nuevo';
  const empresas = useOpciones(esSuper && nuevo ? '/api/empresas' : null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Form>();

  // El formulario se prepara al abrir el modal.
  useEffect(() => {
    if (!complejo) return;
    reset(complejo === 'nuevo'
      ? { nombre: '', tipo: 'Condominio', direccion: '', descripcion: '', empresa_id: '', mora_monto: '20.00' }
      : { nombre: complejo.nombre, tipo: complejo.tipo, direccion: complejo.direccion ?? '', descripcion: complejo.descripcion ?? '', empresa_id: complejo.empresa_id ? String(complejo.empresa_id) : '', mora_monto: Number(complejo.mora_monto ?? 20).toFixed(2) });
  }, [complejo, reset]);

  async function guardar(v: Form) {
    const body: Record<string, unknown> = { nombre: v.nombre.trim(), tipo: v.tipo, direccion: v.direccion.trim() || null, descripcion: v.descripcion.trim() || null, mora_monto: v.mora_monto.trim().replace(',', '.') };
    // La administradora se elige al crear; después se cambia con «Cambiar de administradora» (cierra un contrato y abre otro).
    if (esSuper && nuevo) body.empresa_id = Number(v.empresa_id);
    try {
      await api(nuevo ? '/api/complejos' : `/api/complejos/${(complejo as FilaComplejo).id}`, { method: nuevo ? 'POST' : 'PUT', json: body });
      toast.ok(nuevo ? 'Condominio creado' : 'Cambios guardados');
      onGuardado();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open={complejo !== null}
      onClose={onClose}
      title={nuevo ? 'Nuevo condominio' : 'Editar condominio'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={isSubmitting} onClick={handleSubmit(guardar)}>{nuevo ? 'Crear condominio' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Input label="Nombre" className="sm:col-span-2" error={errors.nombre && 'Ingresa el nombre'} {...register('nombre', { required: true, validate: v => !!v.trim() })} />
        <Select label="Tipo" error={errors.tipo && 'Elige el tipo'} {...register('tipo', { required: true })}>
          {TIPOS_COMPLEJO.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
        {esSuper && nuevo && (
          <Select label="Empresa administradora" error={errors.empresa_id && 'Elige la empresa'} hint={empresas.error ?? undefined} {...register('empresa_id', { required: true })}>
            <option value="">{empresas.loading ? 'Cargando…' : 'Selecciona una empresa'}</option>
            {empresas.opciones.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </Select>
        )}
        <Input label="Dirección" className="sm:col-span-2" placeholder="Av. Arequipa 1234, Lince" {...register('direccion')} />
        <Input
          label="Mora por pago fuera de fecha (S/)"
          className="sm:col-span-2"
          inputMode="decimal"
          hint="Se agrega al recibo del mes siguiente a quien no pagó a tiempo (hasta el día de vencimiento, según la fecha de su voucher). Pon 0 si no cobras mora."
          error={errors.mora_monto && 'Ingresa un monto válido, con hasta 2 decimales'}
          {...register('mora_monto', { required: true, pattern: /^\d{1,6}([.,]\d{1,2})?$/ })}
        />
        <Textarea label="Descripción" className="sm:col-span-2" {...register('descripcion')} />
      </form>
    </Modal>
  );
}
