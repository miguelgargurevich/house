import { useState } from 'react';
import type { FormEvent } from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Alert, Badge, Button, ConfirmDialog, Input, Modal, useToast } from '../../../../ui';
import type { TelegramVista } from './tipos';

interface Props {
  telegram: TelegramVista;
  deshabilitado: boolean;
  onCambio: () => void;
}

/** «Bot de Telegram»: un bot GLOBAL de House. El token (de @BotFather) se guarda cifrado y no se vuelve a mostrar; «Guardar y probar» valida con Telegram y registra el webhook. */
export function TelegramSeccion({ telegram, deshabilitado, onCambio }: Props) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [quitar, setQuitar] = useState(false);
  const [quitando, setQuitando] = useState(false);

  function abrir() { setToken(''); setError(undefined); setAbierto(true); }
  function cerrar() { setToken(''); setAbierto(false); }

  async function guardar(e?: FormEvent) {
    e?.preventDefault();
    setGuardando(true);
    setError(undefined);
    try {
      const v = await api<TelegramVista>('/api/llavero/telegram', { method: 'PUT', json: { token: token.trim() } });
      toast.ok(v.bot_usuario ? `Bot @${v.bot_usuario} guardado y activo` : 'Bot de Telegram guardado');
      setToken('');
      onCambio();
      setAbierto(false);
    } catch (err) { setError(errorText(err)); } finally { setGuardando(false); }
  }

  async function probar() {
    setProbando(true);
    try {
      const v = await api<TelegramVista>('/api/llavero/telegram/probar', { method: 'POST', json: {} });
      toast.ok(`Telegram respondió: @${v.bot_usuario}`);
      onCambio();
    } catch (err) { toast.error(errorText(err)); } finally { setProbando(false); }
  }

  async function pausar(habilitado: boolean) {
    try {
      await api('/api/llavero/telegram', { method: 'PATCH', json: { habilitado } });
      toast.ok(habilitado ? 'Bot de Telegram activado' : 'Bot de Telegram en pausa');
      onCambio();
    } catch (err) { toast.error(errorText(err)); }
  }

  async function quitarBot() {
    setQuitando(true);
    try {
      await api('/api/llavero/telegram', { method: 'DELETE' });
      toast.ok('Bot de Telegram quitado');
      setQuitar(false);
      onCambio();
    } catch (err) { toast.error(errorText(err)); } finally { setQuitando(false); }
  }

  const estado = telegram.configurado ? (telegram.habilitado ? { tone: 'ok', label: 'En uso' } as const : { tone: 'neutral', label: 'En pausa' } as const) : null;

  return (
    <section aria-labelledby="llavero-telegram" className="border-t border-line px-5 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 gap-3">
          <PaperAirplaneIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="llavero-telegram" className="flex flex-wrap items-center gap-2 text-sm font-semibold">Bot de Telegram {estado && <Badge tone={estado.tone}>{estado.label}</Badge>}</h2>
            <p className="mt-0.5 text-sm text-muted">Un solo bot para todas las administradoras: consultas y comprobantes por Telegram. Cada persona lo vincula desde Mi perfil.</p>
            {telegram.configurado ? (
              <p className="mt-1 text-sm">
                Bot: <span className="num font-medium">{telegram.bot_usuario ? `@${telegram.bot_usuario}` : 'sin probar'}</span>
                <span className="text-muted"> · token que termina en {telegram.ultimos4}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">Sin configurar: nadie puede vincular Telegram. Crea el bot con @BotFather (/newbot) y pega aquí su token.</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Button variant={telegram.configurado ? 'secondary' : 'primary'} disabled={deshabilitado} onClick={abrir}>{telegram.configurado ? 'Cambiar token' : 'Configurar bot'}</Button>
          {telegram.configurado && <Button variant="secondary" loading={probando} disabled={deshabilitado} onClick={() => void probar()}>Probar</Button>}
          {telegram.configurado && <Button variant="secondary" disabled={deshabilitado} onClick={() => void pausar(!telegram.habilitado)}>{telegram.habilitado ? 'Pausar' : 'Activar'}</Button>}
          {telegram.configurado && <Button variant="ghost" disabled={deshabilitado} onClick={() => setQuitar(true)}>Quitar</Button>}
        </div>
      </div>

      <Modal
        open={abierto}
        onClose={cerrar}
        title="Bot de Telegram"
        description="El token se guarda cifrado y no se vuelve a mostrar. Al guardar se prueba con Telegram y se activa el bot."
        footer={<><Button variant="secondary" onClick={cerrar}>Cancelar</Button><Button loading={guardando} disabled={!token.trim()} onClick={() => void guardar()}>Guardar y probar</Button></>}
      >
        <form onSubmit={e => void guardar(e)} className="grid gap-4" noValidate>
          {error && <Alert tone="bad">{error}</Alert>}
          <Input label="Token del bot" type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} placeholder="123456789:AA…" hint="Lo entrega @BotFather al crear el bot (/newbot) o en /mybots › API Token." />
        </form>
      </Modal>

      <ConfirmDialog open={quitar} onClose={() => setQuitar(false)} onConfirm={quitarBot} loading={quitando} danger title="Quitar el bot de Telegram" message="Se borrará el token y el bot dejará de responder. Quienes ya vincularon su Telegram quedarán vinculados, pero sin respuesta hasta que configures un bot de nuevo." confirmLabel="Quitar bot" />
    </section>
  );
}
