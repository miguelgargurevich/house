import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../../api';
import { Alert, Button, Input, Modal, Select, TelefonoInput, useToast } from '../../../../../ui';
import { Interruptor } from '../../catalogo/Interruptor';
import { FORM_VACIO, RELACIONES, formDe, type FormPersona, type Persona } from './tipos';

interface Props {
  unidadId: number;
  /** `'nueva'` para agregar; una persona para editarla; null = cerrado. */
  persona: Persona | 'nueva' | null;
  onClose: () => void;
  /** Se espera antes de avisar: debe dejar la lista releída. */
  onGuardada: () => Promise<void>;
}

/** Alta y edición de una persona del departamento. Con usuario en Torre, el nombre y (con acceso) el correo no se cambian aquí. */
export function PersonaFormModal({ unidadId, persona, onClose, onGuardada }: Props) {
  const toast = useToast();
  const esNueva = persona === 'nueva';
  const [v, setV] = useState<FormPersona>(FORM_VACIO);
  const [errores, setErrores] = useState<Partial<Record<keyof FormPersona, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (persona === null) return;
    setV(persona === 'nueva' ? FORM_VACIO : formDe(persona));
    setErrores({});
    setError(null);
  }, [persona]);

  const editando = persona !== null && persona !== 'nueva' ? persona : null;
  const nombreFijo = !!editando?.tiene_cuenta;
  const correoFijo = !!editando?.tiene_cuenta && editando.acceso_activo;
  const relacionFija = !!editando?.principal;
  const set = <K extends keyof FormPersona>(k: K, valor: FormPersona[K]) => setV((x) => ({ ...x, [k]: valor }));

  async function guardar() {
    const nuevos: Partial<Record<keyof FormPersona, string>> = {};
    if (!v.nombre.trim()) nuevos.nombre = 'Escribe el nombre';
    if (v.correo.trim() && !/^\S+@\S+\.\S+$/.test(v.correo.trim())) nuevos.correo = 'Revisa el correo';
    setErrores(nuevos);
    if (Object.keys(nuevos).length) return;
    setGuardando(true);
    setError(null);
    const cuerpo = {
      nombre: v.nombre.trim(), relacion: v.relacion, correo: v.correo.trim() || null, celular: v.celular.trim() || null,
      responsable_pago: v.responsable_pago, recibe_comunicados: v.recibe_comunicados,
    };
    try {
      if (esNueva) await api(`/api/unidades/${unidadId}/personas`, { method: 'POST', json: cuerpo });
      else {
        // Sólo viaja lo que se puede cambiar y cambió: así el servidor no rechaza lo que la ficha no deja tocar.
        const p = editando!;
        await api(`/api/unidades/${unidadId}/personas/${p.id}`, {
          method: 'PUT',
          json: {
            ...(nombreFijo ? {} : { nombre: cuerpo.nombre }),
            ...(relacionFija ? {} : { relacion: cuerpo.relacion }),
            ...(correoFijo ? {} : { correo: cuerpo.correo }),
            celular: cuerpo.celular,
            ...(v.responsable_pago !== p.responsable_pago ? { responsable_pago: v.responsable_pago } : {}),
            ...(v.recibe_comunicados !== p.recibe_comunicados ? { recibe_comunicados: v.recibe_comunicados } : {}),
          },
        });
      }
      // Primero la lista al día (en producción la lectura tarda): el aviso sale cuando la tarjeta ya muestra lo guardado.
      await onGuardada();
      toast.ok(esNueva ? 'Persona agregada' : 'Cambios guardados');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open={persona !== null}
      onClose={onClose}
      title={esNueva ? 'Agregar persona' : 'Editar persona'}
      description="Quién vive o es dueño del departamento y cómo avisarle."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={guardando} onClick={guardar}>{esNueva ? 'Agregar' : 'Guardar cambios'}</Button></>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void guardar(); }} className="grid gap-4" noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Nombre" value={v.nombre} onChange={(e) => set('nombre', e.target.value)} error={errores.nombre} disabled={nombreFijo} hint={nombreFijo ? 'Esta persona ya tiene usuario: su nombre se cambia en Usuarios.' : undefined} autoComplete="off" />
        <Select label="Relación con el departamento" value={v.relacion} onChange={(e) => set('relacion', e.target.value as FormPersona['relacion'])} disabled={relacionFija} hint={relacionFija ? 'Es el titular o el inquilino principal. Para cambiarlo usa «Hacer titular» en otra persona.' : 'Cada departamento tiene un propietario y un inquilino; el resto va como copropietario, cónyuge, familiar u otro.'}>
          {RELACIONES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </Select>
        <Input label="Correo" type="email" inputMode="email" value={v.correo} onChange={(e) => set('correo', e.target.value)} error={errores.correo} disabled={correoFijo} hint={correoFijo ? 'Es el correo de su acceso: apaga el acceso antes de cambiarlo.' : 'Hace falta para darle usuario en Torre.'} autoComplete="off" />
        <TelefonoInput label="Celular" soloCelular value={v.celular} onChange={(x) => set('celular', x)} hint="Para los avisos por WhatsApp." />
        <Interruptor label="Responsable de pago" hint="Es la única persona del departamento a quien le llega el aviso de cobro. Al marcarla, la anterior deja de serlo. Pide un correo o un celular." checked={v.responsable_pago} disabled={!!editando?.responsable_pago} onChange={(e) => set('responsable_pago', e.target.checked)} />
        <Interruptor label="Recibe los comunicados" hint="Le llegan los comunicados enviados «a cada vecino», por correo o WhatsApp si tiene." checked={v.recibe_comunicados} onChange={(e) => set('recibe_comunicados', e.target.checked)} />
      </form>
    </Modal>
  );
}
