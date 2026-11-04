// El correo de cada aviso con diseño: título, tarjeta con lo importante, tabla de conceptos completa, botón y pie. Usa el layout común de
// `correoHtml.ts`; el asunto y el texto plano (respaldo) salen de `plantillas.ts`, así que HTML y texto dicen lo mismo.
// Lo que viene de la base (nombre, conceptos, comunicado) se escapa en `plantillaCorreo`; aquí sólo se pasa texto plano.
import type { MarcaCorreo } from '../marca/tipos';
import { PIE_TORRE, plantillaCorreo, type FilaResumen, type PlantillaCorreo } from './correoHtml';
import { ENLACE_APP, avisoMora, cuando, enlaceDeAviso, fechaLarga, plantilla, primerNombre, type DatosAviso, type TipoAviso } from './plantillas';

const COBRO: readonly TipoAviso[] = ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido'];
const BOTON: Record<TipoAviso, string> = {
  recibo_emitido: 'Ver y pagar mi recibo',
  por_vencer: 'Pagar y subir mi voucher',
  vence_hoy: 'Pagar y subir mi voucher',
  vencido: 'Regularizar mi pago',
  pago_validado: 'Ver mis pagos',
  pago_rechazado: 'Revisar y volver a enviar mi pago',
  comunicado: 'Ver el comunicado',
  cierre_pendiente: 'Abrir el cierre',
  recordatorio_deuda: 'Pagar y subir mi voucher',
  ia_caida: 'Abrir el llavero de IA',
  ia_restablecida: 'Abrir el llavero de IA',
};

/** «B01-804 (Block 1)». */
const unidad = (x: { codigo: string; torre: string | null }) => `${x.codigo}${x.torre ? ` (${x.torre})` : ''}`;

function filasDeUnidades(d: DatosAviso): FilaResumen[] {
  const ds = d.departamentos ?? [];
  if (ds.length === 1) return [{ etiqueta: 'Departamento', valor: unidad(ds[0]!) }];
  return ds.map((x) => ({ etiqueta: 'Departamento', valor: x.monto ? `${unidad(x)}: ${x.monto}` : unidad(x) }));
}

/** Cuándo vence, dicho para la fila de la tarjeta (en el texto de la frase va en `plantillas.ts`). */
function filaVencimiento(tipo: TipoAviso, d: DatosAviso): FilaResumen {
  const dia = d.vence ? fechaLarga(d.vence) : d.vencimiento;
  if (tipo === 'vencido') return { etiqueta: 'Venció', valor: `el ${dia}`, alerta: true };
  if (tipo === 'vence_hoy') return { etiqueta: 'Vence', valor: `hoy, ${dia}`, alerta: true };
  if (tipo === 'por_vencer') return { etiqueta: 'Vence', valor: `${dia} (${cuando(d.dias)})` };
  return { etiqueta: 'Vence', valor: dia };
}

/** El pie de página: quién escribe, por qué lo recibes y cómo dejar de recibirlo. Siempre trae la salida (preferencias de Mi perfil). */
function piePagina(tipo: TipoAviso, d: DatosAviso): string[] {
  const quien = tipo === 'ia_caida' || tipo === 'ia_restablecida'
    ? 'Es un aviso de la plataforma Torre para su administración.'
    : `Te escribe la administración${d.condominio ? ` de ${d.condominio}` : ' de tu condominio'} desde Torre.`;
  return [
    quien,
    'Recibes este correo porque tienes activados los avisos por correo en tu cuenta de Torre.',
    `Para dejar de recibirlo, apaga «Avisos por correo» en Mi perfil › Celular y avisos: ${ENLACE_APP}/perfil`,
    PIE_TORRE,
  ];
}

/** Párrafos de un texto plano guardado: separa por línea en blanco y quita la firma final («— Administración…»), que ya va en el pie. */
function parrafosDeTexto(texto: string): string[] {
  const ps = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (ps.length > 1 && /^—\s/.test(ps[ps.length - 1]!)) ps.pop();
  return ps;
}

