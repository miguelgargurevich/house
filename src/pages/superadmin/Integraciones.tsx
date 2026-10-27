import { Link } from 'react-router-dom';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { Alert, Badge, Card, ErrorState, PageHeader, Skeleton } from '../../ui';
import { OcrSeccion } from './_parts/llavero/OcrSeccion';
import { TelegramSeccion } from './_parts/llavero/TelegramSeccion';
import type { DatosLlavero } from './_parts/llavero/tipos';

interface ResumenWhatsapp {
  servidor: { configurado: boolean; faltan: string[] };
  empresas: { id: number; nombre: string; numero_vinculado: boolean; bot_recibe: boolean; personas_vinculadas: number }[];
}

/** WhatsApp, Telegram y OCR: lo que conecta House con el exterior y no es una clave de IA (eso sigue en el Llavero). Sólo superadmin. */
export default function Integraciones() {
  const llavero = useResource<DatosLlavero>('/api/llavero');
  const whatsapp = useResource<ResumenWhatsapp>('/api/llavero/whatsapp');
  const sinConfigurar = !!llavero.data && !llavero.data.configurado;

  return (
    <>
      <PageHeader title="Canales e integraciones" description="WhatsApp, el bot de Telegram y el OCR de comprobantes. Las claves de IA, los gateways y los dominios permitidos siguen en el Llavero de IA." />

      {sinConfigurar && (
        <div className="mb-4">
          <Alert tone="warn">
            El llavero no está configurado: falta la variable <code className="num">LLAVERO_ENC_KEY</code> en el servidor. Mientras tanto no se pueden guardar el token de Telegram ni la clave del OCR.
          </Alert>
        </div>
      )}

      <Card className="[&>section:first-child]:border-t-0">
        <WhatsappSeccion datos={whatsapp.data} loading={whatsapp.loading} error={whatsapp.error} />
        {llavero.loading && <div className="border-t border-line px-5 py-4"><Skeleton className="h-24 w-full" /></div>}
        {llavero.error && <div className="border-t border-line px-5 py-4"><ErrorState message={llavero.error} onRetry={() => void llavero.reload()} /></div>}
        {llavero.data && (
          <>
            <TelegramSeccion telegram={llavero.data.telegram} deshabilitado={sinConfigurar} onCambio={() => void llavero.reload()} />
            <OcrSeccion ocr={llavero.data.ocr} deshabilitado={sinConfigurar} onCambio={() => void llavero.reload()} />
          </>
        )}
      </Card>

      <p className="mt-4 text-sm text-muted">
        Un OCR público sólo puede apuntar a un dominio de la lista del <Link to="/superadmin/llavero" className="font-medium text-brand underline">Llavero de IA › Dominios permitidos</Link>.
      </p>
    </>
  );
}

function WhatsappSeccion({ datos, loading, error }: { datos: ResumenWhatsapp | null | undefined; loading: boolean; error: string | null | undefined }) {
  return (
    <section aria-labelledby="integraciones-whatsapp" className="border-t border-line px-5 py-4">
      <div className="flex gap-3">
        <ChatBubbleLeftRightIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="integraciones-whatsapp" className="text-sm font-semibold">WhatsApp</h2>
            {datos && <Badge tone={datos.servidor.configurado ? 'ok' : 'warn'}>{datos.servidor.configurado ? 'Servidor listo' : 'Servidor sin configurar'}</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted">Avisos y bot por WhatsApp a través de la Evolution API. Cada administradora vincula su propio número escaneando el QR en su pantalla de WhatsApp.</p>
          {loading && <Skeleton className="mt-3 h-16 w-full" />}
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}
          {datos && !datos.servidor.configurado && (
            <p className="mt-2 text-sm text-muted">Falta definir en el servidor: <span className="font-medium text-ink">{datos.servidor.faltan.join(', ')}</span>.</p>
          )}
          {datos && (datos.empresas.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Aún no hay administradoras.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line" aria-label="WhatsApp por administradora">
              {datos.empresas.map(e => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 text-sm font-medium">{e.nombre}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.numero_vinculado ? 'ok' : 'warn'}>{e.numero_vinculado ? 'Número vinculado' : 'Sin número'}</Badge>
                    {e.numero_vinculado && <Badge tone={e.bot_recibe ? 'ok' : 'warn'}>{e.bot_recibe ? 'Bot recibe mensajes' : 'Bot sin webhook'}</Badge>}
                    <span className="text-xs text-muted">{e.personas_vinculadas === 1 ? '1 persona vinculada' : `${e.personas_vinculadas} personas vinculadas`}</span>
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
