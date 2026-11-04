// Qué pagos cuentan. UN pago anulado (ya validado y luego anulado por la administración) y uno rechazado NO cuentan en nada: ni cobrado, ni deuda pagada,
// ni rendición, ni cierre, ni conciliación, ni mora, ni el estado de cuenta, ni el asistente. Toda cuenta de «pagos que reclaman el cargo» pasa por aquí;
// nunca se escribe «todo lo que no es rechazado»: un estado nuevo (como `anulado`) entraría a contar sin que nadie lo decida.
import type { Prisma } from '@prisma/client';

/** Los estados de un pago que SÍ reclaman su monto: uno por validar ya lo reserva y uno validado ya lo cubre. */
export const ESTADOS_VIGENTES = ['por_validar', 'validado'] as const;

/** Filtro de Prisma: sólo pagos vigentes (por validar o validados). */
export const PAGO_VIGENTE: Prisma.PagoWhereInput = { estado_validacion: { in: [...ESTADOS_VIGENTES] } };

/** ¿Este estado de pago cuenta? `rechazado` y `anulado` no. */
export const esPagoVigente = (estado: string): boolean => (ESTADOS_VIGENTES as readonly string[]).includes(estado);
