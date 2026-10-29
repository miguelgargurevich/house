/** Lo que el alta de un usuario (`POST /api/usuarios`) devuelve de la invitación; ausente cuando se le puso contraseña al crearlo. */
export interface RespuestaAlta {
  invitacion?: { estado: 'enviada' | 'sin_correo' | 'no_enviada'; motivo?: string };
}

/** Qué decirle a quien acaba de crear a alguien: lo normal es «invitación enviada»; lo demás pide una acción y se muestra como aviso. */
export function mensajeDeAlta(r: RespuestaAlta, email: string, singular: string): { tono: 'ok' | 'aviso'; texto: string } {
  const creado = `${singular[0]!.toUpperCase()}${singular.slice(1)} creado`;
  switch (r.invitacion?.estado) {
    case undefined: return { tono: 'ok', texto: creado };
    case 'enviada': return { tono: 'ok', texto: `${creado}. Le enviamos una invitación a ${email}.` };
    case 'sin_correo': return { tono: 'aviso', texto: `${creado}, pero su correo no recibe mensajes y no se pudo enviar la invitación. Edita la cuenta y asígnale una contraseña.` };
    case 'no_enviada': return { tono: 'aviso', texto: `${creado}, pero no pudimos enviar la invitación. Usa «Reenviar invitación» en la lista.` };
  }
}
