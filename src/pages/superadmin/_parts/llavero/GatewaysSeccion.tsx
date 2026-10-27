import { PlusIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Button } from '../../../../ui';
import { GrupoProveedor } from './GrupoProveedor';
import { avisoDeGateway, clavesDeProveedor, proveedorDeGateway } from './tipos';
import type { Clave, Gateway } from './tipos';

const ESTADO = { ok: { tone: 'ok', label: 'En servicio' }, pausado: { tone: 'neutral', label: 'En pausa' }, dominio_no_permitido: { tone: 'bad', label: 'Dominio no permitido' } } as const;

interface Props {
  gateways: Gateway[];
  claves: Clave[];
  maxClaves: number;
  deshabilitado: boolean;
  probando: number | null;
  sincronizando: number | null;
  onAgregarGateway: () => void;
  onEditarGateway: (g: Gateway) => void;
  onPausarGateway: (g: Gateway, habilitado: boolean) => void;
  onQuitarGateway: (g: Gateway) => void;
  onAgregarClave: (g: Gateway) => void;
  onProbar: (g: Gateway, c: Clave) => void;
  onSincronizar: (g: Gateway, c: Clave) => void;
  onCambiar: (g: Gateway, c: Clave) => void;
  onCambiarModelo: (g: Gateway, c: Clave) => void;
  onAlternar: (g: Gateway, c: Clave, habilitada: boolean) => void;
  onReserva: (g: Gateway, c: Clave, reserva: boolean) => void;
  onQuitarClave: (g: Gateway, c: Clave) => void;
}

/** «Gateways propios»: servicios compatibles con OpenAI que registra el superadmin. Cada uno lleva sus claves con los mismos controles que un proveedor. */
export function GatewaysSeccion(p: Props) {
  return (
    <section aria-labelledby="llavero-gateways" className="border-t border-line">
      <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <h2 id="llavero-gateways" className="text-sm font-semibold">Gateways propios</h2>
          <p className="mt-0.5 text-sm text-muted">Tus propios servicios compatibles con OpenAI (por ejemplo Dashboard IA u OmniRoute). Entran a la rotación como cualquier proveedor.</p>
        </div>
        <Button variant="secondary" icon={<PlusIcon className="h-4 w-4" aria-hidden="true" />} disabled={p.deshabilitado} onClick={p.onAgregarGateway}>Agregar gateway</Button>
      </div>
      {p.gateways.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted">Aún no hay ningún gateway. Permite su dominio y agrégalo.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {p.gateways.map(g => {
            const aviso = avisoDeGateway(g);
            const estado = ESTADO[g.estado];
            return (
              <li key={g.id}>
                <div className="flex flex-col gap-2 px-5 pt-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold">{g.nombre}</span>
                    <span className="num text-sm text-muted">{g.dominio}</span>
                    <Badge tone={g.vision ? 'info' : 'neutral'}>{g.vision ? 'Con visión' : 'Sin visión'}</Badge>
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                  </div>
                  {aviso && <Alert tone={g.estado === 'pausado' ? 'info' : 'warn'}>{aviso}</Alert>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={p.deshabilitado} onClick={() => p.onEditarGateway(g)}>Editar</Button>
                    <Button variant="secondary" disabled={p.deshabilitado} onClick={() => p.onPausarGateway(g, !g.habilitado)}>{g.habilitado ? 'Pausar' : 'Reanudar'}</Button>
                    <Button variant="ghost" disabled={p.deshabilitado} onClick={() => p.onQuitarGateway(g)}>Quitar gateway</Button>
                  </div>
                </div>
                <ul>
                  <GrupoProveedor
                    proveedor={proveedorDeGateway(g)}
                    claves={clavesDeProveedor(p.claves, proveedorDeGateway(g))}
                    maxClaves={p.maxClaves}
                    deshabilitado={p.deshabilitado}
                    probando={p.probando}
                    sincronizando={p.sincronizando}
                    onAgregar={() => p.onAgregarClave(g)}
                    onProbar={c => p.onProbar(g, c)}
                    onSincronizar={c => p.onSincronizar(g, c)}
                    onCambiar={c => p.onCambiar(g, c)}
                    onCambiarModelo={c => p.onCambiarModelo(g, c)}
                    onAlternar={(c, h) => p.onAlternar(g, c, h)}
                    onReserva={(c, r) => p.onReserva(g, c, r)}
                    onQuitar={c => p.onQuitarClave(g, c)}
                  />
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
