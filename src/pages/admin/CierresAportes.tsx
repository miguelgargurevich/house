import { useState } from 'react';
import { PageHeader } from '../../ui';
import { PeriodoSelect } from './_parts/cierres/PeriodoSelect';
import { TablaAportes } from './_parts/cierres/TablaAportes';
import { periodoPorDefecto } from './_parts/cierres/vista';

/** «Aportes de los blocks» (Junta central): lo que cada block transfirió a la cuenta de la Junta central en el mes. El tesorero central confirma que llegó. */
export default function CierresAportes() {
  const [periodo, setPeriodo] = useState(periodoPorDefecto);
  return (
    <>
      <PageHeader
        title="Aportes de los blocks"
        description="Lo que cada block transfirió a la cuenta de la Junta central al cerrar el mes: sus conceptos «del condominio». El tesorero central confirma que el dinero llegó."
      />
      <div className="mb-5"><PeriodoSelect mes={periodo.mes} anio={periodo.anio} anioActual={new Date().getFullYear()} onChange={setPeriodo} /></div>
      <TablaAportes complejoId={null} mes={periodo.mes} anio={periodo.anio} destino="central" />
    </>
  );
}
