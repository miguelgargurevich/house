import './helpers/env';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { esperar, prisma, sembrar, type Datos } from './helpers/app';
import { atenderMensaje } from '../src/server/services/canales/entrante';
import { limpiarLimites } from '../src/server/services/canales/limites';
import type { MensajeEntrante, Transporte } from '../src/server/services/canales/transporte';

// «SALIR» por WhatsApp: apaga los avisos por WhatsApp de las personas de ESA empresa con ese número, tenga o no vínculo con el bot.

const TEXTO_BAJA = 'Listo: ya no te enviaremos avisos por WhatsApp. Los seguirás recibiendo por correo. Para volver a activarlos, entra a Torre › Mi perfil.';
const NUM_PROP1 = '51987654321';
const NUM_PROP2 = '51922222222';
const NUM_SIN_NADIE = '51900000009';

let D: Datos;
let respuestas: string[] = [];
let seq = 0;

/** Transporte falso: lo que el bot respondería se guarda en `respuestas`. */
const transporte = (identificador: string, opts: { empresaId?: number | null; canal?: 'whatsapp' | 'telegram' } = {}): Transporte => ({
  canal: opts.canal ?? 'whatsapp',
  identificador,
  empresaId: opts.empresaId === undefined ? D.empresaA.id : opts.empresaId,
  responder: async (texto: string) => {
    respuestas.push(texto);
  },
  descargarMedio: async () => {
    throw new Error('no se usa en estas pruebas');
  },
});

const mensaje = (texto: string): MensajeEntrante => ({ mensajeId: `salir-${++seq}`, texto, medio: null, otro: false });

/** Lo que llega por WhatsApp de ese número a la empresa A (la instancia es de A). */
const escribe = (texto: string, identificador = NUM_PROP1) => atenderMensaje(transporte(identificador), mensaje(texto));

const avisoWa = async (usuario_id: number) => (await prisma.usuario.findUniqueOrThrow({ where: { id: usuario_id }, select: { aviso_whatsapp: true } })).aviso_whatsapp;
const reactivar = (ids: number[]) => prisma.usuario.updateMany({ where: { id: { in: ids } }, data: { aviso_whatsapp: true } });

after(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  D = await sembrar();
  respuestas = [];
  limpiarLimites();
  await prisma.usuario.updateMany({ data: { aviso_whatsapp: false, telefono: null } });
  // Persona de A con su número en el perfil (sin vincular al bot).
  await prisma.usuario.update({ where: { id: D.propietario1.id }, data: { telefono: '+51 987 654 321', aviso_whatsapp: true } });
  // Persona de A con número VERIFICADO (vínculo del bot vigente).
  await prisma.usuario.update({ where: { id: D.propietario2.id }, data: { telefono: '+51 922 222 222', aviso_whatsapp: true } });
  await prisma.canalVinculado.create({
    data: { usuario_id: D.propietario2.id, canal: 'whatsapp', identificador: NUM_PROP2, empresa_id: D.empresaA.id, verificado_at: new Date(), clave_vigente: `whatsapp:${NUM_PROP2}`, clave_usuario: `${D.propietario2.id}:whatsapp` },
  });
});

