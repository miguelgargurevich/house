/** Un comunicado como lo ve el residente (`GET /api/me/comunicados`). El texto es plano: se pinta como texto, nunca como HTML. */
export interface ComunicadoResidente {
  id: number;
  titulo: string;
  cuerpo: string;
  fijado: boolean;
  created_at: string;
  complejo: { id: number; nombre: string } | null;
  /** null = para todo el condominio. */
  estructura: { id: number; nombre: string | null } | null;
  origen: 'administracion' | 'junta';
}

export const origenLabel = (o: ComunicadoResidente['origen']) => (o === 'junta' ? 'Junta directiva' : 'Administración');
export const alcanceDe = (c: Pick<ComunicadoResidente, 'estructura' | 'complejo'>) => (c.estructura ? (c.estructura.nombre?.trim() || `Block ${c.estructura.id}`) : c.complejo?.nombre ? `Todo ${c.complejo.nombre}` : 'Todo el condominio');
