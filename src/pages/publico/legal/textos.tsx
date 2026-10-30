/** @jsxRuntime automatic */
// Textos de la Política de privacidad y de los Términos, tal como están en docs/legal/*.md (autoritativos: no cambiar su sentido).
// Los datos del responsable salen de `GET /api/publico/legal`; los pendientes, de UN solo bloque (PENDIENTES) hasta que se decidan.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Dato, POR_CONFIRMAR, type Seccion } from './piezas';
import type { DatosLegales } from './datos';

/** Estado de los datos legales al pintar la página (ver `useDatosLegales`). */
export interface Legal { datos: DatosLegales | null; cargando: boolean }

/** Datos que todavía no están decididos. Cuando se definan, se reemplazan aquí (y sólo aquí). */
export const PENDIENTES = {
  hosting: POR_CONFIRMAR,
  proveedor_correo: POR_CONFIRMAR,
  plazo_auditoria: POR_CONFIRMAR,
  dias_aviso_precios: POR_CONFIRMAR,
  dias_conservacion: POR_CONFIRMAR,
} as const;

/** Un dato del responsable (razón social, RUC, domicilio o correo) con su estado de carga. */
const dato = (l: Legal, k: 'razon_social' | 'ruc' | 'domicilio' | 'correo') => <Dato valor={l.datos?.[k]} cargando={l.cargando} />;
const pendiente = (valor: string) => <Dato valor={valor} />;

