interface Props { pagado: number; pendiente: number; vencido: number }

const FILAS = [
  { key: 'pagado', label: 'Pagados', color: 'bg-ok/80' },
  { key: 'pendiente', label: 'Pendientes', color: 'bg-warn/80' },
  { key: 'vencido', label: 'Vencidos', color: 'bg-bad/80' },
] as const;

/** Barras de progreso por estado de cargo (pagado / pendiente / vencido). */
export function EstadoCargos(estados: Props) {
  const total = estados.pagado + estados.pendiente + estados.vencido || 1;
  return (
    <div className="space-y-4">
      {FILAS.map(f => (
        <div key={f.key}>
          <div className="mb-1.5 flex justify-between text-sm"><span>{f.label}</span><span className="num font-medium">{estados[f.key]}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface2"><div className={`h-full rounded-full ${f.color}`} style={{ width: `${(estados[f.key] / total) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
