import { paletaDeMarca, type MarcaUsuario } from '../../../lib/marca';

export interface CabeceraDeDocumento { nombre: string | null; logoUrl: string | null; color: string | null }

/**
 * Qué lleva la cabecera de un documento (recibo, estado de cuenta, rendición): logo y nombre de la empresa que lo emite y, sólo con la marca propia activa, su color.
 * La marca del usuario se aplica ÚNICAMENTE si es la de la empresa del documento (por id, o por razón social cuando el documento no trae el id): un residente con
 * departamentos en dos empresas no ve el nombre ni el color de una en el documento de la otra. Si no corresponde, razón social y sin color.
 */
export function cabeceraDeDocumento(marca: MarcaUsuario, doc: { empresaId?: number | null; razonSocial?: string | null; logoUrl?: string | null }): CabeceraDeDocumento {
  const propia = marca.empresa_id != null && (doc.empresaId != null ? doc.empresaId === marca.empresa_id : doc.razonSocial != null && doc.razonSocial === marca.razon_social);
  const activa = propia && marca.activa;
  return {
    nombre: activa ? marca.nombre : doc.razonSocial ?? null,
    logoUrl: doc.logoUrl ?? (propia ? marca.logo_url : null),
    // El documento es una hoja blanca en los dos temas: la franja usa el color del tema claro, ya ajustado por contraste.
    color: activa && marca.color ? paletaDeMarca(marca.color).hex.claro.brand : null,
  };
}

/**
 * Cabecera de un documento que antes no llevaba la de la empresa (rendición del mes): sólo sale con la marca propia activa. Sin ella el documento queda como siempre.
 * `razonSocial`: si el documento la trae, debe ser la de la empresa de la marca.
 */
export function cabeceraSoloConMarca(marca: MarcaUsuario, razonSocial?: string | null): CabeceraDeDocumento {
  const vacia = { nombre: null, logoUrl: null, color: null };
  if (!marca.activa || (razonSocial != null && razonSocial !== marca.razon_social)) return vacia;
  return cabeceraDeDocumento(marca, { empresaId: marca.empresa_id, razonSocial: marca.razon_social });
}
