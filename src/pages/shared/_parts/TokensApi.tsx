import { useState } from 'react';
import { CheckIcon, ClipboardDocumentIcon, KeyIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../api';
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input, Modal, Select, Skeleton, fechaCorta, useToast } from '../../../ui';

interface Token { id: string; nombre: string; prefijo: string; creado: string; ultimo_uso: string | null; vence: string; estado: 'activo' | 'vencido' | 'revocado' | 'invalidado' }
interface Lista { tokens: Token[]; max_activos: number; dias_por_defecto: number; dias_maximos: number }
interface Creado extends Token { token: string }

const ESTADO: Record<Token['estado'], { tone: 'ok' | 'neutral' | 'warn'; label: string }> = {
  activo: { tone: 'ok', label: 'Activo' },
  vencido: { tone: 'neutral', label: 'Vencido' },
  revocado: { tone: 'neutral', label: 'Revocado' },
  invalidado: { tone: 'warn', label: 'Invalidado' },
};
const VIGENCIAS = [{ dias: 30, label: '30 días' }, { dias: 90, label: '90 días (recomendado)' }, { dias: 180, label: '6 meses' }, { dias: 365, label: '1 año (máximo)' }];

/** Sección «Tokens de API» del perfil: conectar un cliente MCP (p. ej. Claude) con acceso de SOLO LECTURA a tus datos de House. */
export function TokensApiPerfil() {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<Lista>('/api/me/tokens-api');
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [dias, setDias] = useState(90);
  const [errNombre, setErrNombre] = useState<string | undefined>();
  const [enviando, setEnviando] = useState(false);
  const [nuevo, setNuevo] = useState<Creado | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [aRevocar, setARevocar] = useState<Token | null>(null);
  const [revocando, setRevocando] = useState(false);

  const activos = (data?.tokens ?? []).filter(t => t.estado === 'activo').length;
  const lleno = data ? activos >= data.max_activos : false;
  const urlMcp = `${window.location.origin}/mcp`;

  function abrir() { setNombre(''); setDias(90); setErrNombre(undefined); setNuevo(null); setCopiado(false); setCreando(true); }
  function cerrar() { setCreando(false); setNuevo(null); }

  async function crear() {
    if (!nombre.trim()) { setErrNombre('Ponle un nombre para reconocerlo (por ejemplo, «Claude en mi laptop»)'); return; }
    setEnviando(true);
    try {
      setNuevo(await api<Creado>('/api/me/tokens-api', { method: 'POST', json: { nombre: nombre.trim(), dias } }));
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setEnviando(false); }
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch { toast.error('No se pudo copiar automáticamente: selecciona el texto y cópialo.'); }
  }

  async function revocar() {
    if (!aRevocar) return;
    setRevocando(true);
    try {
      await api(`/api/me/tokens-api/${aRevocar.id}`, { method: 'DELETE' });
      toast.ok('Token revocado: ya no abre nada');
      setARevocar(null);
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setRevocando(false); }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Tokens de API"
        description="Para conectar un cliente MCP (como Claude) y consultar tus datos de Torre. Son de solo lectura y ven exactamente lo mismo que tú."
        action={<Button size="sm" onClick={abrir} disabled={lleno} icon={<KeyIcon className="h-4 w-4" />}>Crear token</Button>}
      />
      <CardBody>
        {lleno && <div className="mb-4"><Alert tone="info">Ya tienes {data?.max_activos} tokens activos. Revoca uno para crear otro.</Alert></div>}
        {loading && !data ? (
          <div className="grid gap-3"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.tokens.length ? (
          <EmptyState icon={<KeyIcon />} title="Todavía no tienes tokens" description="Crea uno para conectar un cliente MCP. Se muestra completo una sola vez." />
        ) : (
          <ul className="divide-y divide-line">
            {data.tokens.map(t => (
              <li key={t.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{t.nombre}</span>
                    <Badge tone={ESTADO[t.estado].tone}>{ESTADO[t.estado].label}</Badge>
                  </p>
                  <p className="text-sm text-muted">
                    <span className="num">{t.prefijo}…</span> · Creado: {fechaCorta(t.creado)} · Último uso: {t.ultimo_uso ? fechaCorta(t.ultimo_uso) : 'nunca'} · Vence: {fechaCorta(t.vence)}
                  </p>
                  {t.estado === 'invalidado' && <p className="text-sm text-muted">Cambiaste tu rol o tu contraseña: crea uno nuevo.</p>}
                </div>
                {t.estado === 'activo' && <Button variant="ghost" size="sm" onClick={() => setARevocar(t)} aria-label={`Revocar el token ${t.nombre}`}>Revocar</Button>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Modal
        open={creando}
        onClose={cerrar}
        title={nuevo ? 'Copia tu token ahora' : 'Crear token de API'}
        description={nuevo ? undefined : 'Un token por cliente o dispositivo, para poder revocarlo por separado.'}
        footer={nuevo ? <Button onClick={cerrar}>Ya lo guardé</Button> : (<><Button variant="secondary" onClick={cerrar}>Cancelar</Button><Button loading={enviando} onClick={() => void crear()}>Crear token</Button></>)}
      >
        {nuevo ? (
          <div className="grid gap-4">
            <Alert tone="warn">Este token no se vuelve a mostrar. Si lo pierdes, revócalo y crea otro.</Alert>
            <div>
              <label htmlFor="token-nuevo" className="mb-1 block text-sm font-medium">Token «{nuevo.nombre}»</label>
              <div className="flex gap-2">
                <input id="token-nuevo" readOnly value={nuevo.token} onFocus={e => e.currentTarget.select()} className="num min-w-0 flex-1 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink" />
                <Button variant="secondary" onClick={() => void copiar(nuevo.token)} icon={copiado ? <CheckIcon className="h-4 w-4" /> : <ClipboardDocumentIcon className="h-4 w-4" />}>{copiado ? 'Copiado' : 'Copiar'}</Button>
              </div>
              <p className="sr-only" role="status" aria-live="polite">{copiado ? 'Token copiado al portapapeles' : ''}</p>
            </div>
            <div className="text-sm text-muted">
              <p className="mb-1 font-medium text-ink">Cómo conectarlo</p>
              <p>URL del servidor: <span className="num break-all text-ink">{urlMcp}</span></p>
              <p>Cabecera: <span className="num break-all text-ink">Authorization: Bearer {nuevo.prefijo}…</span> (con el token completo)</p>
              <p className="mt-1">Vence el {fechaCorta(nuevo.vence)}.</p>
            </div>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); void crear(); }} className="grid gap-4" noValidate>
            <Input label="Nombre" maxLength={60} value={nombre} onChange={e => { setNombre(e.target.value); setErrNombre(undefined); }} error={errNombre} hint="Para reconocerlo en la lista." autoComplete="off" />
            <Select label="Vigencia" value={String(dias)} onChange={e => setDias(Number(e.target.value))}>
              {VIGENCIAS.map(v => <option key={v.dias} value={v.dias}>{v.label}</option>)}
            </Select>
            <Alert tone="info">Solo lectura: no puede cambiar ni borrar nada. Se invalida si cambias tu rol o tu contraseña.</Alert>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={aRevocar !== null}
        onClose={() => setARevocar(null)}
        onConfirm={revocar}
        title="Revocar token"
        message={aRevocar ? `«${aRevocar.nombre}» dejará de funcionar de inmediato. No se puede deshacer.` : ''}
        confirmLabel="Revocar"
        danger
        loading={revocando}
      />
    </Card>
  );
}
