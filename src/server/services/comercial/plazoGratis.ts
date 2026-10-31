// El plazo del plan Gratis: de dónde sale `gratis_hasta` y los avisos al administrador (al aplicarse el plazo a los condominios que ya estaban en Gratis,
// 7 días antes y el día que vence). Idempotente por condominio y fecha: cada aviso queda anotado con el `gratis_hasta` al que corresponde, igual que
// `aviso_por_vencer_para`; si el plazo cambia (otro `gratis_hasta`), los avisos vuelven a tocar. Sólo correo.
import type { ConfiguracionComercial } from '@prisma/client';
import { prisma } from '../../db';
import { diasEntre, hoyLima } from '../../lib/fechas';
import { formatoDinero } from '../../../lib/paises';
import type { DepsAvisos } from '../avisos/canales';
import { fechaTexto } from '../avisos/plantillas';
import { correoA } from './configuracion';
import { estadoEfectivo, finDePrueba, primerDiaSoloLectura } from './estado';

export const DIAS_AVISO_GRATIS = 7;

/** «3 meses» para 90 días, «1 mes» para 30, «45 días» para lo que no es múltiplo de 30. */
export function duracionTexto(dias: number): string {
  if (dias > 0 && dias % 30 === 0) return dias === 30 ? '1 mes' : `${dias / 30} meses`;
  return `${dias} día${dias === 1 ? '' : 's'}`;
}

/**
 * Lo que lleva la suscripción de un condominio que nace en Gratis: `gratis_hasta` = hoy (Lima) + `dias_gratis`. Sin plazo (null o 0) no lleva nada.
 * Nace con el aviso de inicio ya dado por hecho: el aviso «desde hoy Gratis dura N meses» es sólo para quien ya estaba en Gratis.
 */
export function plazoGratisNuevo(cfg: Pick<ConfiguracionComercial, 'dias_gratis'>, ahora: Date): { gratis_hasta?: Date; aviso_gratis_inicio_para?: Date } {
  if (!cfg.dias_gratis || cfg.dias_gratis <= 0) return {};
  const fin = finDePrueba(cfg.dias_gratis, ahora);
  return { gratis_hasta: fin, aviso_gratis_inicio_para: fin };
}

type Aviso = 'inicio' | 'siete_dias' | 'vence';
const MARCA = { inicio: 'aviso_gratis_inicio_para', siete_dias: 'aviso_gratis_7d_para', vence: 'aviso_gratis_vence_para' } as const;

/** Lo menos que paga un condominio de `unidades` departamentos con Básico («S/ 20»), o null si no cabe en su tope o el plan no se ofrece. */
export async function basicoDesde(unidades: number): Promise<string | null> {
  const basico = await prisma.planComercial.findUnique({ where: { clave: 'basico' } });
  if (!basico || !basico.visible || (basico.unidades_maximas != null && unidades > basico.unidades_maximas)) return null;
  return formatoDinero(basico.precio_por_unidad.times(basico.unidades_minimas ?? 0), 'PEN', ' ', true);
}

/** «Básico desde S/ 20 al mes o Pro»: lo que se ofrece al terminar Gratis. */
const ofertaDePago = async (unidades: number): Promise<string> => {
  const desde = await basicoDesde(unidades);
  return desde ? `Básico desde ${desde} al mes o Pro` : 'Pro';
};

const cuerpoAviso = (tipo: Aviso, condominio: string, fin: Date, cfgDias: number | null, oferta: string, dias: number): { asunto: string; cuerpo: string } => {
  const ultimo = fechaTexto(fin);
  const desde = fechaTexto(primerDiaSoloLectura(fin));
  const cierre = `Para seguir registrando, elige un plan desde Mi plan: ${oferta}. Tus datos no se borran.`;
  if (tipo === 'inicio') return { asunto: `Gratis ahora dura ${duracionTexto(cfgDias ?? 90)}: elige tu plan antes de que termine`, cuerpo: `Desde hoy, Gratis dura ${duracionTexto(cfgDias ?? 90)}: «${condominio}» pasa a solo lectura el ${desde} si no eliges un plan. Hasta entonces todo sigue igual.\n\n${cierre}` };
  if (tipo === 'siete_dias') return { asunto: `A «${condominio}» le quedan ${dias} ${dias === 1 ? 'día' : 'días'} gratis`, cuerpo: `El periodo gratis de «${condominio}» termina el ${ultimo}. Desde el ${desde} pasa a solo lectura: se puede ver todo, pero no registrar recibos, pagos ni comunicados.\n\n${cierre}` };
  return { asunto: `Hoy termina el periodo gratis de «${condominio}»`, cuerpo: `Hoy es el último día gratis de «${condominio}». Desde mañana (${desde}) pasa a solo lectura: se puede ver todo, pero no registrar recibos, pagos ni comunicados.\n\n${cierre}` };
};

/**
 * Un ciclo de avisos del plazo de Gratis. Sólo avisa a los condominios que hoy cuentan como Gratis (o están en la prueba de Pro, que va dentro del plazo)
 * y aún no vencieron: un plan de pago vigente, la cortesía o un condominio ya en solo lectura no reciben nada. Devuelve cuántos correos salieron.
 */
export async function procesarAvisosGratis(opts: { ahora: Date; deps?: DepsAvisos; plazos: { dias_gracia: number; dias_aviso_vencimiento: number }; diasGratis: number | null }): Promise<number> {
  const { ahora, deps, plazos } = opts;
  const planes = await prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } });
  const subs = await prisma.suscripcionCondominio.findMany({
    where: { gratis_hasta: { not: null }, plan_clave: { not: 'cortesia' } },
    include: { complejo: { select: { nombre: true, empresa_id: true } } },
  });
  let correos = 0;
  for (const s of subs) {
    const fin = s.gratis_hasta as Date;
    const ef = estadoEfectivo(s, planes, plazos, ahora);
    const aplica = !ef.solo_lectura && (ef.plan_clave === 'gratis' || ef.apagada || ef.en_prueba);
    if (!aplica) continue;
    const dias = diasEntre(hoyLima(ahora), fin);
    const toca: Aviso[] = ['inicio'];
    if (dias === 0) toca.push('vence');
    else if (dias <= DIAS_AVISO_GRATIS) toca.push('siete_dias');
    const pendientes = toca.filter((t) => s[MARCA[t]]?.getTime() !== fin.getTime());
    if (!pendientes.length) continue;
    const admins = s.complejo.empresa_id != null ? await prisma.usuario.findMany({ where: { empresa_id: s.complejo.empresa_id, rol: 'admin', correo_verificado: true }, select: { email: true } }) : [];
    const unidades = await prisma.unidad.count({ where: { complejo_id: s.complejo_id } });
    const oferta = await ofertaDePago(unidades);
    for (const tipo of pendientes) {
      const { asunto, cuerpo } = cuerpoAviso(tipo, s.complejo.nombre, fin, opts.diasGratis, oferta, dias);
      let fallo = false;
      for (const a of admins) {
        const e = await correoA(a.email, asunto, cuerpo, deps);
        if (e.resultado === 'ok') correos++;
        else if (e.resultado === 'fallo') fallo = true;
      }
      // Un fallo de red se reintenta en el siguiente ciclo; «omitida» (correo sin configurar o sin destinatarios) no se reintenta cada 15 min.
      if (!fallo) await prisma.suscripcionCondominio.update({ where: { id: s.id }, data: { [MARCA[tipo]]: fin } });
    }
  }
  return correos;
}
