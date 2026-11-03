import { useEffect, useState } from 'react';
import { ArrowUpOnSquareIcon, DevicePhoneMobileIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button, IconButton } from '../ui';
import { alCambiar, avisoGuardado, descartar, estaInstalada, fueDescartado, instalar, modoInstalar } from './instalar';

/** Aviso «Instala Torre en tu celular», sólo en pantallas chicas y mientras no esté instalada ni descartada. */
export function InstalarApp() {
  const [, setVuelta] = useState(0);
  useEffect(() => alCambiar(() => setVuelta(v => v + 1)), []);
  const modo = modoInstalar({ instalada: estaInstalada(), descartado: fueDescartado(), hayAviso: !!avisoGuardado(), userAgent: navigator.userAgent });
  if (!modo) return null;

  return (
    <div role="region" aria-label="Instalar Torre" className="mb-5 flex items-start gap-3 rounded-lg bg-brand-soft p-4 lg:hidden">
      <DevicePhoneMobileIcon className="mt-0.5 h-6 w-6 shrink-0 text-brand" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Ten Torre en tu celular</p>
        {modo === 'boton' ? (
          <>
            <p className="mt-1 text-sm">Agrégala a tu pantalla de inicio y ábrela como una app.</p>
            <Button className="mt-3" onClick={() => { void instalar(); }}>Instalar Torre</Button>
          </>
        ) : (
          <p className="mt-1 text-sm">
            Toca <ArrowUpOnSquareIcon className="inline h-4 w-4 align-text-bottom" aria-label="Compartir" /> en Safari y luego «Agregar a inicio».
          </p>
        )}
      </div>
      <IconButton label="Ahora no" onClick={descartar}><XMarkIcon className="h-5 w-5" /></IconButton>
    </div>
  );
}