export function textosPrivacidad(l: Legal): { intro: ReactNode; secciones: Seccion[] } {
  const correo = dato(l, 'correo');
  return {
    intro: <p>Esta política explica qué datos personales trata House, para qué, con quién los comparte y cómo puedes ejercer tus derechos, según la Ley N.º 29733, Ley de Protección de Datos Personales, y su Reglamento (D.S. N.º 016-2024-JUS).</p>,
    secciones: [
      {
        id: 'responsable',
        titulo: '1. Quién es el responsable',
        cuerpo: <>
          <ul>
            <li>Responsable de House: {dato(l, 'razon_social')}, RUC {dato(l, 'ruc')}, con domicilio en {dato(l, 'domicilio')}.</li>
            <li>Contacto para temas de privacidad: {correo}.</li>
          </ul>
          <p>House es un servicio para administrar edificios y condominios. Hay dos situaciones distintas:</p>
          <ul>
            <li><strong>Si te registras como administradora o junta directiva</strong>, House trata tus datos como <strong>titular del banco de datos</strong> de sus clientes.</li>
            <li><strong>Si eres vecino (propietario o inquilino) o personal del edificio</strong>, tus datos los carga y decide tu administradora o tu junta. Ella es la <strong>responsable</strong> de ese tratamiento y House actúa como <strong>encargado</strong>: trata los datos sólo para prestarle el servicio y según sus instrucciones. Para ejercer tus derechos puedes dirigirte a tu administradora o escribirnos; si nos escribes, se lo trasladamos.</li>
          </ul>
        </>,
      },
      {
        id: 'datos',
        titulo: '2. Qué datos tratamos',
        cuerpo: <>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-surface2 text-xs text-muted">
                <tr><th scope="col" className="w-[38%] px-3 py-2 font-medium">Quién</th><th scope="col" className="px-3 py-2 font-medium">Datos</th></tr>
              </thead>
              <tbody className="divide-y divide-line align-top">
                <tr><th scope="row" className="px-3 py-2.5 font-medium break-words">Quien se registra (administradora o junta)</th><td className="px-3 py-2.5 break-words">Nombre, correo, celular, contraseña (guardada cifrada, nunca en texto), nombre de la administradora o junta y del condominio.</td></tr>
                <tr><th scope="row" className="px-3 py-2.5 font-medium break-words">Vecinos</th><td className="px-3 py-2.5 break-words">Nombre, correo, celular, departamento y block, rol (propietario o inquilino), cargo en la junta si lo tiene, recibos, pagos, deudas, lecturas de agua y preferencias de avisos.</td></tr>
                <tr><th scope="row" className="px-3 py-2.5 font-medium break-words">Vouchers de pago</th><td className="px-3 py-2.5 break-words">La imagen del comprobante y lo que se lee de él: monto, fecha, número de operación, banco y nombre de quien paga o de la cuenta de destino.</td></tr>
                <tr><th scope="row" className="px-3 py-2.5 font-medium break-words">Personal del edificio</th><td className="px-3 py-2.5 break-words">Nombre, correo, celular y tareas asignadas.</td></tr>
                <tr><th scope="row" className="px-3 py-2.5 font-medium break-words">Uso del servicio</th><td className="px-3 py-2.5 break-words">Registro de accesos y de cambios (fecha, usuario y acción), dirección IP y datos técnicos de la sesión.</td></tr>
              </tbody>
            </table>
          </div>
          <p>No pedimos datos sensibles (salud, origen racial, opiniones políticas o religiosas, datos biométricos). Te pedimos no subir comprobantes con más información de la necesaria.</p>
        </>,
      },
      {
        id: 'finalidades',
        titulo: '3. Para qué los usamos',
        cuerpo: <>
          <ol>
            <li>Prestar el servicio: emitir recibos, registrar y validar pagos, calcular deudas, mostrar a cada vecino su estado de cuenta y a la junta y la administradora la cobranza del edificio.</li>
            <li>Leer y validar los vouchers, de forma automática (OCR y, si hace falta, inteligencia artificial) y siempre con la revisión del tesorero o la administradora.</li>
            <li>Enviar avisos del servicio por correo y, si el plan y tus preferencias lo permiten, por WhatsApp o Telegram (recibos, recordatorios de pago, confirmaciones).</li>
            <li>Dar acceso seguro a la cuenta: verificar el correo, iniciar sesión, invitar usuarios, recuperar la contraseña.</li>
            <li>Atender consultas y la facturación del plan contratado.</li>
            <li>Seguridad y prevención de fraude: registro de accesos y cambios, límites de intentos.</li>
          </ol>
          <p>Estas finalidades son necesarias para el servicio que tú o tu administradora contrataron. <strong>No vendemos tus datos ni los usamos para publicidad de terceros.</strong> Si algún día queremos enviarte novedades comerciales de House, te pediremos un consentimiento aparte, que podrás retirar cuando quieras.</p>
        </>,
      },
      {
        id: 'quien-ve',
        titulo: '4. Quién ve tus datos',
        cuerpo: <>
          <ul>
            <li><strong>Tu administradora y tu junta directiva</strong> ven los datos del condominio que administran. Los vecinos no ven la lista de otros vecinos ni sus deudas: sólo ven su propia cuenta y los nombres y cargos de la junta de su block.</li>
            <li><strong>Proveedores que nos ayudan a prestar el servicio</strong> (encargados), que sólo pueden usar los datos para eso:
              <ul>
                <li>Alojamiento y servidores: {pendiente(PENDIENTES.hosting)}.</li>
                <li>Envío de correos: {pendiente(PENDIENTES.proveedor_correo)}.</li>
                <li>Mensajería: WhatsApp (Meta) y Telegram, sólo para quienes tengan esos avisos activos.</li>
                <li>Lectura de vouchers con inteligencia artificial: proveedores de modelos de IA, a los que se envía la imagen del voucher cuando el OCR no alcanza para leerlo.</li>
              </ul>
            </li>
            <li><strong>Autoridades</strong>, cuando una ley o una orden lo exija.</li>
          </ul>
        </>,
      },
      {
        id: 'transferencias',
        titulo: '5. Transferencias fuera del Perú',
        cuerpo: <p>Algunos de estos proveedores (mensajería, correo, inteligencia artificial y, según el caso, alojamiento) tienen sus servidores fuera del Perú. Esa transferencia es necesaria para prestar el servicio y se hace con proveedores que ofrecen niveles de protección adecuados.</p>,
      },
      {
        id: 'plazos',
        titulo: '6. Cuánto tiempo los guardamos',
        cuerpo: <ul>
          <li>Mientras la cuenta o el condominio estén activos en House.</li>
          <li>Recibos, pagos y vouchers: mientras el condominio use House y, después, el tiempo que exijan las normas contables y tributarias o que haga falta para atender reclamos.</li>
          <li>Registros de acceso y de cambios: hasta {pendiente(PENDIENTES.plazo_auditoria)}.</li>
          <li>Al terminar el servicio, la administradora puede pedir una copia de sus datos y su eliminación.</li>
        </ul>,
      },
      {
        id: 'seguridad',
        titulo: '7. Cómo los protegemos',
        cuerpo: <p>Conexión cifrada (HTTPS), contraseñas cifradas, acceso separado por administradora y condominio, permisos por rol, registro de accesos y copias de respaldo. Si ocurriera un incidente de seguridad que afecte tus datos, lo comunicaremos a la Autoridad Nacional de Protección de Datos Personales y a los afectados en los plazos de ley.</p>,
      },
      {
        id: 'derechos',
        titulo: '8. Tus derechos',
        cuerpo: <>
          <p>Puedes pedir <strong>acceso</strong> a tus datos, su <strong>rectificación</strong> (corregirlos), su <strong>cancelación</strong> (eliminarlos) y <strong>oponerte</strong> a su tratamiento, además de revocar un consentimiento que nos hayas dado. Escríbenos a {correo} indicando tu nombre, tu correo en House y qué pides. Responderemos en los plazos de ley. Muchos datos los puedes corregir tú mismo en <strong>Mi perfil</strong>.</p>
          <p>Si no estás conforme con la respuesta, puedes acudir a la Autoridad Nacional de Protección de Datos Personales del Ministerio de Justicia y Derechos Humanos.</p>
        </>,
      },
      {
        id: 'cookies',
        titulo: '9. Cookies',
        cuerpo: <p>House usa sólo lo necesario para que funcione: la sesión iniciada y preferencias como el tema claro u oscuro. No usamos cookies de publicidad ni de seguimiento de terceros.</p>,
      },
      {
        id: 'menores',
        titulo: '10. Menores de edad',
        cuerpo: <p>House no está dirigido a menores de 18 años y no pedimos sus datos a propósito.</p>,
      },
      {
        id: 'cambios',
        titulo: '11. Cambios a esta política',
        cuerpo: <p>Si la cambiamos, publicaremos la nueva versión aquí con su fecha y, si el cambio es importante, te avisaremos dentro de House o por correo.</p>,
      },
    ],
  };
}

