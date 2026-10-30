import { Select } from '../../../../ui';
import { opcionesAnio, opcionesMes } from './vista';

interface Props { mes: number; anio: number; anioActual: number; onChange: (p: { mes: number; anio: number }) => void }

/** Mes y año del cierre. */
export function PeriodoSelect({ mes, anio, anioActual, onChange }: Props) {
  const anios = opcionesAnio(anioActual);
  if (!anios.includes(anio)) anios.unshift(anio);
  return (
    <div className="grid grid-cols-2 gap-3 sm:w-80">
      <Select label="Mes" value={mes} onChange={e => onChange({ mes: Number(e.target.value), anio })}>
        {opcionesMes.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
      <Select label="Año" value={anio} onChange={e => onChange({ mes, anio: Number(e.target.value) })}>
        {anios.map(a => <option key={a} value={a}>{a}</option>)}
      </Select>
    </div>
  );
}
