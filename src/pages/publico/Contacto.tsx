import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircleIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../api';
import { Alert, Button, Card, CardBody, Input, Textarea, TelefonoInput } from '../../ui';
import { IconoWhatsapp } from '../../ui/IconoWhatsapp';
import { useCatalogo } from './catalogo';
import { CONTACTO } from './contacto/textos';
import { useDatosLegales } from './legal/datos';
import { Marco } from './Marco';

interface Formulario { nombre: string; correo: string; celular: string; condominio: string; unidades: string; varios: 'si' | 'no'; mensaje: string }
const VACIO: Formulario = { nombre: '', correo: '', celular: '', condominio: '', unidades: '', varios: 'no', mensaje: '' };
const MAX_MENSAJE = 2000;

/**
 * «Habla con nosotros» (`/contacto`): formulario para quien llega desde un reel, un anuncio o el buscador, y al lado el WhatsApp, el correo y las redes de Torre
 * (todos de la configuración). Con `?tema=demo` (el botón «Solicita una demo») el mensaje queda marcado como pedido de demo.
 */
export default function Contacto() {
  const [params] = useSearchParams();
  const demo = params.get('tema') === 'demo';
  const { data: cat } = useCatalogo();
  const { datos } = useDatosLegales();
  const redes = cat?.redes;
  const [f, setF] = useState<Formulario>(VACIO);
  const [señuelo, setSeñuelo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listo, setListo] = useState<string | null>(null);
  const campo = (k: keyof Formulario) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });
  const completo = f.nombre.trim() !== '' && f.correo.trim() !== '' && f.mensaje.trim().length >= 5;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const unidades = f.unidades.trim() === '' ? null : Number(f.unidades);
      const r = await api<{ mensaje: string }>('/api/publico/contacto', {
        method: 'POST',
        json: {
          nombre: f.nombre.trim(), correo: f.correo.trim(), celular: f.celular.trim() === '' ? null : f.celular, condominio: f.condominio.trim() === '' ? null : f.condominio.trim(),
          unidades, varios_condominios: f.varios === 'si', mensaje: f.mensaje.trim(), tema: demo ? 'demo' : 'consulta', sitio_web: señuelo,
        },
      });
      setListo(r.mensaje);
    } catch (err) {
      setError(errorText(err));
    } finally { setBusy(false); }
  }

  if (listo) {
    return (
      <Marco ancho="max-w-xl">
        <Card>
          <CardBody className="text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok"><CheckCircleIcon className="h-6 w-6" aria-hidden="true" /></span>
            <h1 className="mt-4 text-xl font-semibold">Mensaje enviado</h1>
            <p className="mt-2 text-sm text-muted" role="status">{listo}</p>
            {redes?.whatsapp && <p className="mt-4 text-sm">¿Es urgente? <a href={redes.whatsapp.enlace} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">Escríbenos por WhatsApp</a>.</p>}
            <p className="mt-6 text-sm"><Link to="/" className="font-medium text-brand underline">Volver al inicio</Link></p>
          </CardBody>
        </Card>
      </Marco>
    );
  }

  return (
    <Marco>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-14">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{CONTACTO.h1}</h1>
          <p className="mt-2 text-sm text-muted">{CONTACTO.bajada}</p>
          {demo && <p className="mt-4 rounded-lg bg-brand-soft px-4 py-3 text-sm font-medium text-brand" role="note">{CONTACTO.demo}</p>}
          <form onSubmit={enviar} className="mt-8 space-y-4" noValidate>
            {error && <Alert tone="bad">{error}</Alert>}
            <Input label="Tu nombre" autoComplete="name" maxLength={120} required {...campo('nombre')} />
            <Input label="Correo electrónico" type="email" autoComplete="email" maxLength={160} required {...campo('correo')} />
            <TelefonoInput label="Celular (opcional)" value={f.celular} onChange={celular => setF(x => ({ ...x, celular }))} />
            <Input label="Nombre del condominio (opcional)" maxLength={120} {...campo('condominio')} />
            <Input label="Número de departamentos (opcional)" type="number" inputMode="numeric" min={1} max={100000} {...campo('unidades')} />
            <fieldset>
              <legend className="text-sm font-medium">¿Administras varios condominios?</legend>
              <div className="mt-2 flex gap-6 text-sm">
                {(['no', 'si'] as const).map(v => (
                  <label key={v} className="flex items-center gap-2"><input type="radio" name="varios" value={v} checked={f.varios === v} onChange={() => setF(x => ({ ...x, varios: v }))} className="h-4 w-4 accent-[oklch(var(--brand))]" />{v === 'si' ? 'Sí' : 'No'}</label>
                ))}
              </div>
            </fieldset>
            <Textarea label="Mensaje" rows={5} maxLength={MAX_MENSAJE} required hint={`${f.mensaje.length} de ${MAX_MENSAJE} caracteres`} {...campo('mensaje')} />

            {/* Señuelo antiabuso: ninguna persona lo ve ni lo llena; un robot sí. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Sitio web<input type="text" tabIndex={-1} autoComplete="off" value={señuelo} onChange={e => setSeñuelo(e.target.value)} /></label>
            </div>
            <Button type="submit" loading={busy} disabled={!completo} className="w-full sm:w-auto">Enviar</Button>
            <p className="text-xs text-muted">Usamos tus datos sólo para responderte. Mira la <Link to="/privacidad" className="font-medium text-brand underline">Política de privacidad</Link>.</p>
          </form>
        </div>

        <aside aria-label="Otras formas de contactarnos" className="space-y-4 rounded-xl border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold">¿Prefieres escribirnos directo?</h2>
          {redes?.whatsapp && (
            <a href={redes.whatsapp.enlace} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center gap-2 rounded bg-[#25D366] px-4 text-base font-semibold text-white transition-opacity duration-150 hover:opacity-90">
              <IconoWhatsapp className="h-6 w-6" /> Escríbenos por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          )}
          <ul className="space-y-2 text-sm">
            {datos?.correo && <li><a href={`mailto:${datos.correo}`} className="inline-flex items-center gap-2 font-medium text-brand underline"><EnvelopeIcon className="h-5 w-5" aria-hidden="true" />{datos.correo}</a></li>}
            {redes?.instagram && <li><a href={redes.instagram} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">Instagram<span className="sr-only"> (se abre en otra pestaña)</span></a></li>}
            {redes?.facebook && <li><a href={redes.facebook} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">Facebook<span className="sr-only"> (se abre en otra pestaña)</span></a></li>}
          </ul>
          <p className="text-xs text-muted">Respondemos en menos de 1 día hábil.</p>
        </aside>
      </div>
    </Marco>
  );
}
