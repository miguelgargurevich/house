import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';
import type { CountryCode } from 'libphonenumber-js/max';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { cx } from './cx';
import { control, Field } from './Field';
import { desglosarTelefono, formatoNacional, paisesTelefono, parsearCelular, parsearTelefono, valorTelefono } from '../lib/telefono';
import type { PaisTelefono } from '../lib/telefono';

const PAISES = paisesTelefono();

const opcion = (p: PaisTelefono) => (
  <option key={p.codigo} value={p.codigo}>{`${p.bandera} ${p.nombre} ${p.prefijo}`}</option>
);

interface TelefonoInputProps extends Pick<InputHTMLAttributes<HTMLInputElement>, 'name' | 'disabled' | 'autoComplete' | 'required'> {
  label: string;
  /** Lo que guarda el formulario: `+51 987 654 321`. Un valor sin «+» (dato viejo) se lee como Perú. */
  value: string;
  onChange: (valor: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  /** WhatsApp, Yape o Plin: sólo celulares. Un fijo se marca al salir del campo. */
  soloCelular?: boolean;
  className?: string;
}

/**
 * Teléfono con selector de país (bandera, nombre y prefijo; Perú por defecto). El valor que recibe y entrega es el texto con el formato
 * internacional. Mientras se escribe se muestra lo que tecleó la persona; al salir del campo se acomoda con el espaciado del país.
 */
export const TelefonoInput = forwardRef<HTMLInputElement, TelefonoInputProps>(function TelefonoInput(
  { label, value, onChange, onBlur, error, hint, soloCelular = false, className, name, disabled, autoComplete, required },
  ref,
) {
  const inicial = desglosarTelefono(value);
  const [pais, setPais] = useState<CountryCode>(inicial.pais);
  const [texto, setTexto] = useState(formatoNacional(inicial.pais, inicial.nacional));
  const [tocado, setTocado] = useState(false);
  // Lo último que se entregó al formulario: si el valor cambia desde fuera (un reinicio, otro registro), el campo se repinta.
  const emitido = useRef(value);

  useEffect(() => {
    if (value === emitido.current) return;
    emitido.current = value;
    const d = desglosarTelefono(value);
    setPais(d.pais);
    setTexto(formatoNacional(d.pais, d.nacional));
  }, [value]);

  function emitir(p: CountryCode, nacional: string) {
    const v = valorTelefono(p, nacional);
    emitido.current = v;
    onChange(v);
  }

  function alEscribir(e: ChangeEvent<HTMLInputElement>) {
    const t = e.target.value;
    setTexto(t);
    if (t.trim().startsWith('+')) {
      // Con «+» el país lo dice el prefijo (así se pega un número de otro país).
      const d = desglosarTelefono(t, pais);
      setPais(d.pais);
      emitir(d.pais, d.nacional);
      return;
    }
    emitir(pais, t.replace(/\D/g, '').slice(0, 15));
  }

  function alElegirPais(e: ChangeEvent<HTMLSelectElement>) {
    const p = e.target.value as CountryCode;
    const nacional = desglosarTelefono(value, p).nacional;
    setPais(p);
    setTexto(formatoNacional(p, nacional));
    emitir(p, nacional);
  }

  function alSalir() {
    setTocado(true);
    setTexto(formatoNacional(pais, desglosarTelefono(emitido.current, pais).nacional));
    onBlur?.();
  }

  const invalido = tocado && value !== '' && !(soloCelular ? parsearCelular(value) : parsearTelefono(value));
  const mensaje = error ?? (invalido ? (soloCelular ? 'Usa un celular válido para el país elegido' : 'Teléfono inválido para el país elegido') : undefined);

  return (
    <Field label={label} error={mensaje} hint={hint} className={className}>
      {p => (
        <div className="flex gap-2">
          <span className="relative w-[9.5rem] shrink-0 sm:w-52">
            <select
              aria-label="País del teléfono"
              value={pais}
              onChange={alElegirPais}
              disabled={disabled}
              className={cx(control, 'h-10 appearance-none pl-3 pr-8')}
            >
              <optgroup label="Más usados">{PAISES.prioritarios.map(opcion)}</optgroup>
              <optgroup label="Otros países">{PAISES.resto.map(opcion)}</optgroup>
            </select>
            <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          </span>
          <input
            {...p}
            ref={ref}
            type="tel"
            inputMode="tel"
            name={name}
            disabled={disabled}
            required={required}
            autoComplete={autoComplete ?? 'tel-national'}
            value={texto}
            onChange={alEscribir}
            onBlur={alSalir}
            className={cx(control, 'h-10 min-w-0 flex-1')}
          />
        </div>
      )}
    </Field>
  );
});
