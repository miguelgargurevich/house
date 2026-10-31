// Candado de la IA de vouchers en la validación: en Gratis y Básico, el aviso «¿Quieres que la IA valide este voucher?» sale desde el inicio
// (sin pedir evaluar) y ofrece Torre Pro al admin. Los componentes importan AuthContext (y con él api.ts, que lee import.meta.env de Vite),
// así que la estructura se fija con la fuente del componente, como en las demás pruebas *-ui.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const AVISO = 'src/pages/shared/_parts/AvisoModulo.tsx';
const PANEL = 'src/pages/shared/evaluacion.tsx';
const MODAL = 'src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx';

describe('aviso del voucher sin la IA (texto y enlace según el rol)', () => {
  it('la variante «voucher» lleva el título y el texto acordados', () => {
    const a = fuente(AVISO);
    assert.ok(a.includes("TITULO_AVISO_VOUCHER = '¿Quieres que la IA valide este voucher?'"));
    assert.ok(a.includes("TEXTO_AVISO_VOUCHER = 'Con Torre Pro, la IA lee el monto, la fecha y la cuenta de destino, los compara con el recibo y valida sola los que coinciden.'"));
    assert.match(a, /variante === 'voucher'/);
  });

  it('el admin pasa a Torre Pro desde Mi plan; la junta lo pide a su administración (sin enlace); el superadmin, como hoy', () => {
    const a = fuente(AVISO);
    assert.match(a, /rol === 'admin' \? \{ to: '\/admin\/mi-plan', texto: 'Pasar a Torre Pro' \}/);
    assert.match(a, /rol === 'superadmin' \? \{ to: '\/superadmin\/suscripciones', texto: 'Ver suscripciones' \}/);
    assert.match(a, /: 'Pídeselo a tu administración\.'/);
  });

  it('la variante no toca el aviso de módulo de siempre (sigue con «Verlo en Mi plan»)', () => {
    assert.match(fuente(AVISO), /'Verlo en Mi plan'/);
  });
});

describe('cuándo sale el aviso en el panel de evaluación', () => {
  it('el panel recibe la capacidad y, si no se sabe, manda la marca que dejó el servidor', () => {
    const p = fuente(PANEL);
    assert.match(p, /capacidadIA = null \}: Props\)/);
    assert.match(p, /capacidadIA\?: boolean \| null;/);
    assert.match(p, /const marcaSinModulo = evBruta\?\.estado === 'no_disponible' && esMotivoSinModulo\(evBruta\.error\);/);
  });

  it('sin la capacidad (Gratis o Básico) el aviso sale desde el inicio; con ella no sale', () => {
    const p = fuente(PANEL);
    assert.match(p, /const sinModulo = !evaluando && \(capacidadIA === false \|\| \(capacidadIA === null && marcaSinModulo\)\);/);
    assert.match(p, /\{sinModulo && <AvisoModulo modulo="ia_vouchers" variante="voucher" className="mt-2" \/>\}/);
  });

  it('el aviso sustituye a «Aún no se evaluó»: no salen los dos a la vez', () => {
    assert.match(fuente(PANEL), /\{!ev && !evaluando && !sinModulo && <p className="mt-2 text-sm text-muted">Aún no se evaluó este comprobante\.<\/p>\}/);
  });

  it('con la IA a la vista, una marca de antes de pasar a Pro no vuelve a decir «sin módulo»', () => {
    assert.match(fuente(PANEL), /const ev = capacidadIA === true && marcaSinModulo \? null : evBruta;/);
  });

  it('no se ofrece reintentar mientras el aviso está', () => {
    assert.match(fuente(PANEL), /\{puedeReevaluar && !sinModulo && <Button/);
  });
});

describe('quién sabe la capacidad y cómo (sin IA ni evaluación)', () => {
  const hook = (() => {
    const p = fuente(PANEL);
    const ini = p.indexOf('export function useCapacidadIA');
    const fin = p.indexOf('// ---------- Lo que ve el residente');
    assert.ok(ini > 0 && fin > ini, 'el hook useCapacidadIA existe antes de la parte del residente');
    return p.slice(ini, fin);
  })();

  it('sólo el admin consulta /api/comercial/mi-plan (la junta y el superadmin no)', () => {
    assert.match(hook, /const admin = user\?\.rol === 'admin';/);
    assert.match(hook, /if \(!admin \|\| complejoId == null\) return;/);
    assert.match(hook, /api<\{ condominios: \{ complejo_id: number; modulos_activos: string\[\] \}\[\] \}>\('\/api\/comercial\/mi-plan'\)/);
  });

  it('lee ia_vouchers del condominio del pago y, si no lo halla, no sabe (null)', () => {
    assert.match(hook, /c\.modulos_activos\.includes\('ia_vouchers'\) : null/);
    assert.match(hook, /\.catch\(\(\) => \{ if \(vivo\) setCapacidad\(null\); \}\);/);
  });

  it('el hook nunca pide una evaluación ni llama a la IA', () => {
    assert.doesNotMatch(hook, /\/evaluacion/);
    assert.doesNotMatch(hook, /method: 'POST'/);
  });

  it('el modal de validar pasa el condominio del pago y la capacidad al panel', () => {
    const m = fuente(MODAL);
    assert.match(m, /useCapacidadIA\(pago\?\.unidad\?\.complejo\?\.id \?\? null\)/);
    assert.match(m, /capacidadIA=\{capacidadIA\}/);
    assert.match(m, /import \{ EvaluacionPanel, useCapacidadIA, useEvaluacionCompleta \} from '\.\.\/\.\.\/\.\.\/shared\/evaluacion';/);
  });
});
