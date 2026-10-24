/** Los tres puntos que rebotan mientras el asistente piensa (retrasos escalonados: se lee como una onda). */
const RETRASOS = ['0s', '0.2s', '0.4s'];

export function PuntosPensando() {
  return (
    <span className="inline-flex h-6 items-center gap-1" role="status" aria-label="Pensando">
      {RETRASOS.map((d) => <span key={d} className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: d }} />)}
    </span>
  );
}
