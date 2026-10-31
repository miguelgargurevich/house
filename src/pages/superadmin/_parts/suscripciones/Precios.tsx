import { useEffect, useState } from 'react';
import { api, errorText, useResource } from '../../../../api';
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Input, Skeleton, Textarea, soles, useToast } from '../../../../ui';
import { MODULO_NOMBRE, type ModuloClave } from '../../../shared/_parts/comercial';
import { ImpuestosYPrecios, type ImpuestoPais, type PrecioMoneda } from './ImpuestosPais';

interface Modulo { clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string; activo: boolean }
interface Plan { clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string; modulos_incluidos: string[]; caracteristicas: string[]; igv_incluido: boolean; visible: boolean; unidades_maximas: number | null; unidades_minimas: number | null; asistente_por_unidad_mes: number | null; whatsapp_por_unidad_mes: number | null }
interface Config {
  igv_tasa: string; dias_gracia: number; dias_aviso_vencimiento: number; correo_superadmin: string | null; url_publica: string | null; registro_abierto: boolean; dias_prueba_pro: number; dias_gratis: number | null;
  pago_titular: string | null; pago_banco: string | null; pago_cuenta: string | null; pago_cci: string | null; pago_yape: string | null; pago_instrucciones: string | null;
  legal_razon_social: string | null; legal_ruc: string | null; legal_domicilio: string | null; legal_correo: string | null;
}
interface Catalogo { planes: Plan[]; modulos: Modulo[]; configuracion: Config; impuestos: ImpuestoPais[]; precios_moneda: PrecioMoneda[] }

/** Precio base → lo que ve el público (base × (1 + tasa)). Sólo para mostrar junto al campo; el servidor es quien lo aplica de verdad. */
const conIgv = (base: string, tasa: string): string => {
  const n = Number(base);
  return Number.isFinite(n) ? soles(Math.round(n * (1 + Number(tasa)) * 100) / 100) : '—';
};

