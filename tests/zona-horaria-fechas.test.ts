// Zona horaria por condominio, parte pura: las funciones de fecha con zona (Intl, sin offsets fijos) y el catálogo de zonas.
import './helpers/env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diaEn, hoyEn, medianocheEn, hoyLima, inicioAnioEn, inicioAnioLima, inicioMesEn, inicioMesLima, mesesAtras, mesesAtrasEn, mesesHasta } from '../src/server/lib/fechas';
import { PAISES, ZONA_POR_DEFECTO, esZonaHoraria, zonasDe } from '../src/lib/paises';

const utc = (s: string) => new Date(s);

describe('hoyEn: el día de calendario de una zona (00:00 UTC de ese día)', () => {
  it('a las 23:30 de Lima y de Ciudad de México es todavía el mismo día; en UTC ya es el siguiente', () => {
    const lima2330 = utc('2026-10-29T04:30:00Z'); // 23:30 del 28 en Lima (UTC−5)
    assert.equal(hoyEn('America/Lima', lima2330).toISOString(), '2026-10-28T00:00:00.000Z');
    assert.equal(diaEn(lima2330, 'UTC'), '2026-10-29');
    const mx2330 = utc('2026-10-29T05:30:00Z'); // 23:30 del 28 en Ciudad de México (UTC−6; sin horario de verano desde 2022)
    assert.equal(hoyEn('America/Mexico_City', mx2330).toISOString(), '2026-10-28T00:00:00.000Z');
    assert.equal(hoyEn('America/Lima', mx2330).toISOString(), '2026-10-29T00:00:00.000Z'); // a esa hora Lima ya está en el 29 (00:30)
  });

  it('con America/Lima da exactamente lo mismo que hoyLima, a cualquier hora', () => {
    for (let h = 0; h < 48; h++) {
      const t = new Date(Date.UTC(2026, 9, 27, 0, 0) + h * 1_800_000);
      assert.equal(hoyEn('America/Lima', t).getTime(), hoyLima(t).getTime(), t.toISOString());
    }
  });

  it('Madrid: el horario de verano no corre el día (23:00 UTC del 25-oct ya es el 26 en CET; con +02 sería a las 22:00)', () => {
    // 2026-10-25 03:00 CEST → 02:00 CET (se atrasa una hora). Antes: UTC+2; después: UTC+1.
    assert.equal(diaEn(utc('2026-10-25T21:59:00Z'), 'Europe/Madrid'), '2026-10-25'); // 23:59 CEST (+2)
    assert.equal(diaEn(utc('2026-10-25T22:30:00Z'), 'Europe/Madrid'), '2026-10-25'); // 23:30 CET (+1): con +2 fijo diría el 26
    assert.equal(diaEn(utc('2026-10-25T23:00:00Z'), 'Europe/Madrid'), '2026-10-26'); // 00:00 CET
    // y al revés, el día en que se adelanta (29-mar-2026, 02:00 CET → 03:00 CEST)
    assert.equal(diaEn(utc('2026-03-28T22:59:00Z'), 'Europe/Madrid'), '2026-03-28'); // 23:59 CET (+1)
    assert.equal(diaEn(utc('2026-03-28T23:00:00Z'), 'Europe/Madrid'), '2026-03-29'); // 00:00 CET
    assert.equal(diaEn(utc('2026-03-29T21:59:00Z'), 'Europe/Madrid'), '2026-03-29'); // 23:59 CEST (+2)
    assert.equal(diaEn(utc('2026-03-29T22:00:00Z'), 'Europe/Madrid'), '2026-03-30'); // 00:00 CEST
  });

  it('Santiago: el día cambia a las 03:00 UTC en verano (UTC−3) y a las 04:00 UTC en invierno (UTC−4)', () => {
    assert.equal(diaEn(utc('2026-01-15T02:59:00Z'), 'America/Santiago'), '2026-01-14'); // −03
    assert.equal(diaEn(utc('2026-01-15T03:00:00Z'), 'America/Santiago'), '2026-01-15');
    assert.equal(diaEn(utc('2026-07-15T03:59:00Z'), 'America/Santiago'), '2026-07-14'); // −04
    assert.equal(diaEn(utc('2026-07-15T04:00:00Z'), 'America/Santiago'), '2026-07-15');
  });

  it('diaEn devuelve aaaa-mm-dd; hoyEn y diaEn coinciden', () => {
    const t = utc('2026-02-28T23:59:59Z');
    for (const z of ['America/Lima', 'America/Santiago', 'Europe/Madrid', 'Pacific/Auckland', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
      assert.equal(hoyEn(z, t).toISOString().slice(0, 10), diaEn(t, z), z);
    }
  });
});

describe('inicioMesEn / inicioAnioEn: el instante en que empieza el mes (o el año) en esa zona', () => {
  it('Lima: igual que inicioMesLima e inicioAnioLima', () => {
    for (const s of ['2026-10-28T12:00:00Z', '2026-11-01T04:59:59Z', '2026-11-01T05:00:00Z', '2027-01-01T04:59:00Z', '2027-01-01T05:00:00Z']) {
      assert.equal(inicioMesEn('America/Lima', utc(s)).getTime(), inicioMesLima(utc(s)).getTime(), s);
      assert.equal(inicioAnioEn('America/Lima', utc(s)).getTime(), inicioAnioLima(utc(s)).getTime(), s);
    }
    assert.equal(inicioMesLima(utc('2026-10-28T12:00:00Z')).toISOString(), '2026-10-01T05:00:00.000Z');
  });

  it('Madrid: octubre empieza con UTC+2 y noviembre con UTC+1', () => {
    assert.equal(inicioMesEn('Europe/Madrid', utc('2026-10-28T12:00:00Z')).toISOString(), '2026-09-30T22:00:00.000Z');
    assert.equal(inicioMesEn('Europe/Madrid', utc('2026-11-15T12:00:00Z')).toISOString(), '2026-10-31T23:00:00.000Z');
    assert.equal(inicioAnioEn('Europe/Madrid', utc('2026-06-15T12:00:00Z')).toISOString(), '2025-12-31T23:00:00.000Z');
  });

  it('Santiago: septiembre empieza con UTC−4 y octubre con UTC−3 (el horario de verano arranca el 5-sep a las 24:00)', () => {
    assert.equal(inicioMesEn('America/Santiago', utc('2026-09-15T12:00:00Z')).toISOString(), '2026-09-01T04:00:00.000Z');
    assert.equal(inicioMesEn('America/Santiago', utc('2026-10-15T12:00:00Z')).toISOString(), '2026-10-01T03:00:00.000Z');
  });

  it('medianocheEn: el día en que el reloj salta de 23:59 a 01:00 no tiene medianoche; el día empieza en el salto', () => {
    assert.equal(medianocheEn('America/Santiago', 2026, 9, 6).toISOString(), '2026-09-06T04:00:00.000Z'); // 23:59 (−04) → 01:00 (−03)
    assert.equal(medianocheEn('America/Santiago', 2026, 9, 7).toISOString(), '2026-09-07T03:00:00.000Z');
    // Cuando el reloj se atrasa (4-abr, 24:00 → 23:00) la hora repetida es la 23:00; el día siguiente empieza una sola vez, ya en UTC−4.
    assert.equal(medianocheEn('America/Santiago', 2026, 4, 4).toISOString(), '2026-04-04T03:00:00.000Z');
    assert.equal(medianocheEn('America/Santiago', 2026, 4, 5).toISOString(), '2026-04-05T04:00:00.000Z');
    assert.equal(medianocheEn('America/Lima', 2026, 10, 1).toISOString(), '2026-10-01T05:00:00.000Z');
  });

  it('mesesAtrasEn: los meses terminan en el mes de HOY en esa zona, aunque en UTC ya sea otro', () => {
    const t = utc('2026-11-01T02:00:00Z'); // 31-oct 21:00 en Lima; 1-nov en UTC
    assert.equal(mesesAtrasEn('America/Lima', 1, t)[0]!.clave, '2026-10');
    assert.equal(mesesAtrasEn('Pacific/Auckland', 1, t)[0]!.clave, '2026-11'); // 15:00 del 1-nov en Auckland
    const seis = mesesAtrasEn('America/Lima', 6, t);
    assert.deepEqual(seis.map((m) => m.clave), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('mesesAtras y mesesHasta (los atajos de Lima) no cambian', () => {
    const t = utc('2026-10-28T12:00:00Z');
    assert.deepEqual(mesesAtras(3, t), mesesAtrasEn('America/Lima', 3, t));
    assert.deepEqual(mesesAtras(2, t), mesesHasta(2, 2026, 10));
    assert.equal(mesesHasta(1, 2026, 10)[0]!.desde.toISOString(), '2026-10-01T05:00:00.000Z');
    assert.equal(mesesHasta(1, 2026, 10)[0]!.hasta.toISOString(), '2026-11-01T05:00:00.000Z');
  });

  it('mesesHasta con zona: Madrid, el mes de octubre dura 745 horas (la del cambio de hora)', () => {
    const [oct] = mesesHasta(1, 2026, 10, 'Europe/Madrid');
    assert.equal((oct!.hasta.getTime() - oct!.desde.getTime()) / 3_600_000, 745);
    const [oct2] = mesesHasta(1, 2026, 10);
    assert.equal((oct2!.hasta.getTime() - oct2!.desde.getTime()) / 3_600_000, 744);
  });
});

describe('catálogo de zonas', () => {
  it('toda zona del catálogo es válida y la del país está entre las de su país', () => {
    for (const p of PAISES) {
      assert.ok(zonasDe(p.codigo).includes(p.zona_horaria), `${p.codigo}: la zona por defecto ${p.zona_horaria} debe estar en sus zonas`);
      for (const z of zonasDe(p.codigo)) assert.ok(esZonaHoraria(z), `${p.codigo}: ${z}`);
    }
  });

  it('los países con varias zonas ofrecen las suyas; Perú sólo una', () => {
    for (const c of ['MX', 'US', 'BR', 'AR', 'CL', 'EC', 'ES']) assert.ok(zonasDe(c).length > 1, c);
    assert.deepEqual(zonasDe('PE'), ['America/Lima']);
    assert.deepEqual(zonasDe('ZZ'), [ZONA_POR_DEFECTO]);
    assert.ok(zonasDe('MX').includes('America/Cancun') && zonasDe('ES').includes('Atlantic/Canary') && zonasDe('CL').includes('Pacific/Easter'));
  });

  it('esZonaHoraria: IANA válidas sí; basura, vacío y desfases sueltos no', () => {
    for (const z of ['America/Lima', 'Europe/Madrid', 'America/Argentina/Buenos_Aires', 'UTC']) assert.equal(esZonaHoraria(z), true, z);
    for (const z of ['', 'Lima', 'America/Limaa', 'GMT+5', '+05:00', 'America/Lima; DROP TABLE', '../etc', ' America/Lima']) assert.equal(esZonaHoraria(z), false, JSON.stringify(z));
  });
});
