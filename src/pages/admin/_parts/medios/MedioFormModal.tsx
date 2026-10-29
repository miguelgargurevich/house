import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { api, errorText } from '../../../../api';
import { Alert, Button, Input, Modal, Select, TelefonoInput, useToast } from '../../../../ui';
import { parsearCelular } from '../../../../lib/telefono';
import { Interruptor } from '../catalogo/Interruptor';
import { ACCEPT_QR, errorDeQr, subirQr } from './qr';
import { QrImagen } from './QrMiniatura';
import { avisoCci, avisoLargoCuenta } from './avisos';
import { nombreAmbito, textoCuentaJunta } from '../juntas/tipos';
import { CODIGOS_PAGO, ENTIDAD_OTRA, MONEDAS, TIPOS, nombreTorre, palabraEstructura, useCatalogo } from './tipos';
import type { Ambitos, Medio, TipoMedio } from './tipos';

interface Form {
  tipo: TipoMedio;
  complejo_id: string;
  /** '' = todo el condominio. */
  estructura_id: string;
  /** La entidad (también en una cuenta recaudadora). */
  banco: string;
  banco_otro: string;
  tipo_cuenta: string;
  numero_cuenta: string;
  cci: string;
  moneda: string;
  servicio: string;
  codigo_pago: string;
  codigo_instruccion: string;
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
  /** Dentro de una junta: el medio nuevo es de ESA junta (su block y su gestión), sin elegir a quién va. */
  junta?: { complejo_id: number; estructura: { id: number; nombre: string | null } | null; desde: string };
  onClose: () => void;
  onSaved: () => void;
}

const vacio = (inicial: Props['inicial'], ambitos: Ambitos): Form => {
  const unico = ambitos.complejos.length === 1 ? ambitos.complejos[0]! : null;
  const complejo = inicial?.complejo_id || (unico ? String(unico.id) : '');
  const bloques = ambitos.complejos.find(c => String(c.id) === complejo)?.estructuras ?? [];
  const estructura = ambitos.fijo ? String(bloques[0]?.id ?? '') : /^\d+$/.test(inicial?.estructura_id ?? '') ? inicial!.estructura_id : '';
  return { tipo: 'banco', complejo_id: complejo, estructura_id: estructura, banco: 'BCP', banco_otro: '', tipo_cuenta: 'ahorros', numero_cuenta: '', cci: '', moneda: 'PEN', servicio: '', codigo_pago: 'departamento', codigo_instruccion: '', documento_titular: '', celular: '', titular: '', activo: true };
};