function FilaModulo({ m, tasa, onGuardado }: { m: Modulo; tasa: string; onGuardado: () => void }) {
  const toast = useToast();
  const [precio, setPrecio] = useState(m.precio_por_unidad);
  const [activo, setActivo] = useState(m.activo);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrecio(m.precio_por_unidad); setActivo(m.activo); }, [m]);
  async function guardar() {
    setBusy(true);
    try { await api(`/api/comercial/modulos/${m.clave}`, { method: 'PUT', json: { precio_por_unidad: precio, activo } }); toast.ok(`«${MODULO_NOMBRE[m.clave as ModuloClave] ?? m.nombre}» actualizado`); onGuardado(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <li className="flex flex-wrap items-end gap-3 py-3">
      <div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{m.nombre}</p><p className="text-xs text-muted">Sólo para suscripciones antiguas con este módulo suelto (en soles): <span className="num">{conIgv(precio, tasa)}</span> por depto al mes con IGV</p></div>
      <Input label="Precio base (S/, sin impuesto)" inputMode="decimal" value={precio} onChange={e => setPrecio(e.target.value)} className="w-44" />
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[oklch(var(--brand))]" checked={activo} onChange={e => setActivo(e.target.checked)} />Se muestra en «lo que trae Pro»</label>
      <Button size="sm" loading={busy} onClick={() => void guardar()}>Guardar</Button>
    </li>
  );
}

function FilaPlan({ p, tasa, onGuardado }: { p: Plan; tasa: string; onGuardado: () => void }) {
  const toast = useToast();
  const [precio, setPrecio] = useState(p.precio_por_unidad);
  const [visible, setVisible] = useState(p.visible);
  const [carac, setCarac] = useState(p.caracteristicas.join('\n'));
  const [modulos, setModulos] = useState(p.modulos_incluidos);
  const [maximo, setMaximo] = useState(p.unidades_maximas == null ? '' : String(p.unidades_maximas));
  const [minimo, setMinimo] = useState(p.unidades_minimas == null ? '' : String(p.unidades_minimas));
  const [asistente, setAsistente] = useState(p.asistente_por_unidad_mes == null ? '' : String(p.asistente_por_unidad_mes));
  const [whatsapp, setWhatsapp] = useState(p.whatsapp_por_unidad_mes == null ? '' : String(p.whatsapp_por_unidad_mes));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrecio(p.precio_por_unidad); setVisible(p.visible); setCarac(p.caracteristicas.join('\n')); setModulos(p.modulos_incluidos); setMaximo(p.unidades_maximas == null ? '' : String(p.unidades_maximas)); setMinimo(p.unidades_minimas == null ? '' : String(p.unidades_minimas)); setAsistente(p.asistente_por_unidad_mes == null ? '' : String(p.asistente_por_unidad_mes)); setWhatsapp(p.whatsapp_por_unidad_mes == null ? '' : String(p.whatsapp_por_unidad_mes)); }, [p]);
  async function guardar() {
    setBusy(true);
    try {
      await api(`/api/comercial/planes/${p.clave}`, { method: 'PUT', json: { precio_por_unidad: precio, visible, modulos_incluidos: modulos, unidades_maximas: maximo.trim() ? Number(maximo) : null, unidades_minimas: minimo.trim() ? Number(minimo) : null, asistente_por_unidad_mes: asistente.trim() ? Number(asistente) : null, whatsapp_por_unidad_mes: whatsapp.trim() ? Number(whatsapp) : null, caracteristicas: carac.split('\n').map(x => x.trim()).filter(Boolean) } });
      toast.ok(`Plan ${p.nombre} actualizado`);
      onGuardado();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{p.nombre}</p><p className="text-xs text-muted">El público lo ve sin impuesto; con el IGV de Perú se paga <span className="num">{conIgv(precio, tasa)}</span> por depto al mes</p></div>
        <Input label="Precio base en soles (S/, sin impuesto)" inputMode="decimal" value={precio} onChange={e => setPrecio(e.target.value)} className="w-56" />
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[oklch(var(--brand))]" checked={visible} onChange={e => setVisible(e.target.checked)} />Visible</label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Máximo de departamentos por condominio" type="number" min={1} inputMode="numeric" value={maximo} onChange={e => setMaximo(e.target.value)} hint="Vacío = sin tope." className="w-64" />
        <Input label="Mínimo de departamentos que se cobran" type="number" min={1} inputMode="numeric" value={minimo} onChange={e => setMinimo(e.target.value)} hint="Vacío = sin mínimo." className="w-64" />
        <Input label="Consultas al asistente por departamento al mes" type="number" min={0} max={1000} inputMode="numeric" value={asistente} onChange={e => setAsistente(e.target.value)} hint="Vacío = sin tope. El tope del condominio es esto × departamentos que se cobran." className="w-64" />
        <Input label="Mensajes de WhatsApp por departamento al mes" type="number" min={0} max={1000} inputMode="numeric" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} hint="Vacío = sin tope." className="w-64" />
      </div>
      <fieldset>
        <legend className="text-xs text-muted">Lo que trae (módulos, mora automática y reportes)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {(Object.keys(MODULO_NOMBRE) as ModuloClave[]).map(m => (
            <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[oklch(var(--brand))]" checked={modulos.includes(m)} onChange={() => setModulos(x => (x.includes(m) ? x.filter(c => c !== m) : [...x, m]))} />{MODULO_NOMBRE[m]}</label>
          ))}
        </div>
      </fieldset>
      <Textarea label="Viñetas de la página de precios (una por línea)" value={carac} onChange={e => setCarac(e.target.value)} rows={4} />
      <Button size="sm" loading={busy} onClick={() => void guardar()}>Guardar plan</Button>
    </li>
  );
}

