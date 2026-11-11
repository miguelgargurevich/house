// Textos de «Eliminar tu cuenta»: los comparten la página pública /eliminar-cuenta (la URL que pide Google Play) y la sección «Eliminar mi cuenta» de Mi perfil
// (lo que pide Apple, guía 5.1.1(v)), para que digan lo mismo. Español neutro, tuteo, sin números ni direcciones: el correo y el WhatsApp salen de la base.

export const ELIMINAR_CUENTA = {
  titulo: 'Eliminar tu cuenta de Torre',
  bajada: 'Puedes eliminar tu cuenta cuando quieras, desde la app o desde la web. Aquí te contamos cómo hacerlo, qué se borra y qué se conserva.',
  /** Dirección del formulario de contacto para quien ya no puede entrar (el formulario lee `tema=eliminar-cuenta`). */
  enlace_contacto: '/contacto?tema=eliminar-cuenta',
  pasos_titulo: 'Cómo eliminar tu cuenta',
  pasos: [
    'Entra a Torre con tu correo y tu contraseña, en la app o en la web.',
    'Abre «Mi perfil» desde tu nombre, arriba a la derecha.',
    'Baja hasta el final y toca «Eliminar mi cuenta».',
    'Escribe tu contraseña y la palabra ELIMINAR, y confirma. Tu cuenta se elimina al momento.',
  ],
  se_borra_titulo: 'Qué se borra',
  se_borra: [
    'Tu acceso: no podrás volver a entrar con ese correo y se cierran tus sesiones en todos tus dispositivos.',
    'Tus datos personales: tu nombre, tu correo y tu celular se reemplazan por «Cuenta eliminada», y se apagan tus avisos por correo y WhatsApp.',
    'Tus vínculos de WhatsApp y Telegram, tus tokens de API, tus avisos y tus conversaciones con el asistente.',
    'Tu lugar en el departamento y en la junta directiva: la administración asigna a quien corresponda.',
  ],
  se_conserva_titulo: 'Qué se conserva',
  se_conserva: [
    'Los recibos, pagos, vouchers y movimientos de tu departamento. Son los libros contables del condominio: tu administradora es la responsable de ese tratamiento, como explica la Política de privacidad.',
    'Donde el historial muestre quién hizo un pago o una gestión, dirá «Cuenta eliminada», sin tus datos.',
    'El registro de accesos y de cambios de seguridad, sólo por el plazo que indica la Política de privacidad.',
  ],
  libre: 'Tu correo queda libre: si más adelante quieres volver, tu administradora puede invitarte otra vez con el mismo correo.',
  unica_titulo: 'Si eres la única administradora de tu empresa',
  unica: 'Tu cuenta no se elimina al momento, porque el condominio se quedaría sin nadie que lo administre. En «Mi perfil › Eliminar mi cuenta» puedes pedir el cierre de tu empresa: lo atendemos según los Términos, con una copia de tus datos y su eliminación o anonimización a los 90 días, salvo lo que la ley obligue a conservar. Si tu empresa tiene otra administradora activa, sí puedes eliminar tu cuenta tú misma.',
  sin_acceso_titulo: '¿Ya no puedes entrar?',
  sin_acceso: 'Si olvidaste tu contraseña o no tienes acceso a tu correo, escríbenos y te ayudamos a eliminar tu cuenta. Por seguridad, podemos pedirte que confirmes que eres tú.',
  sin_acceso_enlace: 'Pedir que eliminen mi cuenta',
  eliminada_titulo: 'Tu cuenta fue eliminada',
  eliminada: 'Cerramos tus sesiones y anonimizamos tus datos personales. Gracias por haber usado Torre.',
} as const;

/** La frase que se escribe para confirmar (el servidor la compara sin importar mayúsculas ni espacios). */
export const FRASE_CONFIRMAR = 'ELIMINAR';

/** Lo que cuenta la pantalla de Mi perfil antes de pedir la confirmación (la versión corta de arriba). */
export const PERFIL_ELIMINAR = {
  titulo: 'Eliminar mi cuenta',
  descripcion: 'Borra tu acceso y tus datos personales. Los recibos y pagos del condominio se conservan.',
  boton: 'Eliminar mi cuenta',
  dialogo_titulo: 'Eliminar mi cuenta',
  dialogo_descripcion: 'Esto no se puede deshacer. Para confirmar, escribe tu contraseña y la palabra ELIMINAR.',
  campo_clave: 'Tu contraseña',
  campo_frase: 'Escribe ELIMINAR para confirmar',
  confirmar: 'Eliminar mi cuenta',
  cancelar: 'Cancelar',
  unica_alerta: 'Eres la única administradora de tu empresa, así que tu cuenta no se elimina al momento: el condominio se quedaría sin nadie que lo administre. Puedes pedir el cierre de tu empresa; lo atendemos según los Términos, con una copia de tus datos y su eliminación o anonimización a los 90 días, salvo lo que la ley obligue a conservar.',
  unica_boton: 'Solicitar el cierre de mi empresa',
  unica_dialogo_titulo: 'Solicitar el cierre de mi empresa',
  unica_dialogo_descripcion: 'Le avisamos a Torre y te escribimos a tu correo. Tu cuenta sigue activa hasta entonces. Escribe tu contraseña para confirmar.',
  unica_enviar: 'Enviar la solicitud',
  unica_pendiente: 'Ya pediste el cierre de tu empresa. Torre lo está atendiendo y te escribirá a tu correo. Tu cuenta sigue activa mientras tanto.',
  unica_listo: 'Recibimos tu solicitud de cierre. Te escribimos a tu correo.',
} as const;
