import { useState } from 'react';
import { PageHeader } from '../../ui';
import { CierreCentral } from './_parts/cierres/CierreCentral';
import { PeriodoSelect } from './_parts/cierres/PeriodoSelect';
import { periodoPorDefecto } from './_parts/cierres/vista';

/**
 * «Cierre de la Junta central» (menú de la Junta central): lo que entra a su cuenta (aportes de los blocks, alquiler de estacionamientos, otros ingresos),
 * lo que paga (servicios y proveedores de áreas comunes), el saldo del mes y el Fondo de ahorros. Registra el tesorero central; el presidente lo ve.
 */
export default function CierresCentral() {
  const [periodo, setPeriodo] = useState(periodoPorDefecto);
  return (
    <>
      <PageHeader
        title="Cierre de la Junta central"
        description="Lo que entra y sale de la cuenta de la Junta central al cerrar el mes: los aportes de los blocks, el alquiler de estacionamientos, los pagos de servicios y proveedores, con su voucher."
      />
      <div className="mb-5"><PeriodoSelect mes={periodo.mes} anio={periodo.anio} anioActual={new Date().getFullYear()} onChange={setPeriodo} /></div>
      <CierreCentral complejoId={null} mes={periodo.mes} anio={periodo.anio} />
    </>
  );
}
