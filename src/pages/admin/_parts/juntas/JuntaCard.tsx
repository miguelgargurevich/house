import { ArrowPathIcon, ClockIcon, PencilSquareIcon, PlusIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { Badge, Button, Card, CardBody, CardHeader, IconButton, fechaCorta } from '../../../../ui';
import { QrImagen } from '../medios/QrMiniatura';
import type { Medio } from '../medios/tipos';
import { CARGOS_UNICOS, cargoLabel, laJuntaDe, lineaCuenta, nombreAmbito, nombreGestion } from './tipos';
import type { FichaJunta, Junta } from './tipos';

interface Props {
  ficha: FichaJunta;
  /** La administración gestiona todo; el presidente y el tesorero sólo editan su correo y su cuenta. */
  puedeGestionar: boolean;
  /** Con varios condominios, el nombre del condominio acompaña al del block. */
  mostrarCondominio?: boolean;
  /** «block» o «torre», según cómo llame el condominio a sus edificios. */
  palabra: string;
  onRegistrar: () => void;
  onEditar: (j: Junta) => void;
  onNuevaGestion: (j: Junta) => void;
  onHistorial: () => void;
  onCuenta: (j: Junta, medio: Medio | 'nuevo') => void;
}

function Cuenta({ m, onEditar }: { m: Medio; onEditar: () => void }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
      {m.tiene_qr && <QrImagen id={m.id} version={m.updated_at} alt={`Código QR de ${m.titular}`} className="h-16 w-16 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">{lineaCuenta(m)}{!m.activo && <Badge tone="warn">Inactiva</Badge>}</p>
        {m.tipo === 'banco' && m.numero_cuenta && <p className="num break-all">Cuenta {m.numero_cuenta}</p>}
        {m.tipo === 'banco' && m.cci && <p className="num break-all">CCI {m.cci}</p>}
        {(m.tipo === 'yape' || m.tipo === 'plin') && m.celular && <p className="num">{m.celular}</p>}
        <p className="break-words text-muted">Titular: {m.titular}</p>
      </div>
      <IconButton label={`Editar la cuenta de ${m.titular}`} onClick={onEditar}><PencilSquareIcon className="h-4 w-4" /></IconButton>
    </li>
  );
}

/** Una tarjeta por block: la gestión vigente (miembros, correo y cuenta) con sus acciones, o «Registrar la junta» si aún no hay. */
export function JuntaCard({ ficha, puedeGestionar, mostrarCondominio, palabra, onRegistrar, onEditar, onNuevaGestion, onHistorial, onCuenta }: Props) {
  const j = ficha.vigente;
  const nombre = nombreAmbito(ficha.estructura);
  const deLaJunta = laJuntaDe(ficha.estructura);
  const faltan = j ? CARGOS_UNICOS.filter(c => !j.miembros.some(m => m.cargo === c)) : [];
  return (
    <Card>
      <CardHeader
        title={nombre}
        description={[mostrarCondominio || !j ? ficha.complejo.nombre : null, j ? `Gestión ${nombreGestion(j)} · desde ${fechaCorta(j.desde)}` : null].filter(Boolean).join(' · ')}
        action={j ? <Badge tone="ok">Vigente</Badge> : <Badge tone="neutral">Sin junta</Badge>}
      />
      <CardBody className="flex flex-col gap-5">
        {!j ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">{`Aún no está registrada ${deLaJunta}.`}{puedeGestionar && ' Regístrala para que sus miembros gestionen los medios de pago y los vecinos sepan a quién pagar.'}</p>
            <div className="flex flex-wrap gap-2">
              {puedeGestionar && <Button icon={<UserGroupIcon className="h-4 w-4" />} onClick={onRegistrar}>Registrar la junta</Button>}
              {ficha.anteriores > 0 && <Button variant="secondary" icon={<ClockIcon className="h-4 w-4" />} onClick={onHistorial}>Historial ({ficha.anteriores})</Button>}
            </div>
          </div>
        ) : (
          <>
            <section aria-label={`Miembros de ${deLaJunta}`}>
              <h3 className="mb-2 text-sm font-semibold">Miembros</h3>
              {j.miembros.length === 0 ? (
                <p className="text-sm text-muted">La junta no tiene miembros registrados.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {j.miembros.map(m => (
                    <li key={m.id} className="min-w-0 rounded-lg border border-line p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={m.cargo === 'presidente' || m.cargo === 'tesorero' ? 'brand' : 'neutral'}>{cargoLabel(m.cargo)}</Badge>
                        <span className="break-words font-medium">{m.nombre}</span>
                      </p>
                      <p className="mt-1 break-words text-xs text-muted">{m.departamentos.length ? `Dpto. ${m.departamentos.join(', ')}` : `Sin departamento en el ${palabra}`}</p>
                      <p className="break-all text-xs text-muted">{m.email}</p>
                      {m.telefono && <p className="num text-xs text-muted">{m.telefono}</p>}
                    </li>
                  ))}
                  {/* Los cargos únicos sin nadie se ven como un hueco, para que se note que falta registrarlos. */}
                  {faltan.map(c => (
                    <li key={c} className="min-w-0 rounded-lg border border-dashed border-line p-3 text-sm">
                      <Badge tone="neutral">{cargoLabel(c)}</Badge>
                      <p className="mt-1 text-xs text-muted">Sin asignar{puedeGestionar ? ': agrégalo con «Editar».' : '.'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label={`Correo de ${deLaJunta}`}>
              <h3 className="mb-1 text-sm font-semibold">Correo de la junta</h3>
              <p className="break-all text-sm">{j.correo ?? <span className="text-muted">{`Sin correo: se usa el del ${palabra}, si lo hay.`}</span>}</p>
              {j.notas && <p className="mt-1 whitespace-pre-line break-words text-xs text-muted">{j.notas}</p>}
            </section>

            <section aria-label={`Cuenta de ${deLaJunta}`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Cuenta donde pagan los vecinos</h3>
                <Button variant="secondary" size="sm" icon={<PlusIcon className="h-4 w-4" />} onClick={() => onCuenta(j, 'nuevo')}>Agregar cuenta</Button>
              </div>
              {j.medios.length === 0
                ? <p className="text-sm text-muted">Aún no hay cuenta: agrega el banco, Yape o Plin de la junta para que los vecinos sepan cómo pagar.</p>
                : <ul className="grid gap-2">{j.medios.map(m => <Cuenta key={m.id} m={m} onEditar={() => onCuenta(j, m)} />)}</ul>}
            </section>

            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button variant="secondary" icon={<PencilSquareIcon className="h-4 w-4" />} onClick={() => onEditar(j)}>Editar</Button>
              {puedeGestionar && <Button variant="secondary" icon={<ArrowPathIcon className="h-4 w-4" />} onClick={() => onNuevaGestion(j)}>Nueva gestión</Button>}
              <Button variant="ghost" icon={<ClockIcon className="h-4 w-4" />} onClick={onHistorial} disabled={ficha.anteriores === 0}>Historial{ficha.anteriores > 0 ? ` (${ficha.anteriores})` : ''}</Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
