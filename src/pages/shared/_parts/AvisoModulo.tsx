import { Link } from 'react-router-dom';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../../auth/AuthContext';
import { cx } from '../../../ui';
import { MODULO_NOMBRE, type ModuloClave } from './comercial';

/** Aviso discreto «Disponible en el plan Pro» donde una función apagada se nota (IA, WhatsApp, asistente, mora automática, reportes). Quien administra va a Mi plan; el resto, a pedirlo. */
export function AvisoModulo({ modulo, className }: { modulo: ModuloClave; className?: string }) {
  const { user } = useAuth();
  const enlace = user?.rol === 'admin' ? '/admin/mi-plan' : user?.rol === 'superadmin' ? '/superadmin/suscripciones' : null;
  return (
    <p role="note" className={cx('flex items-start gap-2 rounded bg-brand-soft px-3 py-2 text-sm text-brand', className)}>
      <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Disponible en el plan Pro: «{MODULO_NOMBRE[modulo]}».{' '}
        {enlace ? <Link to={enlace} className="font-medium underline">{user?.rol === 'admin' ? 'Verlo en Mi plan' : 'Ver suscripciones'}</Link> : 'Pídeselo a tu administración.'}
      </span>
    </p>
  );
}
