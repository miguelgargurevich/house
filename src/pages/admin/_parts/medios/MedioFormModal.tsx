import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Alert, Button, Input, Modal, Select, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import { ACCEPT_QR, errorDeQr, subirQr } from './qr';
import { QrImagen } from './QrMiniatura';
import { BANCOS, TIPOS, nombreBlock } from './tipos';
import type { Ambitos, Medio, TipoMedio } from './tipos';

interface Form {
  tipo: TipoMedio;
  complejo_id: string;
  /** '' = todo el condominio. */
  estructura_id: string;
  banco: string;
  tipo_cuenta: string;
  numero_cuenta: string;
  cci: string;
  documento_titular: string;
  celular: string;
  titular: string;
  activo: boolean;
}

interface Props {
  /** `'nuevo'` abre el formulario vacío; un medio lo edita; `null` lo cierra. */
  medio: Medio | 'nuevo' | null;
  ambitos: Ambitos;
  /** Condominio/block elegidos en los filtros: valores iniciales del medio nuevo. */
  inicial?: { complejo_id: string; estructura_id: string };
  onClose: () => void;
  onSaved: () => void;
}

const vacio = (inicial: Props['inicial'], ambitos: Ambitos): Form => {
  const unico = ambitos.complejos.length === 1 ? ambitos.complejos[0]! : null;
  const complejo = inicial?.complejo_id || (unico ? String(unico.id) : '');
  const bloques = ambitos.complejos.find(c => String(c.id) === complejo)?.estructuras ?? [];
  const estructura = ambitos.fijo ? String(bloques[0]?.id ?? '') : /^\d+$/.test(inicial?.estructura_id ?? '') ? inicial!.estructura_id : '';
  return { tipo: 'banco', complejo_id: complejo, estructura_id: estructura, banco: 'BCP', tipo_cuenta: 'ahorros', numero_cuenta: '', cci: '', documento_titular: '', celular: '', titular: '', activo: true };
};