function contenido(tipo: TipoAviso, d: DatosAviso, asunto: string, cuerpo: string, completo: boolean): PlantillaCorreo {
  const hola = `Hola ${primerNombre(d.nombre)},`;
  const base = { titulo: asunto, condominio: d.condominio, piePagina: piePagina(tipo, d) };
  const boton = { texto: BOTON[tipo], url: d.enlace ?? enlaceDeAviso(tipo, null, d.central) };

  // Sin datos (ya no se pueden rehacer) o avisos de la plataforma: se arma con el texto guardado, sin tarjeta.
  if (!completo) return { ...base, parrafos: parrafosDeTexto(cuerpo), boton };

  if (COBRO.includes(tipo)) {
    const vencido = tipo === 'vencido';
    const urgente = vencido || tipo === 'vence_hoy';
    const parrafos: Record<string, string> = {
      recibo_emitido: `Ya emitimos tu recibo de ${d.periodo}. Revísalo y págalo desde Torre con tu voucher.`,
      por_vencer: `Te recordamos que tu recibo de ${d.periodo} vence ${cuando(d.dias)} y aún no recibimos tu voucher de pago.`,
      vence_hoy: `Hoy vence tu recibo de ${d.periodo} y aún no recibimos tu voucher de pago.`,
      vencido: `Tu recibo de ${d.periodo} ya venció y aún tienes un saldo pendiente. Regulariza tu pago cuanto antes para evitar recargos.`,
    };
    return {
      ...base,
      parrafos: [hola, parrafos[tipo]!, ...(d.mora && (tipo === 'por_vencer' || tipo === 'vence_hoy') ? [avisoMora(d).trim()] : [])],
      previa: `${tipo === 'recibo_emitido' ? 'Total a pagar' : 'Pendiente'} ${d.monto}. ${filaVencimiento(tipo, d).etiqueta} ${filaVencimiento(tipo, d).valor}.`,
      resumen: {
        total: { etiqueta: tipo === 'recibo_emitido' ? 'Total a pagar' : 'Pendiente de pago', valor: d.monto, alerta: urgente },
        filas: [...filasDeUnidades(d), { etiqueta: 'Periodo', valor: d.periodo }, filaVencimiento(tipo, d)],
      },
      ...(d.conceptos?.length ? { tabla: { titulo: 'Detalle del recibo', filas: d.conceptos.map((c) => ({ concepto: c.nombre, monto: c.monto })), total: { concepto: 'Total', monto: d.monto } } } : {}),
      boton,
    };
  }

  switch (tipo) {
    case 'recordatorio_deuda':
      return {
        ...base,
        parrafos: [hola, 'Te escribimos para recordarte que tienes un saldo vencido en tu mantenimiento. Paga y sube tu voucher desde Torre; si ya pagaste, avísanos para revisarlo.'],
        previa: `Saldo vencido ${d.monto}.`,
        resumen: { total: { etiqueta: 'Saldo vencido', valor: d.monto, alerta: true }, filas: filasDeUnidades(d) },
        ...(d.conceptos?.length ? { tabla: { titulo: 'Lo que está vencido', filas: d.conceptos.map((c) => ({ concepto: c.nombre, monto: c.monto })), total: { concepto: 'Total', monto: d.monto } } } : {}),
        boton,
      };
    case 'pago_validado':
    case 'pago_rechazado': {
      const rechazado = tipo === 'pago_rechazado';
      return {
        ...base,
        parrafos: [hola, rechazado ? `No pudimos validar tu pago de ${d.periodo}. Revisa el motivo y vuelve a enviar tu comprobante.` : `Validamos tu pago de ${d.periodo}. Gracias por estar al día.`],
        resumen: {
          total: { etiqueta: rechazado ? 'Pago que no pudimos validar' : 'Pago validado', valor: d.monto, alerta: rechazado },
          filas: [...filasDeUnidades(d), { etiqueta: 'Periodo', valor: d.periodo }, ...(d.concepto ? [{ etiqueta: 'Concepto', valor: d.concepto }] : []), ...(rechazado && d.motivo ? [{ etiqueta: 'Motivo', valor: d.motivo, alerta: true }] : [])],
        },
        boton,
      };
    }
    case 'comunicado':
      return { ...base, titulo: d.titulo ?? asunto, parrafos: [hola, ...(d.texto ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)], boton };
    case 'cierre_pendiente':
      return { ...base, parrafos: parrafosDeTexto(cuerpo), boton: { texto: d.central ? 'Abrir el cierre de la Junta central' : 'Registrar los pagos del cierre', url: boton.url } };
    default:
      return { ...base, parrafos: parrafosDeTexto(cuerpo), boton };
  }
}

/**
 * Asunto, texto plano y HTML de un aviso. `datos` salen de `cargarDatos` (la base, al enviar); `null` si ya no se pueden rehacer. `guardado` es el
 * asunto y el texto de la notificación: el texto plano es ése (el mismo de `plantilla()` al encolar), así que quien lo lee sin HTML recibe lo mismo.
 * Con `datos` en `null`, y siempre en los avisos de la IA (su motivo sólo vive en el texto guardado), el HTML se arma con ese texto.
 * `marca`: la de la empresa que escribe, sólo si tiene la marca propia activa (cabecera con su logo, nombre y color; pie «Enviado con Torre»).
 */
export function correoDeAviso(tipo: TipoAviso, datos: DatosAviso | null, guardado?: { asunto: string; cuerpo: string; rol?: string | null }, marca?: MarcaCorreo | null): { asunto: string; texto: string; html: string } {
  const d: DatosAviso = datos ?? { nombre: '', periodo: '', monto: '', vencimiento: '' };
  const p = plantilla(tipo, d);
  const asunto = guardado?.asunto ?? p.asunto;
  const texto = guardado?.cuerpo ?? p.cuerpo;
  const completo = datos != null && tipo !== 'ia_caida' && tipo !== 'ia_restablecida';
  const conEnlace = d.enlace ? d : { ...d, enlace: enlaceDeAviso(tipo, guardado?.rol) };
  const { html } = plantillaCorreo({ ...contenido(tipo, conEnlace, asunto, texto, completo), marca: marca ?? null });
  return { asunto, texto, html };
}
