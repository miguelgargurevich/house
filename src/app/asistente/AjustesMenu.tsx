import { useId } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { Alert, Button, Select, Tabs, cx } from '../../ui';
import { AJUSTES_DEFECTO, LIMITES, NOMBRE_ESFUERZO, avisoEsfuerzo, cambiarParametro, elegirPreset } from './ajustes';
import type { Ajustes, Esfuerzo, ModeloOpcion, OpcionesChat, Parametros, PresetId } from './tipos';

interface Props {
  opciones: OpcionesChat;
  ajustes: Ajustes;
  onChange: (a: Ajustes) => void;
}

const ORDEN_CATEGORIAS = ['razonamiento', 'rapido', 'equilibrado', 'avanzado'] as const;
const NOMBRE_CATEGORIA: Record<(typeof ORDEN_CATEGORIAS)[number], string> = { razonamiento: 'Razonamiento', rapido: 'Rápido', equilibrado: 'Equilibrado', avanzado: 'Avanzado' };

const BARRAS: { campo: keyof Parametros; etiqueta: string; ayuda: string; formato: (v: number) => string }[] = [
  { campo: 'temperature', etiqueta: 'Temperatura', ayuda: 'Más alta, respuestas más variadas.', formato: (v) => v.toFixed(2) },
  { campo: 'maxTokens', etiqueta: 'Largo máximo', ayuda: 'Tope de la respuesta, en tokens.', formato: (v) => String(v) },
  { campo: 'topP', etiqueta: 'Top‑p', ayuda: 'Cuánto del vocabulario probable se considera.', formato: (v) => v.toFixed(2) },
  { campo: 'topK', etiqueta: 'Top‑k', ayuda: 'Cuántas palabras candidatas se consideran.', formato: (v) => String(v) },
];

/** «Ajustes» del compositor: modelo (sólo admin y superadmin), creatividad (todos, con los topes del servidor) y esfuerzo (sólo admin y superadmin). */
export function AjustesMenu({ opciones, ajustes, onChange }: Props) {
  const id = useId();
  const porCategoria = (c: string): ModeloOpcion[] => opciones.modelos.filter((m) => m.categoria === c);
  const tope = Math.min(opciones.max_tokens, LIMITES.maxTokens.max);

  return (
    <div className="space-y-5">
      {opciones.puede_elegir_modelo && (
        <Select
          label="Modelo"
          hint={ajustes.modelo === 'auto' ? 'Auto elige el mejor modelo disponible y prueba otro si uno falla.' : 'Si este modelo no responde, el asistente te lo dirá: no cambia de modelo por su cuenta.'}
          value={ajustes.modelo}
          onChange={(e) => onChange({ ...ajustes, modelo: e.target.value })}
        >
          <option value="auto">Auto (recomendado)</option>
          {ORDEN_CATEGORIAS.map((c) => {
            const lista = porCategoria(c);
            return lista.length ? (
              <optgroup key={c} label={NOMBRE_CATEGORIA[c]}>
                {lista.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.gratis ? ' · Gratis' : ''} ({m.proveedor})</option>)}
              </optgroup>
            ) : null;
          })}
        </Select>
      )}

      <fieldset>
        <legend className="text-sm font-medium">Creatividad</legend>
        <div className="mt-2 space-y-1.5">
          {opciones.presets.map((p) => {
            const marcada = ajustes.preset === p.id;
            return (
              <label key={p.id} className={cx('flex min-h-11 cursor-pointer items-start gap-3 rounded border px-3 py-2 transition-colors duration-150', marcada ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface2')}>
                <input type="radio" name={`${id}-preset`} value={p.id} checked={marcada} onChange={() => onChange(elegirPreset(ajustes, p.id as PresetId, opciones.presets))} className="mt-1 h-4 w-4 accent-brand" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{p.nombre}</span>
                  <span className="block text-xs text-muted">{p.detalle}</span>
                </span>
              </label>
            );
          })}
        </div>
        {ajustes.preset === 'a_medida' && (
          <div className="mt-3 space-y-3 rounded border border-line p-3">
            {BARRAS.map(({ campo, etiqueta, ayuda, formato }) => {
              const lim = campo === 'maxTokens' ? { ...LIMITES.maxTokens, max: tope } : LIMITES[campo];
              const barraId = `${id}-${campo}`;
              return (
                <div key={campo}>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={barraId} className="text-sm font-medium">{etiqueta}</label>
                    <output htmlFor={barraId} className="num text-sm text-muted">{formato(ajustes.parametros[campo])}</output>
                  </div>
                  <input
                    id={barraId}
                    type="range"
                    min={lim.min}
                    max={lim.max}
                    step={lim.paso}
                    value={ajustes.parametros[campo]}
                    onChange={(e) => onChange(cambiarParametro(ajustes, campo, Number(e.target.value)))}
                    aria-describedby={`${barraId}-ayuda`}
                    className="mt-1 h-8 w-full accent-brand"
                  />
                  <p id={`${barraId}-ayuda`} className="text-xs text-muted">{ayuda}</p>
                </div>
              );
            })}
          </div>
        )}
        {!opciones.puede_elegir_modelo && opciones.max_tokens <= 1024 && <p className="mt-2 text-xs text-muted">Las respuestas tienen un largo máximo de {opciones.max_tokens} tokens.</p>}
      </fieldset>

      {opciones.puede_elegir_esfuerzo && (
        <div>
          <p id={`${id}-esfuerzo`} className="text-sm font-medium">Esfuerzo de razonamiento</p>
          <div className="mt-2">
            <Tabs<Esfuerzo>
              label="Esfuerzo de razonamiento"
              value={ajustes.esfuerzo}
              onChange={(esfuerzo) => onChange({ ...ajustes, esfuerzo })}
              items={opciones.esfuerzos.map((e) => ({ id: e, label: NOMBRE_ESFUERZO[e] }))}
            />
          </div>
          {(() => { const aviso = avisoEsfuerzo(ajustes, opciones); return aviso ? <div className="mt-2"><Alert tone="info">{aviso}</Alert></div> : <p className="mt-2 text-xs text-muted">Más esfuerzo, respuestas más pensadas (y algo más lentas).</p>; })()}
        </div>
      )}

      <Button variant="ghost" size="sm" icon={<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />} onClick={() => onChange({ ...AJUSTES_DEFECTO })}>Restablecer ajustes</Button>
    </div>
  );
}
