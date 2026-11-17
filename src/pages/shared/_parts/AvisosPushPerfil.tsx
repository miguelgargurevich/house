import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { activarWeb, desactivarWeb, estadoWeb, leerConfigPush, type ConfigPush, type EstadoWeb } from '../../../app/push';
import { Button, Card, CardBody, CardHeader, useToast } from '../../../ui';

const TEXTO: Partial<Record<EstadoWeb, string>> = {
  inactivo: 'Te avisamos en este navegador cuando haya un recibo nuevo, un vencimiento o un comunicado, aunque no tengas Torre abierta.',
  activo: 'Los avisos están activos en este navegador. Los recibes aunque no tengas Torre abierta.',
  bloqueado: 'Bloqueaste las notificaciones de Torre en este navegador. Para recibirlas, permítelas en la configuración del sitio (el candado junto a la dirección) y vuelve aquí.',
  iphone_sin_instalar: 'En el iPhone los avisos del navegador sólo funcionan con Torre en tu pantalla de inicio: toca Compartir › «Agregar a inicio», abre Torre desde ese ícono y activa los avisos aquí.',
};

/**
 * «Recibir avisos en este navegador» (Web Push). Sólo en el navegador: dentro de la app de iOS/Android van los avisos nativos, y en una sesión prestada
 * («Entrar como») no se muestra (el dispositivo sería del superadmin). Si el servidor no tiene las llaves VAPID o el navegador no sabe, la tarjeta no aparece.
 */
export function AvisosPushPerfil() {
  const toast = useToast();
  const { user } = useAuth();
  const [config, setConfig] = useState<ConfigPush | null>(null);
  const [estado, setEstado] = useState<EstadoWeb | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const usuarioId = user?.id;
  const cargar = useCallback(async () => {
    if (usuarioId == null) return;
    try {
      const c = await leerConfigPush();
      setConfig(c);
      setEstado(await estadoWeb(c, usuarioId));
    } catch { setEstado('no_soportado'); }
  }, [usuarioId]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (!user || user.impersonando || !estado || estado === 'no_soportado' || estado === 'sin_servidor') return null;

  async function alternar() {
    if (!config || !user) return;
    setTrabajando(true);
    try {
      if (estado === 'activo') {
        await desactivarWeb(user.id);
        toast.ok('Apagamos los avisos en este navegador');
      } else {
        const nuevo = await activarWeb(user.id, config);
        if (nuevo === 'activo') toast.ok('Listo: recibirás avisos en este navegador');
      }
      setEstado(await estadoWeb(config, user.id));
    } catch (e) { toast.error(errorText(e)); } finally { setTrabajando(false); }
  }

  const puedeAlternar = estado === 'activo' || estado === 'inactivo';
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Avisos en este navegador" description="Recibe un aviso en este dispositivo cuando haya algo que atender." />
      <CardBody>
        <div className="grid gap-4 lg:max-w-xl">
          <p className="text-sm text-muted">{TEXTO[estado]}</p>
          {puedeAlternar && (
            <div className="flex justify-end">
              <Button variant={estado === 'activo' ? 'secondary' : 'primary'} loading={trabajando} onClick={() => void alternar()} className="w-full sm:w-auto">
                {estado === 'activo' ? 'Dejar de recibir avisos' : 'Recibir avisos en este navegador'}
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
