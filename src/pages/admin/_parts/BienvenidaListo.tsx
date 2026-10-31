import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Card, CardBody, IconButton } from '../../../ui';
import { IndicadorPasos } from '../../publico/_parts/IndicadorPasos';

/** Los siguientes pasos tras crear el condominio: cada uno lleva a la pantalla donde se hace. */
const SIGUIENTES = [
  { to: '/admin/recibos', titulo: 'Sube el Excel del recibo', texto: 'Con él se arman los recibos de cada block y la cobranza del mes.' },
  { to: '/admin/medios-pago', titulo: 'Agrega tus medios de pago', texto: 'Cuenta bancaria, Yape o Plin: lo que verán tus vecinos para pagar.' },
  { to: '/admin/juntas', titulo: 'Invita a la junta directiva', texto: 'Presidente y tesorero validan pagos y ven la cobranza de su block.' },
] as const;

/** Paso 3 («Listo»): se muestra en el Resumen una vez, justo después de crear el condominio (el nombre llega por el estado de la navegación). */
export function BienvenidaListo({ condominio }: { condominio: string }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <Card className="mb-6">
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <IndicadorPasos actual={3} />
          <IconButton label="Cerrar la bienvenida" onClick={() => setVisible(false)} className="-mr-2 -mt-2 shrink-0"><XMarkIcon className="h-5 w-5" /></IconButton>
        </div>
        <h2 className="mt-4 text-lg font-semibold">¡Listo! Creamos {condominio}</h2>
        <p className="mt-1 text-sm text-muted">Estos son los siguientes pasos para empezar a cobrar con Torre:</p>
        <ul className="mt-4 grid gap-3 md:grid-cols-3">
          {SIGUIENTES.map(s => (
            <li key={s.to}>
              <Link to={s.to} className="group flex h-full flex-col rounded border border-line p-4 transition-colors duration-150 hover:bg-surface2">
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">{s.titulo}<ArrowRightIcon className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" /></span>
                <span className="mt-1 text-xs text-muted">{s.texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
