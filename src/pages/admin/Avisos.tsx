import { PaginaComunicados } from './_parts/comunicados/PaginaComunicados';

/** `/admin/avisos` y `/junta/avisos` (enlaces viejos): la pestaña «Envíos» de la misma página de comunicados. */
export default function Avisos() {
  return <PaginaComunicados pestana="envios" />;
}