function Configuracion({ c, onGuardado }: { c: Config; onGuardado: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ ...c, dias_gracia: String(c.dias_gracia), dias_aviso_vencimiento: String(c.dias_aviso_vencimiento), dias_prueba_pro: String(c.dias_prueba_pro), dias_gratis: String(c.dias_gratis ?? 0) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF({ ...c, dias_gracia: String(c.dias_gracia), dias_aviso_vencimiento: String(c.dias_aviso_vencimiento), dias_prueba_pro: String(c.dias_prueba_pro), dias_gratis: String(c.dias_gratis ?? 0) }); }, [c]);
  const t = (k: keyof Config) => ({ value: (f[k] as string | null) ?? '', onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });
  async function guardar() {
    setBusy(true); setError(null);
    try {
      await api('/api/comercial/configuracion', { method: 'PUT', json: { ...f, dias_gracia: Number(f.dias_gracia), dias_aviso_vencimiento: Number(f.dias_aviso_vencimiento), dias_prueba_pro: Number(f.dias_prueba_pro), dias_gratis: Number(f.dias_gratis) } });
      toast.ok('Configuración guardada');
      onGuardado();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Tasa de IGV de Perú" inputMode="decimal" hint="0.18 = 18 %. Es la de Perú en «Impuestos y moneda por país»." {...t('igv_tasa')} />
        <Input label="Días de gracia" type="number" min={0} max={90} {...t('dias_gracia')} />
        <Input label="Avisar de vencimiento (días antes)" type="number" min={1} max={60} {...t('dias_aviso_vencimiento')} />
        <Input label="Días de prueba de Pro al registrarse" type="number" min={0} max={90} hint="0 = sin prueba: el condominio nace en Gratis." {...t('dias_prueba_pro')} />
        <Input label="Días de Gratis" type="number" min={0} max={365} hint="90 = 3 meses (la prueba de Pro va dentro). Pasado el plazo, el condominio queda en solo lectura. 0 = sin plazo." {...t('dias_gratis')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Correo para avisos (registros y solicitudes)" type="email" {...t('correo_superadmin')} />
        <Input label="URL pública (enlaces de los correos)" placeholder="https://house.gargurevich.dev" {...t('url_publica')} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[oklch(var(--brand))]" checked={f.registro_abierto} onChange={e => setF(x => ({ ...x, registro_abierto: e.target.checked }))} />Registro público abierto</label>
      <h3 className="pt-2 text-sm font-semibold">Datos de pago (los ve el cliente en Mi plan)</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Titular" {...t('pago_titular')} />
        <Input label="Banco" {...t('pago_banco')} />
        <Input label="Cuenta" {...t('pago_cuenta')} />
        <Input label="CCI" {...t('pago_cci')} />
        <Input label="Yape" {...t('pago_yape')} />
      </div>
      <Textarea label="Instrucciones" maxLength={500} {...t('pago_instrucciones')} />
      <Button loading={busy} onClick={() => void guardar()}>Guardar configuración</Button>
    </div>
  );
}

/** Datos del responsable para la Política de privacidad y los Términos (Ley 29733). Un campo vacío se ve «por confirmar» en esas páginas. */
function DatosLegales({ c, onGuardado }: { c: Config; onGuardado: () => void }) {
  const toast = useToast();
  const desde = (x: Config) => ({ legal_razon_social: x.legal_razon_social ?? '', legal_ruc: x.legal_ruc ?? '', legal_domicilio: x.legal_domicilio ?? '', legal_correo: x.legal_correo ?? '' });
  const [f, setF] = useState(desde(c));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(desde(c)); }, [c]);
  const t = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });
  async function guardar() {
    setBusy(true); setError(null);
    try {
      await api('/api/comercial/configuracion', { method: 'PUT', json: f });
      toast.ok('Datos legales guardados');
      onGuardado();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Razón social" maxLength={160} {...t('legal_razon_social')} />
        <Input label="RUC" inputMode="numeric" maxLength={11} hint="11 dígitos." {...t('legal_ruc')} />
        <Input label="Domicilio" maxLength={255} className="sm:col-span-2" {...t('legal_domicilio')} />
        <Input label="Correo de privacidad y consultas" type="email" maxLength={160} {...t('legal_correo')} />
      </div>
      <Button loading={busy} onClick={() => void guardar()}>Guardar datos legales</Button>
    </div>
  );
}

/** Precios (base, sin IGV), planes, plazos, datos de pago y datos legales: todo se edita aquí; nada vive en el código ni en variables de entorno. */
export function PreciosYPagos() {
  const { data, loading, error, reload } = useResource<Catalogo>('/api/comercial/catalogo');
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const tasa = data.configuracion.igv_tasa;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Módulos (ya no se venden sueltos)" description="Pro los trae todos. El precio sólo se usa para las suscripciones antiguas que los tenían sueltos; al público no se le muestra." />
        <CardBody><ul className="divide-y divide-line">{data.modulos.map(m => <FilaModulo key={m.clave} m={m} tasa={tasa} onGuardado={reload} />)}</ul></CardBody>
      </Card>
      <Card>
        <CardHeader title="Planes" description="Precio BASE en soles por departamento al mes (el público lo ve sin impuesto y el impuesto se suma al pagar). Las otras monedas se fijan en «Precios por moneda». Gratis y cortesía no cobran; Pro y Administradora cobran como mínimo los departamentos que indiques. Un plan oculto no sale en la página de precios." />
        <CardBody><ul className="divide-y divide-line">{data.planes.map(p => <FilaPlan key={p.clave} p={p} tasa={tasa} onGuardado={reload} />)}</ul></CardBody>
      </Card>
      <ImpuestosYPrecios impuestos={data.impuestos} precios={data.precios_moneda} planes={data.planes} onGuardado={reload} />
      <Card>
        <CardHeader title="Plazos y datos de pago" />
        <CardBody><Configuracion c={data.configuracion} onGuardado={reload} /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Datos legales" description="Los ve el público en la Política de privacidad y los Términos. Un dato vacío se muestra «por confirmar»." />
        <CardBody><DatosLegales c={data.configuracion} onGuardado={reload} /></CardBody>
      </Card>
    </div>
  );
}
