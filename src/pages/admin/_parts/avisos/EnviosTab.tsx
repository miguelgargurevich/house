import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowPathIcon, BellIcon } from '@heroicons/react/24/outline';
import { useCondominio, useTorreElegida } from '../../../../app/condominio';
import { api, errorText, useList, useResource } from '../../../../api';
import { useAuth } from '../../../../auth/AuthContext';
import { Badge, Button, Card, DataTable, SearchBox, Skeleton, StatStrip, Tabs, Toolbar, periodo, useToast } from '../../../../ui';
import type { Column, Tone } from '../../../../ui';
import { FiltroSelect } from '../catalogo/FiltroSelect';
import { SelectoresUbicacion } from '../cobranza/SelectoresUbicacion';
import type { Comunicado } from '../comunicados/tipos';
import { Canales } from './Canales';

type Estado = 'pendiente' | 'enviada' | 'error' | 'omitida';
type Filtro = '' | Estado;

interface Envio {
  id: number;
  usuario: { id: number; nombre: string };
  canal: 'email' | 'whatsapp';
  tipo: string;
  estado: Estado;
  asunto: string;
  intentos: number;
  error: string | null;
  programada_para: string;
  enviada_at: string | null;
  created_at: string;
  /** De qué trata el envío: el recibo (con su torre) y, si es de un cargo o un pago, el departamento; si es un comunicado, su título. */
  contexto?: { recibo: { id: number; mes: number; anio: number; torre: string | null; condominio: string | null } | null; unidad: { codigo: string; torre: string | null } | null; comunicado?: { id: number; titulo: string } | null } | null;
}

const TIPO: Record<string, string> = {
  recibo_emitido: 'Recibo emitido',
  por_vencer: 'Por vencer',
  vence_hoy: 'Vence hoy',
  vencido: 'Vencido',
  pago_validado: 'Pago validado',
  pago_rechazado: 'Pago rechazado',
  ia_caida: 'IA sin servicio',
  ia_restablecida: 'IA restablecida',
  comunicado: 'Comunicado',
  cierre_pendiente: 'Cierre del mes pendiente',
};
const CANAL = { email: 'Correo', whatsapp: 'WhatsApp' } as const;
const ESTADO: Record<Estado, { tone: Tone; label: string }> = {
  enviada: { tone: 'ok', label: 'Enviada' },
  pendiente: { tone: 'info', label: 'Pendiente' },
  error: { tone: 'bad', label: 'Con error' },
  omitida: { tone: 'warn', label: 'Omitida' },
};

const fechaHora = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const cuando = (a: Envio) => fechaHora.format(new Date(a.enviada_at ?? (a.estado === 'pendiente' ? a.programada_para : a.created_at)));

/** Sólo los filtros con valor, como query string. */
const query = (p: Record<string, string | undefined>) => new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

/**
 * Los envíos de correo y WhatsApp (recibos, vencimientos, pagos y comunicados). La usan la administración (`/admin/avisos`) y la junta
 * (`/junta/avisos`): la API acota la lista de la junta a los vecinos de su ámbito, y ella no configura canales. `?comunicado=<id>` deja sólo
 * los envíos de ese comunicado (lo enlaza la pestaña «Comunicados»).
 */
