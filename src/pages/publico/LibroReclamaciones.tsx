import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenIcon, CheckCircleIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../api';
import { Alert, Button, Card, CardBody, Input, Select, Textarea, TelefonoInput } from '../../ui';
import { LIBRO } from './contacto/textos';
import { useDatosLegales } from './legal/datos';
import { Marco } from './Marco';

const DOCUMENTOS = [['dni', 'DNI'], ['ce', 'Carné de extranjería'], ['pasaporte', 'Pasaporte'], ['ruc', 'RUC']] as const;
const NOMBRE_DOC: Record<string, string> = Object.fromEntries(DOCUMENTOS);

interface Constancia {
  correlativo: string; fecha: string; fecha_limite: string; plazo_dias_habiles: number; tipo: string; mensaje: string;
  proveedor: { razon_social: string; ruc: string; domicilio: string };
  consumidor: { nombre: string; tipo_documento: string; numero_documento: string; domicilio: string; correo: string; telefono: string | null; menor_de_edad: boolean; apoderado_nombre: string | null };
  bien: { tipo: string; descripcion: string; monto_reclamado: string | null };
  detalle: string; pedido: string;
}

interface Formulario {
  nombre: string; tipo_documento: string; numero_documento: string; domicilio: string; correo: string; telefono: string;
  menor_de_edad: boolean; apoderado_nombre: string; apoderado_tipo_documento: string; apoderado_numero_documento: string;
  bien_tipo: 'servicio' | 'producto'; bien_descripcion: string; monto_reclamado: string;
  tipo: 'reclamo' | 'queja'; detalle: string; pedido: string; acepta: boolean;
}
const VACIO: Formulario = {
  nombre: '', tipo_documento: 'dni', numero_documento: '', domicilio: '', correo: '', telefono: '',
  menor_de_edad: false, apoderado_nombre: '', apoderado_tipo_documento: 'dni', apoderado_numero_documento: '',
  bien_tipo: 'servicio', bien_descripcion: '', monto_reclamado: '', tipo: 'reclamo', detalle: '', pedido: '', acepta: false,
};

/** `2026-11-04` → `04/11/2026` (sin pasar por `Date`: no hay desfase de zona horaria). */
const fechaLarga = (iso: string) => iso.split('-').reverse().join('/');
const hoyEnLima = () => new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

/** Una fila «etiqueta: valor» de la constancia. */
const Fila = ({ k, v }: { k: string; v: string }) => <div className="grid gap-0.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-3"><dt className="text-muted">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>;

/**
 * Libro de Reclamaciones virtual (Ley N.º 29571, Código de Protección y Defensa del Consumidor, y D.S. N.º 011-2011-PCM): la hoja de reclamación completa,
 * con los datos del proveedor leídos de la configuración legal. Al enviar se muestra la constancia con el número correlativo y se manda una copia al correo.
 */
