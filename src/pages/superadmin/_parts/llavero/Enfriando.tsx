import { useEffect, useState } from 'react';
import { Badge } from '../../../../ui';

function formato(seg: number): string {
  if (seg < 60) return `${seg} s`;
  return `${Math.floor(seg / 60)} min ${String(seg % 60).padStart(2, '0')} s`;
}

/** Cuenta atrás de una clave enfriada. Sólo este componente se re-renderiza cada segundo, y desaparece solo al llegar a cero. */
export function Enfriando({ hasta }: { hasta: string | null }) {
  const fin = hasta ? Date.parse(hasta) : NaN;
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    if (Number.isNaN(fin)) return;
    setAhora(Date.now());
    const t = setInterval(() => {
      setAhora(Date.now());
      if (Date.now() >= fin) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [fin]);

  const restante = Math.ceil((fin - ahora) / 1000);
  if (Number.isNaN(fin) || restante <= 0) return null;
  return <Badge tone="warn">Enfriando <span className="num">{formato(restante)}</span></Badge>;
}