export function MedioFormModal({ medio, ambitos, inicial, onClose, onSaved }: Props) {
  const toast = useToast();
  const nuevo = medio === 'nuevo';
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Form>();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();
  const [quitarQr, setQuitarQr] = useState(false);

  useEffect(() => {
    if (medio === null) return;
    reset(medio === 'nuevo'
      ? vacio(inicial, ambitos)
      : {
          tipo: medio.tipo, complejo_id: String(medio.complejo_id), estructura_id: medio.estructura_id ? String(medio.estructura_id) : '',
          banco: medio.banco ?? 'BCP', tipo_cuenta: medio.tipo_cuenta ?? 'ahorros', numero_cuenta: medio.numero_cuenta ?? '', cci: medio.cci ?? '',
          documento_titular: medio.documento_titular ?? '', celular: medio.celular ?? '', titular: medio.titular, activo: medio.activo,
        });
    setArchivo(null); setErrorArchivo(undefined); setQuitarQr(false);
  }, [medio, ambitos, inicial, reset]);

  // Vista previa del archivo elegido; se libera al cambiar o cerrar.
  useEffect(() => {
    if (!archivo) { setVista(null); return; }
    const url = URL.createObjectURL(archivo);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  const tipo = watch('tipo');
  const complejoId = watch('complejo_id');
  const bloques = useMemo(() => ambitos.complejos.find(c => String(c.id) === complejoId)?.estructuras ?? [], [ambitos, complejoId]);
  const unCondominio = ambitos.complejos.length === 1;

  function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const err = f ? errorDeQr(f) : null;
    if (err) e.target.value = '';
    setErrorArchivo(err ?? undefined);
    setArchivo(f && !err ? f : null);
    if (f && !err) setQuitarQr(false);
  }

  async function guardar(v: Form) {
    const datos = v.tipo === 'banco'
      ? { banco: v.banco, tipo_cuenta: v.tipo_cuenta, numero_cuenta: v.numero_cuenta.trim(), cci: v.cci.trim() || null, documento_titular: v.documento_titular.trim() || null }
      : { celular: v.celular.trim() };
    const cuerpo = { tipo: v.tipo, titular: v.titular.trim(), activo: v.activo, ...datos };
    try {
      const guardado = await api<{ id: number }>(nuevo ? '/api/medios-pago' : `/api/medios-pago/${(medio as Medio).id}`, {
        method: nuevo ? 'POST' : 'PUT',
        json: nuevo ? { ...cuerpo, complejo_id: Number(v.complejo_id), estructura_id: v.estructura_id ? Number(v.estructura_id) : null } : cuerpo,
      });
      // El medio ya está guardado: si el QR falla no se repite el guardado, se avisa y se puede reintentar al editar.
      let qrOk = true;
      try {
        if (archivo) await subirQr(guardado.id, archivo);
        else if (quitarQr) await api(`/api/medios-pago/${guardado.id}/qr`, { method: 'DELETE' });
      } catch (e) { qrOk = false; toast.error(`El medio de pago se guardó, pero el QR no: ${errorText(e)}`); }
      if (qrOk) toast.ok(nuevo ? 'Medio de pago agregado' : 'Cambios guardados');
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  const tieneQr = !nuevo && medio !== null && medio.tiene_qr && !quitarQr;
  const idForm = 'form-medio-pago';

  return (
    <Modal
      open={medio !== null}
      onClose={onClose}
      title={nuevo ? 'Agregar medio de pago' : 'Editar medio de pago'}
      description="Los vecinos verán estos datos al pagar sus recibos."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form={idForm} loading={isSubmitting}>{nuevo ? 'Agregar medio de pago' : 'Guardar cambios'}</Button></>}
    >
      <form id={idForm} onSubmit={handleSubmit(guardar)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {nuevo && !unCondominio && (
          <Select label="Condominio" className="sm:col-span-2" error={errors.complejo_id && 'Elige el condominio'} {...register('complejo_id', { required: true })}>
            <option value="">Elige un condominio</option>
            {ambitos.complejos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        )}
        {nuevo && (ambitos.fijo
          ? <p className="text-sm text-muted sm:col-span-2">Block: <span className="font-medium text-ink">{bloques[0] ? nombreBlock(bloques[0]) : '—'}</span></p>
          : (
            <Select label="¿Para quién es?" className="sm:col-span-2" hint="Un medio de todo el condominio lo ven todos los blocks." {...register('estructura_id')}>
              <option value="">Todo el condominio</option>
              {bloques.map(b => <option key={b.id} value={b.id}>{nombreBlock(b)}</option>)}
            </Select>
          ))}
        {!nuevo && medio !== null && <p className="text-sm text-muted sm:col-span-2">Para: <span className="font-medium text-ink">{medio.estructura ? nombreBlock(medio.estructura) : 'Todo el condominio'}</span></p>}

        <Select label="Tipo de medio" className="sm:col-span-2" {...register('tipo', { required: true })}>
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>

        {tipo === 'banco' ? (
          <>
            <Select label="Banco" {...register('banco', { required: true })}>{BANCOS.map(b => <option key={b} value={b}>{b}</option>)}</Select>
            <Select label="Tipo de cuenta" {...register('tipo_cuenta', { required: true })}>
              <option value="ahorros">Ahorros</option>
              <option value="corriente">Corriente</option>
            </Select>
            <Input
              label="Número de cuenta" inputMode="numeric" autoComplete="off" className="sm:col-span-2"
              hint="De 8 a 20 dígitos; puedes separarlos con guiones."
              error={errors.numero_cuenta && 'Usa de 8 a 20 dígitos (guiones permitidos)'}
              {...register('numero_cuenta', { required: true, validate: v => /^[\d-]{8,20}$/.test(v.replace(/\s/g, '')) && v.replace(/\D/g, '').length >= 8 })}
            />
            <Input
              label="CCI (opcional)" inputMode="numeric" autoComplete="off" className="sm:col-span-2"
              hint="Código interbancario de 20 dígitos, para transferencias desde otros bancos."
              error={errors.cci && 'El CCI tiene 20 dígitos'}
              {...register('cci', { validate: v => v.trim() === '' || /^\d{20}$/.test(v.replace(/\s/g, '')) })}
            />
          </>
        ) : (
          <Input
            label={`Celular de ${tipo === 'yape' ? 'Yape' : 'Plin'}`} inputMode="tel" autoComplete="off" className="sm:col-span-2"
            hint="9 dígitos, empieza con 9."
            error={errors.celular && 'Usa un celular peruano de 9 dígitos que empiece con 9'}
            {...register('celular', { required: true, validate: v => /^9\d{8}$/.test(v.replace(/\s/g, '')) })}
          />
        )}

        <Input label="Titular" className={tipo === 'banco' ? undefined : 'sm:col-span-2'} autoComplete="off" error={errors.titular && 'Ingresa el nombre del titular'} {...register('titular', { required: true, validate: v => v.trim().length > 0 })} />
        {tipo === 'banco' && (
          <Input
            label="DNI o RUC del titular (opcional)" inputMode="numeric" autoComplete="off"
            error={errors.documento_titular && 'Usa un DNI de 8 o un RUC de 11 dígitos'}
            {...register('documento_titular', { validate: v => v.trim() === '' || /^(\d{8}|\d{11})$/.test(v.trim()) })}
          />
        )}

        <div className="sm:col-span-2">
          <Input
            label="Código QR (opcional)" type="file" accept={ACCEPT_QR}
            hint="Imagen PNG, JPG o WebP de hasta 500 KB. Los vecinos podrán escanearla para pagar."
            error={errorArchivo} onChange={elegirArchivo}
            className="[&_input]:h-auto [&_input]:py-2"
          />
          {(vista || tieneQr) && medio !== null && (
            <div className="mt-3 flex items-center gap-4">
              {vista
                ? <img src={vista} alt="Vista previa del código QR que subirás" className="h-28 w-28 rounded border border-line bg-white object-contain" />
                : <QrImagen id={(medio as Medio).id} version={(medio as Medio).updated_at} alt={`Código QR actual de ${(medio as Medio).titular}`} className="h-28 w-28" />}
              {!vista && <Button variant="secondary" size="sm" onClick={() => setQuitarQr(true)}>Quitar QR</Button>}
            </div>
          )}
          {quitarQr && <div className="mt-3"><Alert tone="warn">El QR se quitará al guardar los cambios.</Alert></div>}
        </div>

        <Interruptor className="sm:col-span-2" label="Activo" hint="Los medios inactivos no se muestran a los vecinos. Máximo 6 activos por block." {...register('activo')} />
      </form>
    </Modal>
  );
}
