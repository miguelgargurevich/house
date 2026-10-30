import { DocumentoLegal } from './legal/DocumentoLegal';
import { useDatosLegales } from './legal/datos';
import { textosTerminos } from './legal/textos';

/** Términos y condiciones: pública, sin sesión. Lo que se acepta en el registro. */
export default function Terminos() {
  const { datos, cargando } = useDatosLegales();
  const { intro, secciones } = textosTerminos({ datos, cargando });
  return <DocumentoLegal titulo="Términos y condiciones" intro={intro} secciones={secciones} />;
}