export function EnviosTab() {
  const { user } = useAuth();
  const toast = useToast();
  const esJunta = user?.rol === 'propietario';
  const [params, setParams] = useSearchParams();
  const comunicadoId = params.get('comunicado') ?? '';
  const [filtro, setFiltro] = useState<Filtro>('');
  // `?tipo=` (p. ej. desde «Avisar a los vecinos» de un recibo) abre la pestaña ya filtrada por ese tipo de envío.
  const [tipo, setTipo] = useState(() => params.get('tipo') ?? '');
  const [reenviando, setReenviando] = useState<number | null>(null);
  const { complejo } = useCondominio();
  const [torre, setTorre] = useTorreElegida();
  const list = useList<Envio>('/api/notificaciones', { params: { estado: filtro, tipo: tipo || undefined, comunicado_id: comunicadoId || undefined, complejo_id: complejo || undefined, estructura_id: torre || undefined } });
  // Las cifras siguen a los mismos filtros que la lista (tipo, comunicado, condominio y torre), para que cuadren.
  const resumen = useResource<Record<Estado, number>>(`/api/notificaciones/resumen?${query({ tipo: tipo || undefined, comunicado_id: comunicadoId || undefined, complejo_id: complejo || undefined, estructura_id: torre || undefined })}`);
  const comunicado = useResource<Comunicado>(comunicadoId ? `/api/comunicados/${comunicadoId}` : null);
  const cifra = (e: Estado) => (resumen.loading && !resumen.data ? <Skeleton className="h-7 w-10" /> : resumen.data?.[e] ?? 0);

  async function reenviar(a: Envio) {
    setReenviando(a.id);
    try {
      await api(`/api/notificaciones/${a.id}/reenviar`, { method: 'POST' });
      toast.ok('Lo volveremos a enviar en unos minutos');
      void list.reload();
      void resumen.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setReenviando(null); }
  }

  const columns: Column<Envio>[] = [
    { key: 'destinatario', header: 'Destinatario', cell: a => <span className="font-medium">{a.usuario.nombre}</span> },
    { key: 'recibo', header: 'Recibo', hideBelow: 'md', cell: a => {
      const r = a.contexto?.recibo;
      if (!r) return <span className="text-muted">—</span>;
      const torreDe = a.contexto?.unidad?.torre ?? r.torre;
      return <span className="block">{periodo(r.mes, r.anio)}<span className="block text-xs text-muted">{[a.contexto?.unidad?.codigo, torreDe, r.condominio].filter(Boolean).join(' · ')}</span></span>;
    } },
    { key: 'canal', header: 'Canal', hideBelow: 'sm', cell: a => CANAL[a.canal] },
    { key: 'tipo', header: 'Envío', hideBelow: 'md', cell: a => (
      <span className="block">{TIPO[a.tipo] ?? a.tipo}{a.contexto?.comunicado && <span className="block max-w-[14rem] truncate text-xs text-muted">{a.contexto.comunicado.titulo}</span>}</span>
    ) },
    { key: 'estado', header: 'Estado', cell: a => <Badge tone={ESTADO[a.estado].tone}>{ESTADO[a.estado].label}</Badge> },
    { key: 'fecha', header: 'Fecha', hideBelow: 'lg', cell: a => <span className="num text-muted">{cuando(a)}</span> },
    { key: 'error', header: 'Motivo', hideBelow: 'lg', cell: a => (a.error ? <span className="text-xs text-muted">{a.error}</span> : '—') },
    { key: 'acciones', header: '', align: 'right', cell: a => (
      a.estado === 'error' || a.estado === 'omitida'
        ? <Button size="sm" variant="secondary" icon={<ArrowPathIcon className="h-4 w-4" />} loading={reenviando === a.id} onClick={() => void reenviar(a)} aria-label={`Reenviar envío a ${a.usuario.nombre}`}>Reenviar</Button>
        : null
    ) },
  ];

  return (
    <>
      <StatStrip
        stats={[
          { label: 'Enviadas', value: cifra('enviada'), tone: 'ok' },
          { label: 'Con error', value: cifra('error'), tone: (resumen.data?.error ?? 0) > 0 ? 'bad' : undefined },
          { label: 'Omitidas', value: cifra('omitida'), tone: (resumen.data?.omitida ?? 0) > 0 ? 'warn' : undefined },
          { label: 'Pendientes', value: cifra('pendiente') },
        ]}
      />
      {!esJunta && <Canales />}
      <Card>
        {comunicadoId && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 text-sm">
            <span>Solo los envíos del comunicado {comunicado.data ? <strong>«{comunicado.data.titulo}»</strong> : comunicado.error ? 'que no encontramos' : '…'}</span>
            <Button size="sm" variant="secondary" onClick={() => setParams({})}>Ver todos los envíos</Button>
          </div>
        )}
        <Toolbar>
          <Tabs<Filtro>
            value={filtro}
            onChange={setFiltro}
            items={[{ id: '', label: 'Todos' }, { id: 'pendiente', label: 'Pendientes' }, { id: 'enviada', label: 'Enviadas' }, { id: 'error', label: 'Con error' }, { id: 'omitida', label: 'Omitidas' }]}
          />
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por destinatario…" />
          <FiltroSelect label="Filtrar por tipo" value={tipo} onChange={setTipo}>
            <option value="">Todos los tipos</option>
            {Object.entries(TIPO).map(([clave, nombre]) => <option key={clave} value={clave}>{nombre}</option>)}
          </FiltroSelect>
          <SelectoresUbicacion torre={torre} onTorre={setTorre} oculto={esJunta} />
        </Toolbar>
        <DataTable
          caption="Envíos de correo y WhatsApp"
          columns={columns}
          rows={list.items}
          rowKey={a => a.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: comunicadoId ? 'Este comunicado no tiene envíos' : 'Sin envíos',
            description: comunicadoId
              ? 'Se publicó sólo en pantalla, o ningún vecino tiene activado el canal que elegiste.'
              : esJunta ? 'Cuando se envíe un correo o WhatsApp a los vecinos de tu ámbito, aquí verás a quién le llegó.' : 'Cuando emitas un recibo o publiques un comunicado por correo o WhatsApp, aquí verás a quién le llegó.',
            icon: <BellIcon />,
          }}
        />
      </Card>
    </>
  );
}
