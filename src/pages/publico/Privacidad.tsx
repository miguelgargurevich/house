import { DocumentoLegal } from './legal/DocumentoLegal';
import { useDatosLegales } from './legal/datos';
import { textosPrivacidad } from './legal/textos';

/** Política de privacidad (Ley 29733): pública, sin sesión. Los datos del responsable vienen de la configuración del superadmin. */
export default function Privacidad() {
  const { datos, cargando } = useDatosLegales();
  const { intro, secciones } = textosPrivacidad({ datos, cargando });
  return <DocumentoLegal titulo="Política de privacidad" intro={intro} secciones={secciones} />;
}
