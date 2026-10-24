import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fechaCorta } from '../src/ui/format';

describe('fechaCorta', () => {
  it('una fecha de calendario (medianoche UTC) se muestra ese mismo día, no el anterior (caso real: vence el 15, salía 14)', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'America/Lima';
    try {
      assert.match(fechaCorta('2026-10-15T00:00:00.000Z'), /^15/);
      assert.match(fechaCorta(new Date(Date.UTC(2026, 0, 1))), /^01/);
      // Un momento con hora sigue en la zona local: 02:00 UTC del 15 es el 14 a las 21:00 en Lima.
      assert.match(fechaCorta('2026-10-15T02:00:00.000Z'), /^14/);
      assert.equal(fechaCorta(null), '—');
      assert.equal(fechaCorta('no-es-fecha'), '—');
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });
});