describe('SALIR por WhatsApp', () => {
  it('con vínculo vigente: apaga el aviso por WhatsApp de esa persona, responde el texto fijo y el vínculo sigue', async () => {
    await escribe('SALIR', NUM_PROP2);
    assert.equal(await avisoWa(D.propietario2.id), false);
    assert.deepEqual(respuestas, [TEXTO_BAJA]);
    const v = await prisma.canalVinculado.findFirstOrThrow({ where: { identificador: NUM_PROP2 } });
    assert.equal(v.revocado_at, null, 'darse de baja de avisos no desvincula el bot');
  });

  it('sin vínculo: apaga por el teléfono de su perfil (normalizado) de esa empresa', async () => {
    await escribe('SALIR', NUM_PROP1);
    assert.equal(await avisoWa(D.propietario1.id), false);
    assert.deepEqual(respuestas, [TEXTO_BAJA]);
  });

  it('variantes: mayúsculas, acentos, espacios alrededor y BAJA / STOP', async () => {
    for (const t of ['salir', 'SALIR', ' Salir ', 'Sálir', 'baja', 'BAJA', 'stop', 'Stop']) {
      await reactivar([D.propietario1.id]);
      respuestas = [];
      await escribe(t, NUM_PROP1);
      assert.equal(await avisoWa(D.propietario1.id), false, `«${t}» debe dar de baja`);
      assert.deepEqual(respuestas, [TEXTO_BAJA], `«${t}» responde el texto fijo`);
    }
  });

  it('no toca a una persona de OTRA empresa con el mismo número', async () => {
    // Misma persona física con el mismo celular, pero como propietaria de la empresa B.
    await prisma.usuario.update({ where: { id: D.propietarioB.id }, data: { telefono: '+51 987 654 321', aviso_whatsapp: true } });
    await escribe('SALIR', NUM_PROP1);
    assert.equal(await avisoWa(D.propietario1.id), false, 'la de A sí');
    assert.equal(await avisoWa(D.propietarioB.id), true, 'la de B no se toca');
  });

  it('un número que no es de nadie: responde lo mismo, no cambia a nadie y deja auditoría sin el número', async () => {
    const antes = await prisma.usuario.findMany({ select: { id: true, aviso_whatsapp: true }, orderBy: { id: 'asc' } });
    await escribe('SALIR', NUM_SIN_NADIE);
    assert.deepEqual(respuestas, [TEXTO_BAJA], 'la misma respuesta: no revela si existe');
    assert.deepEqual(await prisma.usuario.findMany({ select: { id: true, aviso_whatsapp: true }, orderBy: { id: 'asc' } }), antes);
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'baja_whatsapp' } }));
    assert.equal(fila.entidad, 'usuario');
    const volcado = JSON.stringify(fila);
    assert.ok(!volcado.includes(NUM_SIN_NADIE) && !volcado.includes(NUM_PROP1), 'la auditoría no lleva el número');
  });

  it('la baja con vínculo también deja auditoría (acción baja_whatsapp) sin el número', async () => {
    await escribe('SALIR', NUM_PROP2);
    const fila = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'baja_whatsapp' } }));
    assert.equal(fila.usuario_id, D.propietario2.id, 'una sola persona afectada: queda como autora del registro');
    assert.equal(fila.entidad_id, D.propietario2.id);
    assert.ok(!JSON.stringify(fila).includes(NUM_PROP2));
  });

  it('un vínculo de OTRA empresa con ese número no cuenta: no apaga a su persona', async () => {
    // Un solo vínculo por número en toda la base: la persona de B vinculó ESE celular con el bot de su empresa.
    await prisma.canalVinculado.create({
      data: { usuario_id: D.propietarioB.id, canal: 'whatsapp', identificador: NUM_PROP1, empresa_id: D.empresaB.id, verificado_at: new Date(), clave_vigente: `whatsapp:${NUM_PROP1}`, clave_usuario: `${D.propietarioB.id}:whatsapp` },
    });
    await prisma.usuario.update({ where: { id: D.propietarioB.id }, data: { aviso_whatsapp: true } });
    await escribe('SALIR', NUM_PROP1);
    assert.equal(await avisoWa(D.propietario1.id), false, 'la de A, por su perfil, sí');
    assert.equal(await avisoWa(D.propietarioB.id), true, 'la de B, por su vínculo de B, no se toca');
  });

  it('un texto que no es SALIR no da de baja a nadie', async () => {
    await escribe('hola, ¿cuánto debo?', NUM_PROP1);
    assert.equal(await avisoWa(D.propietario1.id), true);
    assert.notDeepEqual(respuestas, [TEXTO_BAJA]);
  });

  it('en Telegram no aplica: el mismo texto no apaga nada', async () => {
    await atenderMensaje(transporte(NUM_PROP1, { canal: 'telegram', empresaId: null }), mensaje('SALIR'));
    assert.equal(await avisoWa(D.propietario1.id), true);
    assert.notDeepEqual(respuestas, [TEXTO_BAJA]);
  });
});
