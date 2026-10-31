import { Link } from 'react-router-dom';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../../auth/AuthContext';
import { cx } from '../../../ui';
import { MODULO_NOMBRE, type ModuloClave } from './comercial';

/**
 * Aviso discreto «Disponible en el plan Pro» donde una función apagada se nota (IA, WhatsApp, asistente, mora automática, reportes). Quien administra va a Mi plan; el resto, a pedirlo.
 * `variante="voucher"`: el aviso de la validación de un voucher sin la IA (Gratis o Básico), en lugar de «Aún no se evaluó». Quien administra pasa a Torre Pro desde Mi plan.
 */
export function AvisoModulo({ modulo, className, variante = 'modulo' }: { modulo: ModuloClave; className?: string; variante?: 'modulo' | 'voucher' }) {
  const { user } = useAuth();
  if (variante === 'voucher') return <AvisoVoucher rol={user?.rol} className={className} />;
  const enlace = user?.rol === 'admin' ? '/admin/mi-plan' : user?.rol === 'superadmin' ? '/superadmin/suscripciones' : null;
  return (
    <p role="note" className={cx('flex items-start gap-2 rounded bg-brand-soft px-3 py-2 text-sm text-brand', className)}>
      <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Disponible en el plan Torre Pro: «{MODULO_NOMBRE[modulo]}».{' '}
        {enlace ? <Link to={enlace} className="font-medium underline">{user?.rol === 'admin' ? 'Verlo en Mi plan' : 'Ver suscripciones'}</Link> : 'Pídeselo a tu administración.'}
      </span>
    </p>
  );
}

export const TITULO_AVISO_VOUCHER = '¿Quieres que la IA valide este voucher?';
export const TEXTO_AVISO_VOUCHER = 'Con Torre Pro, la IA lee el monto, la fecha y la cuenta de destino, los compara con el recibo y valida sola los que coinciden.';

/** Lo que ve el aviso del voucher según el rol: admin → Mi plan (Pasar a Torre Pro); superadmin → suscripciones; la junta sólo lo pide. */
function AvisoVoucher({ rol, className }: { rol: string | undefined; className?: string }) {
  const enlace = rol === 'admin' ? { to: '/admin/mi-plan', texto: 'Pasar a Torre Pro' } : rol === 'superadmin' ? { to: '/superadmin/suscripciones', texto: 'Ver suscripciones' } : null;
  return (
    <div role="note" className={cx('flex items-start gap-2 rounded bg-brand-soft px-3 py-2 text-sm text-brand', className)}>
      <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{TITULO_AVISO_VOUCHER}</p>
        <p className="mt-0.5">{TEXTO_AVISO_VOUCHER}</p>
        <p className="mt-1">{enlace ? <Link to={enlace.to} className="font-medium underline">{enlace.texto}</Link> : 'Pídeselo a tu administración.'}</p>
      </div>
    </div>
  );
}
