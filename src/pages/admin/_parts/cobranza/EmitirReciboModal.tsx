import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../../api';
import { simboloDe } from '../../../../lib/paises';
import { Alert, Button, EmptyState, ErrorState, IconButton, Input, Modal, Select, Skeleton, Textarea, dinero, useToast } from '../../../../ui';
import { fechaAISO, hoyISO, nombreMes } from './comun';
import type { Complejo, Concepto, Lista } from './comun';
import { nombreTorre } from './torres';
import { useTorres } from './useTorres';

interface Form {
  complejo_id: string;
  /** '' = todas las torres (un recibo por torre). */
  estructura_id: string;
  mes: string;
  anio: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  descripcion: string;
  conceptos: { concepto_id: string; monto: string; es_recargo: boolean }[];
}

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);
const FILA_VACIA = { concepto_id: '', monto: '', es_recargo: false };

export function EmitirReciboModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const complejos = useResource<Lista<Complejo>>('/api/complejos?pageSize=100');
  const conceptos = useResource<Lista<Concepto>>('/api/conceptos?pageSize=100');
  const hoy = new Date();

  const { register, handleSubmit, control, getValues, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    defaultValues: {
      complejo_id: '',
      estructura_id: '',
      mes: String(hoy.getMonth() + 1),
      anio: String(hoy.getFullYear()),
      fecha_emision: hoyISO(),
      fecha_vencimiento: hoyISO(15),
      descripcion: '',
      conceptos: [FILA_VACIA],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'conceptos' });
  const filas = useWatch({ control, name: 'conceptos' });
  const complejoElegido = useWatch({ control, name: 'complejo_id' });
  const torreElegida = useWatch({ control, name: 'estructura_id' });
  // Cada torre tiene su propio recibo: con torres se elige una o «todas» (un recibo por torre); un condominio sin torres emite uno solo.
  const torres = useTorres(complejoElegido, Boolean(complejoElegido));
  const opcionesTorre = complejoElegido ? torres.data?.items ?? [] : [];
  // Los montos del recibo van en la moneda del condominio elegido.
  const moneda = complejos.data?.items.find(c => String(c.id) === complejoElegido)?.moneda;
  const totalPorUnidad = (filas ?? []).reduce((s, f) => s + (Number(f?.monto) || 0), 0);

  const cargando = complejos.loading || conceptos.loading;
  const error = complejos.error ?? conceptos.error;
  const opcionesConcepto = (conceptos.data?.items ?? []).filter(c => c.activo !== false);
  const sinDatos = !cargando && !error && (opcionesConcepto.length === 0 || (complejos.data?.items.length ?? 0) === 0);

  async function emitir(v: Form) {
    try {
      const r = await api<{ recibos?: unknown[] }>('/api/recibos', {
        method: 'POST',
        json: {
          complejo_id: Number(v.complejo_id),
          ...(v.estructura_id ? { estructura_id: Number(v.estructura_id) } : {}),
          mes: Number(v.mes),
          anio: Number(v.anio),
          fecha_emision: fechaAISO(v.fecha_emision),
          fecha_vencimiento: fechaAISO(v.fecha_vencimiento),
          descripcion: v.descripcion.trim() || undefined,
          conceptos: v.conceptos.map(c => ({ concepto_id: Number(c.concepto_id), monto: Number(c.monto), es_recargo: c.es_recargo })),
        },
      });
      const n = r.recibos?.length ?? 1;
      toast.ok(n > 1 ? `Se emitieron ${n} recibos, uno por torre` : 'Recibo emitido');
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  const listo = !cargando && !error && !sinDatos;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Emitir recibo"
      description="Define el periodo y los conceptos; cada unidad activa recibirá su cargo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={isSubmitting} disabled={!listo} onClick={handleSubmit(emitir)}>Emitir recibo</Button>
        </>
      }
    >
      {cargando ? (
        <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => { void complejos.reload(); void conceptos.reload(); }} />
      ) : sinDatos ? (
        <EmptyState
          title={(complejos.data?.items.length ?? 0) === 0 ? 'Aún no tienes condominios' : 'Aún no tienes conceptos de cobro'}
          description={(complejos.data?.items.length ?? 0) === 0
            ? 'Registra un condominio para poder emitirle recibos.'
            : 'Crea al menos un concepto (mantenimiento, agua, etc.) para armar el recibo.'}
          action={<Link to={(complejos.data?.items.length ?? 0) === 0 ? '/admin/complejos' : '/admin/conceptos'} className="text-sm font-medium text-brand hover:underline">
            {(complejos.data?.items.length ?? 0) === 0 ? 'Ir a Condominios' : 'Ir a Conceptos'}
          </Link>}
        />
      ) : (
        <form onSubmit={handleSubmit(emitir)} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Select label="Condominio" className="sm:col-span-2" error={errors.complejo_id && 'Elige un condominio'} {...register('complejo_id', { required: true, onChange: () => setValue('estructura_id', '') })}>
            <option value="">Elige un condominio</option>
            {(complejos.data?.items ?? []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
          {opcionesTorre.length > 0 && (
            <Select label="Torre" className="sm:col-span-2" {...register('estructura_id')}>
              <option value="">Todas las torres (un recibo por torre)</option>
              {opcionesTorre.map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
            </Select>
          )}
          <Select label="Mes" {...register('mes', { required: true })}>
            {MESES.map(m => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </Select>
          <Input label="Año" type="number" inputMode="numeric" min={2020} max={2100} error={errors.anio && 'Ingresa un año entre 2020 y 2100'}
            {...register('anio', { required: true, validate: v => (Number(v) >= 2020 && Number(v) <= 2100) })} />
          <Input label="Fecha de emisión" type="date" error={errors.fecha_emision && 'Ingresa la fecha de emisión'} {...register('fecha_emision', { required: true })} />
          <Input label="Fecha de vencimiento" type="date" error={errors.fecha_vencimiento && (errors.fecha_vencimiento.type === 'validate' ? 'Debe ser igual o posterior a la emisión' : 'Ingresa la fecha de vencimiento')}
            {...register('fecha_vencimiento', { required: true, validate: v => v >= getValues('fecha_emision') })} />
          <Textarea label="Descripción (opcional)" className="sm:col-span-2" placeholder="Ej. Cuota ordinaria de mayo" {...register('descripcion')} />

          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Conceptos del recibo</legend>
            <div className="mt-2 divide-y divide-line">
              {fields.map((f, i) => {
                const ocultaEtiqueta = i > 0 ? 'sm:[&_label]:sr-only' : '';
                const ce = errors.conceptos?.[i];
                return (
                  <div key={f.id} className={`grid gap-3 py-3 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-start ${ocultaEtiqueta}`}>
                    <Select label="Concepto" error={ce?.concepto_id && 'Elige un concepto'} {...register(`conceptos.${i}.concepto_id`, { required: true })}>
                      <option value="">Elige un concepto</option>
                      {opcionesConcepto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </Select>
                    <Input label={`Monto (${simboloDe(moneda)})`} type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" error={ce?.monto && 'Monto mayor a 0'}
                      {...register(`conceptos.${i}.monto`, { required: true, validate: v => Number(v) > 0 })} />
                    <label className={`flex h-10 items-center gap-2 text-sm ${i === 0 ? 'sm:mt-[1.625rem]' : ''}`}>
                      <input type="checkbox" className="h-4 w-4 accent-brand" {...register(`conceptos.${i}.es_recargo`)} />
                      Es recargo
                    </label>
                    <IconButton
                      label={`Quitar concepto ${i + 1}`}
                      disabled={fields.length === 1}
                      onClick={() => remove(i)}
                      className={`h-10 w-10 ${i === 0 ? 'sm:mt-[1.625rem]' : ''}`}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </IconButton>
                  </div>
                );
              })}
            </div>
            <Button variant="secondary" size="sm" className="mt-1" icon={<PlusIcon className="h-4 w-4" />} onClick={() => append(FILA_VACIA)}>Agregar concepto</Button>
          </fieldset>

          <div className="space-y-3 sm:col-span-2">
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-sm text-muted">Total por unidad</span>
              <span className="num text-xl font-semibold">{dinero(totalPorUnidad, moneda)}</span>
            </div>
            <Alert>{opcionesTorre.length === 0
              ? 'Se generará un cargo por cada unidad activa del condominio.'
              : torreElegida
                ? `Se emitirá el recibo de ${nombreTorre(opcionesTorre.find(t => String(t.id) === torreElegida) ?? { id: 0, nombre: 'la torre' })}: un cargo por cada unidad activa de esa torre.`
                : `Se emitirá un recibo por cada torre (${opcionesTorre.length}), cada uno con un cargo por cada unidad activa de su torre.`}</Alert>
          </div>
        </form>
      )}
    </Modal>
  );
}
