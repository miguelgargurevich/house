import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, Input, Modal, useToast } from '../../../../ui';
import { Interruptor } from '../../../admin/_parts/catalogo/Interruptor';
import type { Gateway } from './tipos';

interface Props {
  open: boolean;
  /** Gateway que se edita; null = uno nuevo. */
  existente: Gateway | null;
  onClose: () => void;
  onGuardado: () => void;
}

/** Agregar o editar un gateway propio. La URL se valida en el servidor contra la lista de dominios permitidos (https, 443, sin IP). */
export function GatewayModal({ open, existente, onClose, onGuardado }: Props) {
  const toast = useToast();
  const [nombre, setNombre] = useState('');
  const [url, setUrl] = useState('');
  const [modelo, setModelo] = useState('');
  const [modeloVision, setModeloVision] = useState('');
  const [vision, setVision] = useState(false);
  const [prioridad, setPrioridad] = useState('');
  const [prioridadVision, setPrioridadVision] = useState('');
  const [error, setError] = useState<string>();
  const [guardando, setGuardando] = useState(false);
  const [cargadoPara, setCargadoPara] = useState<string | null>(null);

  // Al abrir se parte de los datos del gateway (o de cero); los refrescos de la lista no reinician el formulario.
  const abierto = open ? `${existente?.id ?? 'nuevo'}` : null;
  if (abierto !== cargadoPara) {
    setCargadoPara(abierto);
    setNombre(existente?.nombre ?? '');
    setUrl(existente?.base_url ?? '');
    setModelo(existente?.modelo_por_defecto ?? '');
    setModeloVision(existente?.modelo_vision ?? '');
    setVision(existente?.vision ?? false);
    setPrioridad(existente ? String(existente.prioridad) : '');
    setPrioridadVision(existente?.prioridad_vision != null ? String(existente.prioridad_vision) : '');
    setError(undefined);
  }

  async function guardar(e?: FormEvent) {
    e?.preventDefault();
    setGuardando(true);
    setError(undefined);
    try {
      const json = {
        nombre: nombre.trim(),
        base_url: url.trim(),
        modelo_por_defecto: modelo.trim(),
        modelo_vision: modeloVision.trim(),
        vision,
        ...(prioridad.trim() ? { prioridad: Number(prioridad) } : {}),
        prioridad_vision: prioridadVision.trim() ? Number(prioridadVision) : null,
      };
      if (existente) await api(`/api/llavero/gateways/${existente.id}`, { method: 'PATCH', json });
      else await api('/api/llavero/gateways', { method: 'POST', json });
      toast.ok(existente ? `Gateway ${json.nombre} actualizado` : `Gateway ${json.nombre} agregado: ahora agrégale una clave`);
      onGuardado();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existente ? `Editar ${existente.nombre}` : 'Agregar gateway'}
      description="Un servicio propio compatible con OpenAI. Su dominio debe estar en «Dominios permitidos»."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={guardando} disabled={!nombre.trim() || !url.trim()} onClick={() => void guardar()}>{existente ? 'Guardar cambios' : 'Agregar gateway'}</Button></>}
    >
      <form onSubmit={e => void guardar(e)} className="grid gap-4" noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Nombre" autoComplete="off" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Dashboard IA" />
        <Input
          label="URL base"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://api.midominio.dev/v1"
          hint="Siempre https, sin puerto, sin usuario ni contraseña y con un dominio (no una IP) de la lista permitida."
        />
        <Input label="Modelo por defecto (opcional)" autoComplete="off" spellCheck={false} value={modelo} onChange={e => setModelo(e.target.value)} hint="Si lo dejas vacío se usa el que el gateway liste al sincronizar." />
        <Interruptor label="Lee imágenes (visión)" hint="Sólo los gateways con visión sirven para evaluar comprobantes." checked={vision} onChange={e => setVision(e.target.checked)} />
        {vision && <Input label="Modelo de visión" autoComplete="off" spellCheck={false} value={modeloVision} onChange={e => setModeloVision(e.target.value)} placeholder={modelo || 'nvidia/nemotron-3.5-super-vl-120b-a12b'} hint="El que recibe la imagen del comprobante." />}
        {vision && <Input label="Prioridad para leer comprobantes (opcional; menor = primero)" inputMode="numeric" autoComplete="off" value={prioridadVision} onChange={e => setPrioridadVision(e.target.value.replace(/\D/g, ''))} placeholder={prioridad || '20'} hint="Sólo cambia el orden de la lectura de comprobantes; el chat sigue con la prioridad general. Vacío = la misma." />}
        <Input label="Prioridad (opcional)" inputMode="numeric" autoComplete="off" value={prioridad} onChange={e => setPrioridad(e.target.value.replace(/\D/g, ''))} placeholder="20" hint="1 a 99; menor = antes. Los proveedores de arriba ocupan 1 a 14; por omisión va después de ellos." />
      </form>
    </Modal>
  );
}
