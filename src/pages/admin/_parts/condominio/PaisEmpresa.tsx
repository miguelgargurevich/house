import { useState } from 'react';
import { api, errorText } from '../../../../api';
import { PAISES, monedaDe, monedaDelPais, paisDe } from '../../../../lib/paises';
import { Button, Select, useToast } from '../../../../ui';

/** País de la empresa administradora: el que se propone (con su moneda) a los condominios nuevos. Los que ya existen conservan el suyo. */
export function PaisEmpresa({ empresaId, pais, onCambio }: { empresaId: number; pais: string; onCambio: () => void }) {
  const toast = useToast();
  const [valor, setValor] = useState(pais);
  const [guardando, setGuardando] = useState(false);
  const moneda = monedaDe(monedaDelPais(valor));

  async function guardar() {
    setGuardando(true);
    try {
      await api(`/api/empresas/${empresaId}`, { method: 'PUT', json: { pais: valor } });
      toast.ok('País de la empresa guardado');
      onCambio();
    } catch (e) { toast.error(errorText(e)); } finally { setGuardando(false); }
  }

  return (
    <section aria-labelledby="pais-empresa" className="mt-6 border-t border-line pt-5">
      <h3 id="pais-empresa" className="mb-3 text-sm font-semibold">País y moneda</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="País de la empresa" className="w-full sm:w-64" value={valor} onChange={e => setValor(e.target.value)}
          hint={`Los condominios nuevos nacen en ${paisDe(valor)?.nombre ?? 'ese país'} con ${moneda?.nombre.toLowerCase() ?? 'su moneda'} (${moneda?.codigo}); cada condominio puede cambiar su moneda al crearlo o editarlo.`}>
          {PAISES.map(p => <option key={p.codigo} value={p.codigo}>{p.bandera} {p.nombre}</option>)}
        </Select>
        <Button variant="secondary" className="mb-6" loading={guardando} disabled={valor === pais} onClick={() => void guardar()}>Guardar país</Button>
      </div>
    </section>
  );
}