export function MedioFormModal({ medio, ambitos, inicial, junta, onClose, onSaved }: Props) {
  const toast = useToast();
  const nuevo = medio === 'nuevo';
  const { register, handleSubmit, reset, watch, control, formState: { errors, isSubmitting } } = useForm<Form>();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | undefined>();
  const [quitarQr, setQuitarQr] = useState(false);

  useEffect(() => {
    if (medio === null) return;
    reset(medio === 'nuevo'
      ? vacio(junta ? { complejo_id: String(junta.complejo_id), estructura_id: junta.estructura ? String(junta.estructura.id) : '' } : inicial, ambitos)
      : {
          tipo: medio.tipo, complejo_id: String(medio.complejo_id), estructura_id: medio.estructura_id ? String(medio.estructura_id) : '',
          banco: medio.banco ?? 'BCP', banco_otro: medio.banco_otro ?? '', tipo_cuenta: medio.tipo_cuenta ?? 'ahorros', numero_cuenta: medio.numero_cuenta ?? '', cci: medio.cci ?? '',
          moneda: medio.moneda ?? 'PEN', servicio: medio.servicio ?? '', codigo_pago: medio.codigo_pago ?? 'departamento', codigo_instruccion: medio.codigo_instruccion ?? '',
          documento_titular: medio.documento_titular ?? '', celular: medio.celular ?? '', titular: medio.titular, activo: medio.activo,
        });
    setArchivo(null); setErrorArchivo(undefined); setQuitarQr(false);
  }, [medio, ambitos, inicial, junta, reset]);

  // Vista previa del archivo elegido; se libera al cambiar o cerrar.
  useEffect(() => {
    if (!archivo) { setVista(null); return; }
    const url = URL.createObjectURL(archivo);
    setVista(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  const tipo = watch('tipo');
  const complejoId = watch('complejo_id');
  const banco = watch('banco');
  const codigoPago = watch('codigo_pago');
  const catalogo = useCatalogo().data;
  const entidades = useMemo(() => catalogo?.grupos.flatMap(g => g.entidades) ?? [], [catalogo]);
  const reglas = entidades.find(x => x.nombre === banco);
  // Avisos, nunca errores: el servidor sólo exige 6 a 25 caracteres y un CCI de 20 dígitos.
  const avisoLargo = tipo === 'banco' ? avisoLargoCuenta(reglas, watch('tipo_cuenta'), watch('numero_cuenta') ?? '') : null;
  const avisoCodigo = tipo === 'banco' ? avisoCci(reglas, watch('cci') ?? '', entidades) : null;
  const bloques = useMemo(() => ambitos.complejos.find(c => String(c.id) === complejoId)?.estructuras ?? [], [ambitos, complejoId]);
  const unCondominio = ambitos.complejos.length === 1;
  const palabra = palabraEstructura(ambitos);

  function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    const err = f ? errorDeQr(f) : null;
    if (err) e.target.value = '';
    setErrorArchivo(err ?? undefined);
    setArchivo(f && !err ? f : null);
    if (f && !err) setQuitarQr(false);
  }

  async function guardar(v: Form) {
    const otra = v.banco === ENTIDAD_OTRA ? v.banco_otro.trim() : null;
    const datos = v.tipo === 'banco'
      ? { banco: v.banco, banco_otro: otra, tipo_cuenta: v.tipo_cuenta, numero_cuenta: v.numero_cuenta.trim(), moneda: v.moneda, cci: v.cci.replace(/[\s-]/g, '') || null, documento_titular: v.documento_titular.trim() || null }
      : v.tipo === 'recaudacion'
        ? { banco: v.banco, banco_otro: otra, servicio: v.servicio.trim(), codigo_pago: v.codigo_pago, codigo_instruccion: v.codigo_pago === 'otro' ? v.codigo_instruccion.trim() : null }
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
        if (archivo && v.tipo !== 'recaudacion') await subirQr(guardado.id, archivo);
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
        {nuevo && !unCondominio && !junta && (
          <Select label="Condominio" className="sm:col-span-2" error={errors.complejo_id && 'Elige el condominio'} {...register('complejo_id', { required: true })}>
            <option value="">Elige un condominio</option>
            {ambitos.complejos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        )}
        {nuevo && junta && <p className="text-sm text-muted sm:col-span-2">{textoCuentaJunta({ desde: junta.desde })} · <span className="font-medium text-ink">{nombreAmbito(junta.estructura)}</span></p>}
        {nuevo && !junta && (ambitos.fijo
          ? <p className="text-sm text-muted sm:col-span-2"><span className="capitalize">{palabra.una}</span>: <span className="font-medium text-ink">{bloques[0] ? nombreTorre(bloques[0]) : '—'}</span></p>
          : (
            <Select label="¿Para quién es?" className="sm:col-span-2" hint={`Un medio de todo el condominio lo ven ${palabra.todas}.`} {...register('estructura_id')}>
              <option value="">Todo el condominio</option>
              {bloques.map(t => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
            </Select>
          ))}
        {!nuevo && medio !== null && <p className="text-sm text-muted sm:col-span-2">{medio.junta ? <>{textoCuentaJunta(medio.junta)} · </> : 'Para: '}<span className="font-medium text-ink">{medio.estructura ? nombreTorre(medio.estructura) : 'Todo el condominio'}</span></p>}

        <Select label="Tipo de medio" className="sm:col-span-2" {...register('tipo', { required: true })}>
          {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>

        {(tipo === 'banco' || tipo === 'recaudacion') && (
          <>
            <Select label={tipo === 'recaudacion' ? 'Entidad donde paga el vecino' : 'Entidad'} className={banco === ENTIDAD_OTRA ? undefined : 'sm:col-span-2'} {...register('banco', { required: true })}>
              {catalogo
                ? catalogo.grupos.map(g => (
                    <optgroup key={g.grupo} label={g.etiqueta}>
                      {g.entidades.map(x => <option key={x.nombre} value={x.nombre}>{x.nombre === ENTIDAD_OTRA ? 'Otra entidad (escribe el nombre)' : x.nombre}</option>)}
                    </optgroup>
                  ))
                : <option value={banco}>{banco === ENTIDAD_OTRA ? 'Otra entidad' : banco}</option>}
            </Select>
            {banco === ENTIDAD_OTRA && (
              <Input
                label="Nombre de la entidad" autoComplete="off" maxLength={60}
                error={errors.banco_otro && 'Escribe el nombre de la entidad (hasta 60 caracteres)'}
                {...register('banco_otro', { validate: v => v.trim().length > 0 && v.trim().length <= 60 })}
              />
            )}
          </>
        )}

        {tipo === 'banco' && (
          <>
            <Select label="Tipo de cuenta" {...register('tipo_cuenta', { required: true })}>
              <option value="ahorros">Ahorros</option>
              <option value="corriente">Corriente</option>
            </Select>
            <Select label="Moneda" hint="Sólo informa al vecino: House no convierte nada." {...register('moneda', { required: true })}>
              {MONEDAS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Input
              label="Número de cuenta" inputMode="numeric" autoComplete="off" className="sm:col-span-2"
              hint="De 6 a 25 caracteres: dígitos y guiones."
              error={errors.numero_cuenta && 'Usa de 6 a 25 caracteres (dígitos y guiones, al menos 6 dígitos)'}
              {...register('numero_cuenta', { required: true, validate: v => /^[\d-]{6,25}$/.test(v.replace(/\s/g, '')) && v.replace(/\D/g, '').length >= 6 })}
            />
            {avisoLargo && <p role="status" className="text-sm text-warn sm:col-span-2 -mt-2">Aviso: {avisoLargo} Puedes guardarlo igual.</p>}
            <Input
              label="CCI (opcional)" inputMode="numeric" autoComplete="off" className="sm:col-span-2"
              hint="Código interbancario de 20 dígitos (puedes escribirlo con guiones), para transferencias desde otros bancos."
              error={errors.cci && 'El CCI tiene 20 dígitos'}
              {...register('cci', { validate: v => v.trim() === '' || /^\d{20}$/.test(v.replace(/[\s-]/g, '')) })}
            />
            {avisoCodigo && <p role="status" className="text-sm text-warn sm:col-span-2 -mt-2">Aviso: {avisoCodigo} Puedes guardarlo igual.</p>}
          </>
        )}

        {tipo === 'recaudacion' && (
          <>
            <Input
              label="Servicio" autoComplete="off" maxLength={80} className="sm:col-span-2"
              hint="Escríbelo tal como aparece en «Pago de servicios» de la app del banco."
              error={errors.servicio && 'Escribe el nombre del servicio (hasta 80 caracteres)'}
              {...register('servicio', { validate: v => v.trim().length > 0 && v.trim().length <= 80 })}
            />
            <Select label="Código que escribe el vecino" className={codigoPago === 'otro' ? undefined : 'sm:col-span-2'} hint="Con «departamento», cada vecino verá el código de SU unidad." {...register('codigo_pago', { required: true })}>
              {CODIGOS_PAGO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            {codigoPago === 'otro' && (
              <Input
                label="¿Qué debe escribir?" autoComplete="off" maxLength={120}
                error={errors.codigo_instruccion && 'Indica qué código debe escribir (hasta 120 caracteres)'}
                {...register('codigo_instruccion', { validate: v => v.trim().length > 0 && v.trim().length <= 120 })}
              />
            )}
          </>
        )}

        {(tipo === 'yape' || tipo === 'plin') && (
          <Controller control={control} name="celular" rules={{ validate: v => !!parsearCelular(v) || 'Usa un celular válido para el país elegido' }} render={({ field }) => (
            <TelefonoInput
              label={`Celular de ${tipo === 'yape' ? 'Yape' : 'Plin'}`} soloCelular className="sm:col-span-2"
              hint="Celular de cualquier país. Sin código de país se toma como de Perú."
              error={errors.celular?.message} value={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} name={field.name}
            />
          )} />
        )}

        <Input label="Titular" className={tipo === 'banco' ? undefined : 'sm:col-span-2'} autoComplete="off" error={errors.titular && 'Ingresa el nombre del titular'} {...register('titular', { required: true, validate: v => v.trim().length > 0 })} />
        {tipo === 'banco' && (
          <Input
            label="DNI o RUC del titular (opcional)" inputMode="numeric" autoComplete="off"
            error={errors.documento_titular && 'Usa un DNI de 8 o un RUC de 11 dígitos'}
            {...register('documento_titular', { validate: v => v.trim() === '' || /^(\d{8}|\d{11})$/.test(v.trim()) })}
          />
        )}

        {tipo !== 'recaudacion' && (
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
        )}

        <Interruptor className="sm:col-span-2" label="Activo" hint={`Los medios inactivos no se muestran a los vecinos. Máximo 6 activos por ${palabra.una}.`} {...register('activo')} />
      </form>
    </Modal>
  );
}