export default function LibroReclamaciones() {
  const { datos } = useDatosLegales();
  const [f, setF] = useState<Formulario>(VACIO);
  const [señuelo, setSeñuelo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [constancia, setConstancia] = useState<Constancia | null>(null);
  const campo = (k: keyof Formulario) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });
  const completo = [f.nombre, f.numero_documento, f.domicilio, f.correo, f.bien_descripcion, f.detalle, f.pedido].every(v => v.trim() !== '')
    && f.acepta && (!f.menor_de_edad || (f.apoderado_nombre.trim() !== '' && f.apoderado_numero_documento.trim() !== ''));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const vacioANull = (v: string) => (v.trim() === '' ? null : v.trim());
      const r = await api<Constancia>('/api/publico/reclamaciones', {
        method: 'POST',
        json: {
          nombre: f.nombre.trim(), tipo_documento: f.tipo_documento, numero_documento: f.numero_documento.trim(), domicilio: f.domicilio.trim(), correo: f.correo.trim(), telefono: f.telefono.trim() === '' ? null : f.telefono,
          menor_de_edad: f.menor_de_edad,
          ...(f.menor_de_edad ? { apoderado_nombre: vacioANull(f.apoderado_nombre), apoderado_tipo_documento: f.apoderado_tipo_documento, apoderado_numero_documento: vacioANull(f.apoderado_numero_documento) } : {}),
          bien_tipo: f.bien_tipo, bien_descripcion: f.bien_descripcion.trim(), monto_reclamado: vacioANull(f.monto_reclamado),
          tipo: f.tipo, detalle: f.detalle.trim(), pedido: f.pedido.trim(), acepta_respuesta_correo: f.acepta, sitio_web: señuelo,
        },
      });
      setConstancia(r);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(errorText(err));
    } finally { setBusy(false); }
  }

  if (constancia) {
    const c = constancia;
    return (
      <Marco ancho="max-w-3xl">
        <Card>
          <CardBody>
            <div className="text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok"><CheckCircleIcon className="h-6 w-6" aria-hidden="true" /></span>
              <h1 className="mt-4 text-xl font-semibold">Registramos tu {c.tipo}</h1>
              <p className="mt-3 text-sm text-muted">Número de hoja de reclamación</p>
              <p className="num text-3xl font-semibold tracking-tight" role="status">{c.correlativo}</p>
              <p className="mt-3 text-sm">{c.mensaje}</p>
              <p className="mt-1 text-xs text-muted">Plazo: {c.plazo_dias_habiles} días hábiles desde el registro (no cuentan sábados ni domingos). Te enviamos una copia a tu correo; guarda este número.</p>
            </div>
            <h2 className="mt-8 border-t border-line pt-6 text-base font-semibold">Constancia</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Fila k="Fecha" v={fechaLarga(c.fecha)} />
              <Fila k="Proveedor" v={`${c.proveedor.razon_social} · RUC ${c.proveedor.ruc}`} />
              <Fila k="Domicilio del proveedor" v={c.proveedor.domicilio} />
              <Fila k="Consumidor" v={c.consumidor.nombre} />
              <Fila k="Documento" v={`${NOMBRE_DOC[c.consumidor.tipo_documento] ?? c.consumidor.tipo_documento} ${c.consumidor.numero_documento}`} />
              <Fila k="Domicilio" v={c.consumidor.domicilio} />
              <Fila k="Correo" v={c.consumidor.correo} />
              {c.consumidor.menor_de_edad && c.consumidor.apoderado_nombre && <Fila k="Padre, madre o apoderado" v={c.consumidor.apoderado_nombre} />}
              <Fila k="Bien contratado" v={`${c.bien.tipo === 'producto' ? 'Producto' : 'Servicio'}: ${c.bien.descripcion}`} />
              {c.bien.monto_reclamado && <Fila k="Monto reclamado" v={`S/ ${c.bien.monto_reclamado}`} />}
              <Fila k="Tipo" v={c.tipo === 'queja' ? 'Queja' : 'Reclamo'} />
              <Fila k="Detalle" v={c.detalle} />
              <Fila k="Pedido del consumidor" v={c.pedido} />
              <Fila k="Responderemos antes del" v={fechaLarga(c.fecha_limite)} />
            </dl>
            <p className="mt-6 text-xs text-muted">{LIBRO.indecopi}</p>
            <div className="mt-6 flex flex-wrap gap-3 print:hidden">
              <Button variant="secondary" onClick={() => window.print()}><PrinterIcon className="h-5 w-5" aria-hidden="true" /> Imprimir o guardar como PDF</Button>
              <Link to="/" className="inline-flex h-10 items-center text-sm font-medium text-brand underline">Volver al inicio</Link>
            </div>
          </CardBody>
        </Card>
      </Marco>
    );
  }

  return (
    <Marco ancho="max-w-3xl">
      <h1 className="flex items-center gap-3 text-2xl font-semibold sm:text-3xl"><BookOpenIcon className="h-8 w-8 shrink-0 text-brand" aria-hidden="true" />{LIBRO.h1}</h1>
      <p className="mt-3 text-sm text-muted">{LIBRO.bajada}</p>
      <p className="mt-2 text-xs text-muted">{LIBRO.base_legal}</p>

      <section aria-labelledby="proveedor-titulo" className="mt-6 rounded-lg border border-line bg-surface2 p-4 text-sm">
        <h2 id="proveedor-titulo" className="font-semibold">Proveedor</h2>
        {datos?.razon_social
          ? <p className="mt-1">{datos.razon_social}{datos.ruc ? ` · RUC ${datos.ruc}` : ''}{datos.domicilio ? ` · ${datos.domicilio}` : ''}</p>
          : <p className="mt-1 text-muted">Torre</p>}
        <dl className="mt-3 space-y-1 text-xs text-muted">
          <div><dt className="inline font-semibold text-ink">Reclamo:</dt> <dd className="inline">{LIBRO.reclamo}</dd></div>
          <div><dt className="inline font-semibold text-ink">Queja:</dt> <dd className="inline">{LIBRO.queja}</dd></div>
        </dl>
      </section>

      <form onSubmit={enviar} className="mt-8 space-y-8" noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <p className="text-sm text-muted">Fecha: <span className="num font-medium text-ink">{hoyEnLima()}</span> · El número de hoja se asigna al enviar (por ejemplo, <span className="num">{new Date().getFullYear()}-000001</span>).</p>

        <fieldset className="min-w-0 space-y-4">
          <legend className="text-base font-semibold">1. Identificación del consumidor reclamante</legend>
          <Input label="Nombre completo" autoComplete="name" maxLength={160} required {...campo('nombre')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Tipo de documento" {...campo('tipo_documento')}>{DOCUMENTOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</Select>
            <Input label="Número de documento" maxLength={20} required {...campo('numero_documento')} />
          </div>
          <Input label="Domicilio" autoComplete="street-address" maxLength={255} required {...campo('domicilio')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Correo electrónico" type="email" autoComplete="email" maxLength={160} required hint="Aquí te enviamos la copia y la respuesta." {...campo('correo')} />
            <TelefonoInput label="Teléfono (opcional)" value={f.telefono} onChange={telefono => setF(x => ({ ...x, telefono }))} />
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={f.menor_de_edad} onChange={e => setF(x => ({ ...x, menor_de_edad: e.target.checked }))} className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(var(--brand))]" />
            <span>El consumidor es menor de edad (presenta la hoja su padre, madre o apoderado)</span>
          </label>
          {f.menor_de_edad && (
            <div className="space-y-4 rounded-lg border border-line p-4">
              <Input label="Nombre del padre, madre o apoderado" maxLength={160} required {...campo('apoderado_nombre')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select label="Tipo de documento" {...campo('apoderado_tipo_documento')}>{DOCUMENTOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</Select>
                <Input label="Número de documento" maxLength={20} required {...campo('apoderado_numero_documento')} />
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="min-w-0 space-y-4">
          <legend className="text-base font-semibold">2. Identificación del bien contratado</legend>
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Select label="Es un" {...campo('bien_tipo')}><option value="servicio">Servicio</option><option value="producto">Producto</option></Select>
            <Input label="Descripción (p. ej. suscripción a Torre Pro)" maxLength={300} required {...campo('bien_descripcion')} />
          </div>
          <Input label="Monto reclamado en soles (opcional)" inputMode="decimal" maxLength={13} placeholder="0.00" {...campo('monto_reclamado')} />
        </fieldset>

        <fieldset className="min-w-0 space-y-4">
          <legend className="text-base font-semibold">3. Detalle de la reclamación y pedido del consumidor</legend>
          <div role="radiogroup" aria-label="Tipo" className="space-y-2 text-sm">
            {(['reclamo', 'queja'] as const).map(t => (
              <label key={t} className="flex items-start gap-2.5">
                <input type="radio" name="tipo" value={t} checked={f.tipo === t} onChange={() => setF(x => ({ ...x, tipo: t }))} className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(var(--brand))]" />
                <span><span className="font-medium">{t === 'reclamo' ? 'Reclamo' : 'Queja'}</span><span className="block text-xs text-muted">{LIBRO[t]}</span></span>
              </label>
            ))}
          </div>
          <Textarea label="Detalle" rows={5} maxLength={3000} required hint="Cuéntanos qué pasó, cuándo y con quién hablaste." {...campo('detalle')} />
          <Textarea label="Pedido del consumidor" rows={3} maxLength={2000} required hint="Qué solución esperas." {...campo('pedido')} />
        </fieldset>

        {/* Señuelo antiabuso: ninguna persona lo ve ni lo llena; un robot sí. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Sitio web<input type="text" tabIndex={-1} autoComplete="off" value={señuelo} onChange={e => setSeñuelo(e.target.value)} /></label>
        </div>

        <div className="space-y-4">
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={f.acepta} onChange={e => setF(x => ({ ...x, acepta: e.target.checked }))} required className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(var(--brand))]" />
            <span>Acepto que la respuesta a mi reclamación se envíe a mi correo electrónico.</span>
          </label>
          <p className="text-xs text-muted">{LIBRO.plazo} {LIBRO.indecopi}</p>
          <Button type="submit" loading={busy} disabled={!completo} className="w-full sm:w-auto">Enviar hoja de reclamación</Button>
          <p className="text-xs text-muted">Tus datos se usan sólo para atender esta hoja. Mira la <Link to="/privacidad" className="font-medium text-brand underline">Política de privacidad</Link>.</p>
        </div>
      </form>
    </Marco>
  );
}
