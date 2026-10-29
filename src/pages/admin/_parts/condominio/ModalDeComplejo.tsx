import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { ZONA_POR_DEFECTO, monedaDelPais, simboloDe } from '../../../../lib/paises';
import { Button, Input, Modal, Select, TelefonoInput, Textarea, useToast } from '../../../../ui';
import { parsearTelefono } from '../../../../lib/telefono';
import { TIPOS_COMPLEJO, useOpciones } from '../catalogo/opciones';
import { SelectorPaisMoneda, type PaisMoneda } from './SelectorPaisMoneda';

export interface FilaComplejo {
  id: number;
  nombre: string;
  tipo: string;
  direccion: string | null;
  descripcion: string | null;
  empresa_id: number | null;
  /** País (ISO 3166-1) y moneda (ISO 4217) del condominio. */
  pais?: string;
  moneda?: string;
  /** Zona horaria IANA del condominio (America/Lima, Europe/Madrid…): con ella se cuentan vencimientos, mora y avisos. */
  zona_horaria?: string;
  empresa?: { id: number; nombre: string } | null;
  _count?: { unidades: number };
  unidades_count?: number;
  /** Número de torres del condominio. */
  blocks_count?: number;
  /** Mora (en la moneda del condominio) por pago fuera de fecha, en el recibo del mes siguiente; «0.00» = sin mora. */
  mora_monto?: string;
  /** Contrato de administración vigente (desde cuándo la administra su empresa). */
  contrato_vigente?: { id: number; fecha_inicio: string } | null;
  /** Recibo impreso: notas de pago (una por renglón), contacto de la administración y foto de cabecera (URL con su versión). */
  notas_pago?: string | null;
  admin_nombre?: string | null;
  admin_celular?: string | null;
  admin_correo?: string | null;
  cabecera_url?: string | null;
}

interface Form { nombre: string; tipo: string; direccion: string; descripcion: string; empresa_id: string; mora_monto: string; notas_pago: string; admin_nombre: string; admin_celular: string; admin_correo: string }

/** Alta/edición de un condominio. La administradora se elige al crear; después se cambia con «Cambiar de administradora». */
export function ModalDeComplejo({ complejo, esSuper, onClose, onGuardado }: { complejo: FilaComplejo | 'nuevo' | null; esSuper: boolean; onClose: () => void; onGuardado: () => void }) {
  const toast = useToast();
  const nuevo = complejo === 'nuevo';
  const empresas = useOpciones(esSuper && nuevo ? '/api/empresas' : null);
  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<Form>();
  // País y moneda aparte del formulario: al crear, vacío = el de la empresa / el de su país (el servidor lo completa).
  const [paisMoneda, setPaisMoneda] = useState<PaisMoneda>({ pais: '', moneda: '', zona: '' });
  useEffect(() => { if (complejo) setPaisMoneda(complejo === 'nuevo' ? { pais: '', moneda: '', zona: '' } : { pais: complejo.pais ?? 'PE', moneda: complejo.moneda ?? 'PEN', zona: complejo.zona_horaria ?? ZONA_POR_DEFECTO }); }, [complejo]);

  // El formulario se prepara al abrir el modal.
  useEffect(() => {
    if (!complejo) return;
    reset(complejo === 'nuevo'
      ? { nombre: '', tipo: 'Condominio', direccion: '', descripcion: '', empresa_id: '', mora_monto: '20.00', notas_pago: '', admin_nombre: '', admin_celular: '', admin_correo: '' }
      : { nombre: complejo.nombre, tipo: complejo.tipo, direccion: complejo.direccion ?? '', descripcion: complejo.descripcion ?? '', empresa_id: complejo.empresa_id ? String(complejo.empresa_id) : '', mora_monto: Number(complejo.mora_monto ?? 20).toFixed(2), notas_pago: complejo.notas_pago ?? '', admin_nombre: complejo.admin_nombre ?? '', admin_celular: complejo.admin_celular ?? '', admin_correo: complejo.admin_correo ?? '' });
  }, [complejo, reset]);

  async function guardar(v: Form) {
    const body: Record<string, unknown> = { nombre: v.nombre.trim(), tipo: v.tipo, direccion: v.direccion.trim() || null, descripcion: v.descripcion.trim() || null, mora_monto: v.mora_monto.trim().replace(',', '.'),
      notas_pago: v.notas_pago.trim() || null, admin_nombre: v.admin_nombre.trim() || null, admin_celular: v.admin_celular.trim() || null, admin_correo: v.admin_correo.trim() || null };
    if (paisMoneda.pais) body.pais = paisMoneda.pais;
    if (paisMoneda.moneda) body.moneda = paisMoneda.moneda;
    if (paisMoneda.zona) body.zona_horaria = paisMoneda.zona;
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
        <SelectorPaisMoneda valor={paisMoneda} onCambio={setPaisMoneda} alCrear={nuevo} />
        <Input
          label={`Mora por pago fuera de fecha (${simboloDe(paisMoneda.moneda || monedaDelPais(paisMoneda.pais))})`}
          className="sm:col-span-2"
          inputMode="decimal"
          hint="Se agrega al recibo del mes siguiente a quien no pagó a tiempo (hasta el día de vencimiento, según la fecha de su voucher). Pon 0 si no cobras mora."
          error={errors.mora_monto && 'Ingresa un monto válido, con hasta 2 decimales'}
          {...register('mora_monto', { required: true, pattern: /^\d{1,6}([.,]\d{1,2})?$/ })}
        />
        <Textarea label="Descripción" className="sm:col-span-2" {...register('descripcion')} />
        <fieldset className="grid gap-4 border-t border-line pt-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold">Recibo impreso</legend>
          <Textarea label="Notas de pago" className="sm:col-span-2" rows={4} hint="Una nota por renglón; salen al pie del recibo (p. ej. «Todo pago en ventanilla tiene un cobro adicional de 9 soles»)." {...register('notas_pago')} />
          <Input label="Administración (nombre)" className="sm:col-span-2" {...register('admin_nombre')} />
          <Controller control={control} name="admin_celular" rules={{ validate: v => !v || !!parsearTelefono(v) || 'Teléfono inválido para el país elegido' }} render={({ field }) => (
            <TelefonoInput label="Celular de la administración" error={errors.admin_celular?.message} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} name={field.name} />
          )} />
          <Input label="Correo de la administración" type="email" error={errors.admin_correo && 'Correo inválido'} {...register('admin_correo', { pattern: /^\S+@\S+\.\S+$|^$/ })} />
        </fieldset>
      </form>
    </Modal>
  );
}