export function textosTerminos(l: Legal): { intro: ReactNode; secciones: Seccion[] } {
  const correo = dato(l, 'correo');
  return {
    intro: null,
    secciones: [
      {
        id: 'servicio',
        titulo: '1. El servicio',
        cuerpo: <p>House es un servicio en línea de {dato(l, 'razon_social')} (RUC {dato(l, 'ruc')}) para administrar edificios y condominios: recibos, pagos, morosidad, comunicados, junta directiva y portal del vecino. Al crear una cuenta o usar House aceptas estos términos y la <Link to="/privacidad" className="font-medium text-brand underline">Política de privacidad</Link>.</p>,
      },
      {
        id: 'cuentas',
        titulo: '2. Cuentas',
        cuerpo: <ul>
          <li>Quien se registra declara actuar en nombre de la administradora o la junta que indica, y ser mayor de edad.</li>
          <li>Cada usuario cuida su contraseña y no la comparte. Avísanos si sospechas que alguien entró a tu cuenta.</li>
          <li>La administradora o la junta decide a quién invita y con qué rol, y responde por los usuarios que crea.</li>
        </ul>,
      },
      {
        id: 'planes',
        titulo: '3. Planes y pagos',
        cuerpo: <ul>
          <li>El plan <strong>Gratis</strong> no tiene costo y tiene los límites publicados en <Link to="/precios" className="font-medium text-brand underline">Precios</Link>.</li>
          <li>Los planes de pago se cobran por departamento y por mes, según la tarifa vigente publicada. Si el pago vence y no se renueva, el condominio vuelve a las funciones de Gratis; sus datos se conservan.</li>
          <li>Podemos cambiar precios y planes avisando con al menos {pendiente(PENDIENTES.dias_aviso_precios)} días de anticipación; el cambio rige desde el siguiente período.</li>
        </ul>,
      },
      {
        id: 'encargo',
        titulo: '4. Datos del condominio y de los vecinos (encargo de tratamiento)',
        cuerpo: <ul>
          <li>La administradora o la junta es la <strong>responsable</strong> de los datos personales que carga en House (vecinos, personal, pagos y vouchers) y declara tener una base legal para tratarlos, como la relación de administración del edificio.</li>
          <li>House actúa como <strong>encargado del tratamiento</strong>: trata esos datos sólo para prestar el servicio, según las instrucciones de la administradora, con medidas de seguridad, y con proveedores sujetos a la misma obligación (ver la Política de privacidad).</li>
          <li>House no usa esos datos para fines propios ni los vende.</li>
          <li>Al terminar el servicio, la administradora puede pedir una copia de sus datos. Después de {pendiente(PENDIENTES.dias_conservacion)} días los eliminaremos o anonimizaremos, salvo lo que la ley obligue a conservar.</li>
          <li>Si recibimos una solicitud de un vecino sobre sus datos, se la trasladamos a su administradora.</li>
        </ul>,
      },
      {
        id: 'uso',
        titulo: '5. Uso aceptable',
        cuerpo: <p>No se permite usar House para enviar mensajes no deseados, cargar datos de personas sin una base legal, subir contenido ilícito, intentar acceder a datos de otras administradoras, ni afectar el funcionamiento del servicio.</p>,
      },
      {
        id: 'vouchers',
        titulo: '6. Validación automática de vouchers',
        cuerpo: <p>La lectura automática (OCR e inteligencia artificial) es una ayuda: puede equivocarse. La validación final de cada pago queda a cargo del tesorero o la administradora.</p>,
      },
      {
        id: 'responsabilidad',
        titulo: '7. Disponibilidad y responsabilidad',
        cuerpo: <p>Trabajamos para que House esté disponible y sus datos respaldados, pero puede haber interrupciones por mantenimiento o fallas de terceros. House no responde por decisiones tomadas sobre datos cargados incorrectamente por los usuarios. Nada de esto limita los derechos que te da el Código de Protección y Defensa del Consumidor cuando corresponda.</p>,
      },
      {
        id: 'baja',
        titulo: '8. Suspensión y baja',
        cuerpo: <p>Puedes dejar de usar House cuando quieras. Podemos suspender una cuenta que incumpla estos términos, avisando antes salvo que haya un riesgo para otros usuarios.</p>,
      },
      {
        id: 'cambios',
        titulo: '9. Cambios',
        cuerpo: <p>Si cambiamos estos términos, publicaremos la nueva versión con su fecha y, si el cambio es importante, te avisaremos.</p>,
      },
      {
        id: 'ley',
        titulo: '10. Ley aplicable',
        cuerpo: <p>Se rigen por las leyes del Perú. Consultas y reclamos: {correo}.</p>,
      },
    ],
  };
}
