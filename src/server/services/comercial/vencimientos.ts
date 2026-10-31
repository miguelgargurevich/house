// Vencimientos de las suscripciones, dentro del ciclo del planificador de avisos (cada 15 min, con bloqueo entre réplicas).
// N días antes → correo «tu plan vence»; al vencer → estado `vencida` + correo con los días de gracia; pasada la gracia → módulos apagados + correo.
// Idempotente por periodo: cada aviso queda anotado con el `vigente_hasta` al que corresponde, así que repetir el ciclo no repite el correo
// y un pago nuevo (otro `vigente_hasta`) vuelve a habilitar los avisos del periodo siguiente.
import { prisma } from '../../db';
import { formatoDinero } from '../../../lib/paises';
import type { DepsAvisos } from '../avisos/canales';
import { fechaTexto } from '../avisos/plantillas';
import { correoA, obtenerConfiguracion } from './configuracion';
import { estadoEfectivo } from './estado';
import { comercialDeps, invalidarComercial } from './modulos';
import { procesarAvisosGratis } from './plazoGratis';
import { datosParaPagar, referenciaPago, vistas } from './suscripciones';

type Aviso = 'por_vencer' | 'vencida' | 'apagada';
const MARCA = { por_vencer: 'aviso_por_vencer_para', vencida: 'aviso_vencida_para', apagada: 'aviso_apagada_para' } as const;

export interface ResultadoVencimientos { revisadas: number; estados: number; correos: number }

async function cuerpoAviso(tipo: Aviso, complejoId: number, vigente: Date, diasGracia: number, ahora: Date, prueba: boolean): Promise<{ asunto: string; cuerpo: string }> {
  // La prueba de Pro sólo avisa que termina: después sigue en Gratis, sin cobro que pedir (no hay plan que pagar todavía).
  if (prueba) {
    const fin = fechaTexto(vigente);
    return { asunto: `Tu prueba de Torre Pro termina el ${fin}`, cuerpo: `Tu prueba de Torre Pro termina el ${fin}: después sigues en Torre Gratis, sin perder datos. Para seguir con la IA de vouchers, WhatsApp y reportes, pasa a Torre Pro desde Mi plan.` };
  }
  const [v] = await vistas([complejoId]);
  const pago = await datosParaPagar();
  // En la moneda del país del condominio y con su impuesto (IGV, IVA…); sin precio en esa moneda no hay monto que decir: se confirma por escrito.
  const monto = v.precio_consultar ? 'a confirmar (escríbenos y te lo pasamos)' : `${formatoDinero(v.cotizacion.total_mes, v.moneda)} al mes (${v.impuesto.nombre} incluido)`;
  const medios = [pago.yape ? `Yape: ${pago.yape}` : null, pago.banco ? `${pago.banco}${pago.cuenta ? ` cuenta ${pago.cuenta}` : ''}${pago.cci ? ` · CCI ${pago.cci}` : ''}` : null, pago.titular ? `Titular: ${pago.titular}` : null, pago.instrucciones].filter(Boolean).join('\n');
  const comoPagar = `Cómo pagar:\n${medios || 'Escríbenos y te pasamos los datos.'}\nReferencia: ${referenciaPago(complejoId, ahora)}\nCuando pagues, avísanos con el voucher y lo activamos.`;
  const hasta = fechaTexto(vigente);
  if (tipo === 'por_vencer') return { asunto: `Tu plan de Torre vence el ${hasta}`, cuerpo: `El plan de «${v.complejo}» vence el ${hasta}.\nMonto: ${monto}.\n\n${comoPagar}` };
  if (tipo === 'vencida') return { asunto: `Tu plan de Torre venció el ${hasta}`, cuerpo: `El plan de «${v.complejo}» venció el ${hasta}. Tienes ${diasGracia} días de gracia: los módulos siguen activos mientras tanto.\nMonto: ${monto}.\n\n${comoPagar}` };
  return { asunto: 'Se apagaron los módulos de pago de tu condominio', cuerpo: `Pasó la gracia del plan de «${v.complejo}» (venció el ${hasta}), así que los módulos de pago quedaron apagados. Tus datos siguen intactos y todo lo gratis sigue funcionando.\nPara reactivarlos: ${monto}.\n\n${comoPagar}` };
}

/** Un ciclo. Devuelve cuántas suscripciones revisó, cuántos estados guardados cambió y cuántos correos mandó. */
export async function procesarVencimientos(opts: { ahora?: Date; deps?: DepsAvisos } = {}): Promise<ResultadoVencimientos> {
  const ahora = opts.ahora ?? comercialDeps.ahora();
  const [cfg, planes] = await Promise.all([obtenerConfiguracion(), prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } })]);
  const plazos = { dias_gracia: cfg.dias_gracia, dias_aviso_vencimiento: cfg.dias_aviso_vencimiento };
  const subs = await prisma.suscripcionCondominio.findMany({ where: { vigente_hasta: { not: null }, plan_clave: { not: 'cortesia' } }, include: { complejo: { select: { empresa_id: true } } } });
  const r: ResultadoVencimientos = { revisadas: subs.length, estados: 0, correos: 0 };
  for (const s of subs) {
    const ef = estadoEfectivo(s, planes, plazos, ahora);
    if (ef.estado !== s.estado) {
      await prisma.suscripcionCondominio.update({ where: { id: s.id }, data: { estado: ef.estado } });
      invalidarComercial(s.complejo_id);
      r.estados++;
    }
    const vigente = s.vigente_hasta as Date;
    const toca: Aviso[] = [];
    if (ef.estado === 'por_vencer') toca.push('por_vencer');
    if (ef.estado === 'vencida') toca.push('vencida');
    if (ef.apagada) toca.push('apagada');
    // Una prueba de Pro sólo tiene el aviso «por vencer»: al vencer ya es Gratis (sin «vencida» ni «apagada»).
    const avisos = s.es_prueba ? toca.filter((t) => t === 'por_vencer') : toca;
    for (const tipo of avisos) {
      const marca = s[MARCA[tipo]];
      if (marca && marca.getTime() === vigente.getTime()) continue; // ya se avisó de este periodo
      const admins = s.complejo.empresa_id != null ? await prisma.usuario.findMany({ where: { empresa_id: s.complejo.empresa_id, rol: 'admin', correo_verificado: true }, select: { email: true } }) : [];
      const { asunto, cuerpo } = await cuerpoAviso(tipo, s.complejo_id, vigente, cfg.dias_gracia, ahora, s.es_prueba);
      let fallo = false;
      for (const a of admins) {
        const e = await correoA(a.email, asunto, cuerpo, opts.deps);
        if (e.resultado === 'ok') r.correos++;
        else if (e.resultado === 'fallo') fallo = true;
      }
      // Un fallo de red se reintenta en el siguiente ciclo; «omitida» (correo sin configurar o sin destinatarios) no se reintenta cada 15 min.
      if (!fallo) await prisma.suscripcionCondominio.update({ where: { id: s.id }, data: { [MARCA[tipo]]: vigente } });
    }
  }
  // El plazo de Gratis tiene sus propios avisos (al aplicarse, 7 días antes y el día que vence), fuera de las suscripciones de pago.
  r.correos += await procesarAvisosGratis({ ahora, deps: opts.deps, plazos, diasGratis: cfg.dias_gratis });
  return r;
}
