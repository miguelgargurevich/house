/** Una persona del departamento tal como la devuelve `GET /api/unidades/:id/personas`. */
export type Relacion = 'propietario' | 'copropietario' | 'conyuge' | 'familiar' | 'inquilino' | 'otro';
export type EstadoAcceso = 'sin_cuenta' | 'apagado' | 'sin_correo' | 'sin_invitar' | 'en_cola' | 'invitado' | 'entro';

export interface Persona {
  id: number;
  unidad_id: number;
  nombre: string;
  relacion: Relacion;
  correo: string | null;
  celular: string | null;
  responsable_pago: boolean;
  recibe_comunicados: boolean;
  acceso_activo: boolean;
  tiene_cuenta: boolean;
  estado_acceso: EstadoAcceso;
  /** Es el titular o el inquilino principal del departamento. */
  principal: boolean;
}

export const RELACIONES: { value: Relacion; label: string }[] = [
  { value: 'propietario', label: 'Propietario' },
  { value: 'copropietario', label: 'Copropietario' },
  { value: 'conyuge', label: 'Cónyuge' },
  { value: 'familiar', label: 'Familiar' },
  { value: 'inquilino', label: 'Inquilino' },
  { value: 'otro', label: 'Otro' },
];

export const etiquetaRelacion = (r: string): string => RELACIONES.find((x) => x.value === r)?.label ?? r;

/** Lo que se dice bajo el interruptor «Tiene usuario en Torre». */
export function textoDeAcceso(e: EstadoAcceso): string {
  switch (e) {
    case 'sin_cuenta': return 'Todavía no tiene usuario. Al encenderlo se crea y se le invita por correo.';
    case 'apagado': return 'Acceso apagado: no entra a Torre. Sigue en la lista.';
    case 'sin_correo': return 'Tiene usuario, pero falta su correo para invitarle.';
    case 'sin_invitar': return 'Tiene usuario; todavía no se le invitó.';
    case 'en_cola': return 'Invitación en cola: sale en la próxima tanda.';
    case 'invitado': return 'Invitación enviada: falta que cree su contraseña.';
    case 'entro': return 'Ya entró a Torre.';
  }
}

export interface FormPersona {
  nombre: string;
  relacion: Relacion;
  correo: string;
  celular: string;
  responsable_pago: boolean;
  recibe_comunicados: boolean;
}

export const FORM_VACIO: FormPersona = { nombre: '', relacion: 'familiar', correo: '', celular: '', responsable_pago: false, recibe_comunicados: false };

export const formDe = (p: Persona): FormPersona => ({
  nombre: p.nombre, relacion: p.relacion, correo: p.correo ?? '', celular: p.celular ?? '', responsable_pago: p.responsable_pago, recibe_comunicados: p.recibe_comunicados,
});
