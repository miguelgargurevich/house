import { canalesDeps } from './deps';

const QUINCE_MIN = 15 * 60_000;
const TOPE_CLAVES = 5000;

/** Ventana deslizante en memoria del proceso (igual que el resto de limitadores): cuenta eventos por clave en los últimos `ms`. */
export class Ventana {
  private readonly claves = new Map<string, number[]>();
  private readonly max: number;
  private readonly ms: number;

  constructor(max: number, ms = QUINCE_MIN) {
    this.max = max;
    this.ms = ms;
  }

  private vigentes(clave: string, t: number): number[] {
    const v = (this.claves.get(clave) ?? []).filter((x) => t - x < this.ms);
    if (v.length) this.claves.set(clave, v);
    else this.claves.delete(clave);
    return v;
  }

  /** Anota un evento y devuelve cuántos van en la ventana (contando éste). */
  golpear(clave: string): number {
    const t = canalesDeps.ahora().getTime();
    const v = this.vigentes(clave, t);
    v.push(t);
    this.claves.set(clave, v);
    if (this.claves.size > TOPE_CLAVES) {
      for (const k of this.claves.keys()) {
        if (this.claves.size <= TOPE_CLAVES) break;
        this.claves.delete(k);
      }
    }
    return v.length;
  }

  cuenta(clave: string): number {
    return this.vigentes(clave, canalesDeps.ahora().getTime()).length;
  }

  /** ¿Ya se llegó al tope? (sin anotar nada). */
  llena(clave: string): boolean {
    return this.cuenta(clave) >= this.max;
  }

  get tope(): number {
    return this.max;
  }

  limpiar(): void {
    this.claves.clear();
  }
}

/** Mensajes entrantes por número y por empresa, y turnos de IA por usuario (el mismo tope que el chat web: 20 cada 15 min). */
export const MAX_MENSAJES_NUMERO = 30;
export const MAX_MENSAJES_EMPRESA = 600;
export const MAX_IA_USUARIO = 20;
/** Códigos de vinculación fallidos: más de 5 por número (o 30 por empresa) en 15 min y se rechaza TODO, aun el código bueno. */
export const MAX_FALLOS_NUMERO = 5;
export const MAX_FALLOS_EMPRESA = 30;
/** Bot global (Telegram): un solo cubo para todas las empresas; más holgado para que unos pocos cuentas no puedan trabar la vinculación de todos. */
export const MAX_FALLOS_GLOBAL = 300;

export const limites = {
  mensajesNumero: new Ventana(MAX_MENSAJES_NUMERO),
  mensajesEmpresa: new Ventana(MAX_MENSAJES_EMPRESA),
  iaUsuario: new Ventana(MAX_IA_USUARIO),
  fallosNumero: new Ventana(MAX_FALLOS_NUMERO),
  fallosEmpresa: new Ventana(MAX_FALLOS_EMPRESA),
  fallosGlobal: new Ventana(MAX_FALLOS_GLOBAL),
  codigosUsuario: new Ventana(5),
  webhookFallosIp: new Ventana(30),
};

/** Sólo pruebas. */
export const limpiarLimites = () => { for (const v of Object.values(limites)) v.limpiar(); };
