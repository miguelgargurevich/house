import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SwatchIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { useAuth } from '../../../../auth/AuthContext';
import { Alert, Button, Input, useToast } from '../../../../ui';
import { ImagenEditable } from '../condominio/ImagenEditable';
import { VistaPrevia } from './VistaPrevia';
import { AVISO_AJUSTADO, AVISO_SIN_PLAN, MAX_NOMBRE_COMERCIAL, colorDelSelector, cuerpoDeMarca, errorDeColor, formDeEmpresa, hayCambios, normalizarHex, paletaDeForm, type FormMarca } from './vista';
import { useModoOscuro } from './useModoOscuro';

export interface EmpresaMarca {
  id: number;
  /** Razón social. */
  nombre: string;
  nombre_comercial?: string | null;
  color_marca?: string | null;
  logo_url?: string | null;
  /** La empresa tiene la capacidad «Marca propia» (plan Torre Administradora). */
  marca_activa?: boolean;
}

interface Props {
  empresa: EmpresaMarca;
  /** Recarga la empresa tras guardar o cambiar el logo. */
  onCambio: () => void;
  /** Superadmin: edita la marca de otra empresa (el aviso del plan no manda a «Mi plan»). */
  comoSuperadmin?: boolean;
}

/**
 * «Tu marca»: logo, nombre comercial y color de la empresa, con vista previa en vivo. El logo va en todos los planes; el nombre y el color se guardan siempre
 * pero sólo se ven con el plan Torre Administradora (la empresa puede prepararlos antes).
 */
export function SeccionMarca({ empresa, onCambio, comoSuperadmin = false }: Props) {
  const toast = useToast();
  const { user, refresh } = useAuth();
  const [form, setForm] = useState<FormMarca>(() => formDeEmpresa(empresa));
  const [guardando, setGuardando] = useState(false);
  const oscuro = useModoOscuro();
  const errorColor = errorDeColor(form.color);
  const paleta = paletaDeForm(errorColor ? '' : form.color);
  const nombreVisible = form.nombre.trim() || empresa.nombre;
  const sinCambios = !hayCambios(form, empresa);

  async function guardar() {
    if (errorColor) return;
    setGuardando(true);
    try {
      await api(`/api/empresas/${empresa.id}`, { method: 'PUT', json: cuerpoDeMarca(form) });
      toast.ok('Tu marca quedó guardada');
      onCambio();
      if (user?.empresa_id === empresa.id) await refresh(); // la app toma el color y el nombre al instante
    } catch (e) { toast.error(errorText(e)); } finally { setGuardando(false); }
  }

  return (
    <section aria-labelledby="tu-marca" className="mt-6 border-t border-line pt-5">
      <h3 id="tu-marca" className="mb-1 flex items-center gap-2 text-sm font-semibold"><SwatchIcon className="h-4 w-4 text-muted" aria-hidden="true" />Tu marca</h3>
      <p className="mb-4 text-sm text-muted">Tu logo, el nombre con el que te presentas y tu color salen en el menú de la app, en el recibo, en el estado de cuenta y en los correos que reciben tus vecinos.</p>

      {!empresa.marca_activa && (
        <div className="mb-4">
          <Alert tone="info">
            <p className="font-medium">{AVISO_SIN_PLAN}</p>
            <p className="mt-1">
              {comoSuperadmin ? 'Esta empresa usa el verde de Torre y su razón social hasta que tenga ese plan. ' : 'Mientras tanto Torre se ve con su verde y tu razón social. Puedes dejarla lista: se activa sola cuando pases de plan. '}
              {!comoSuperadmin && <Link to="/admin/mi-plan" className="font-medium underline">Ver Mi plan</Link>}
            </p>
          </Alert>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <ImagenEditable titulo="Logo" ayuda="Sale en el menú, el recibo y los correos. JPG, PNG o WebP, hasta 2 MB. Va en todos los planes." url={empresa.logo_url ?? null} ruta={`/api/empresas/${empresa.id}/logo`} onCambio={() => { onCambio(); if (user?.empresa_id === empresa.id) void refresh(); }} />

          <Input
            label="Nombre comercial"
            value={form.nombre}
            maxLength={MAX_NOMBRE_COMERCIAL}
            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
            hint={`Si lo dejas vacío usamos tu razón social: ${empresa.nombre}. Hasta ${MAX_NOMBRE_COMERCIAL} caracteres.`}
          />

          <div>
            <p className="mb-1.5 text-sm font-medium" id="color-marca-etiqueta">Color</p>
            <div className="flex flex-wrap items-start gap-3">
              <input
                type="color"
                aria-labelledby="color-marca-etiqueta"
                value={colorDelSelector(form.color)}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="h-10 w-14 shrink-0 cursor-pointer rounded border border-line bg-surface p-1"
              />
              <Input
                label="Código del color"
                ocultarEtiqueta
                className="w-36"
                value={form.color}
                placeholder="#007565"
                maxLength={7}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                onBlur={() => setForm(f => ({ ...f, color: normalizarHex(f.color) ?? f.color }))}
                error={errorColor ?? undefined}
              />
              <Button variant="secondary" disabled={form.color.trim() === ''} onClick={() => setForm(f => ({ ...f, color: '' }))}>Volver al verde de Torre</Button>
            </div>
            <p className="mt-1.5 text-xs text-muted">{form.color.trim() === '' ? 'Ahora usas el verde de Torre.' : 'Elige el color con el selector o escribe su código.'}</p>
            {!errorColor && paleta.ajustado && <div className="mt-3"><Alert tone="warn">{AVISO_AJUSTADO}</Alert></div>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button loading={guardando} disabled={sinCambios || !!errorColor} onClick={() => void guardar()}>Guardar mi marca</Button>
            {!sinCambios && <Button variant="ghost" onClick={() => setForm(formDeEmpresa(empresa))}>Descartar cambios</Button>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Así se verá</p>
          <VistaPrevia paleta={paleta} nombre={nombreVisible} logoUrl={empresa.logo_url ?? null} oscuro={oscuro} />
        </div>
      </div>
    </section>
  );
}
