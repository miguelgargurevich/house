import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Usuarios
  const admin = await prisma.usuario.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      nombre: 'Admin Demo',
      email: 'admin@demo.com',
      telefono: '123456789',
      rol: 'admin',
      password_hash: 'admin123',
    },
  });
  const user1 = await prisma.usuario.upsert({
    where: { email: 'user1@demo.com' },
    update: {},
    create: {
      nombre: 'Juan Pérez',
      email: 'user1@demo.com',
      telefono: '987654321',
      rol: 'propietario',
      password_hash: 'user123',
    },
  });
  const user2 = await prisma.usuario.upsert({
    where: { email: 'user2@demo.com' },
    update: {},
    create: {
      nombre: 'Ana García',
      email: 'user2@demo.com',
      telefono: '555666777',
      rol: 'propietario',
      password_hash: 'user456',
    },
  });

  // Empresas Administradoras
  const empresa1 = await prisma.empresaAdministradora.create({
    data: {
      nombre: 'Gestión Propiedades SAC',
      ruc: '20123456789',
      direccion: 'Av. Principal 123',
      telefono: '111222333',
      email: 'contacto@gestionprop.com',
      representante_legal: 'Carlos López',
      fecha_inicio: new Date('2020-01-01'),
      estado: 'activa',
    },
  });
  const empresa2 = await prisma.empresaAdministradora.create({
    data: {
      nombre: 'AdminCondo S.A.',
      ruc: '20987654321',
      direccion: 'Calle Secundaria 456',
      telefono: '444555666',
      email: 'info@admincondo.com',
      representante_legal: 'María Torres',
      fecha_inicio: new Date('2021-06-15'),
      estado: 'activa',
    },
  });

  // Complejos Habitacionales
  const complejo1 = await prisma.complejoHabitacional.create({
    data: {
      nombre: 'Residencial Los Álamos',
      tipo: 'Condominio',
      direccion: 'Av. Los Álamos 100',
      empresa: { connect: { id: empresa1.id } },
      descripcion: 'Condominio familiar con áreas verdes',
    },
  });
  const complejo2 = await prisma.complejoHabitacional.create({
    data: {
      nombre: 'Torre Central',
      tipo: 'Edificio',
      direccion: 'Jr. Central 200',
      empresa: { connect: { id: empresa2.id } },
      descripcion: 'Edificio moderno en el centro',
    },
  });

  // Estructuras
  const estructura1 = await prisma.estructura.create({
    data: {
      nombre: 'Bloque A',
      tipo: 'Bloque',
      complejo: { connect: { id: complejo1.id } },
    },
  });
  const estructura2 = await prisma.estructura.create({
    data: {
      nombre: 'Bloque B',
      tipo: 'Bloque',
      complejo: { connect: { id: complejo1.id } },
    },
  });

  // Pisos
  const piso1 = await prisma.piso.create({
    data: {
      numero: 1,
      estructura: { connect: { id: estructura1.id } },
    },
  });
  const piso2 = await prisma.piso.create({
    data: {
      numero: 2,
      estructura: { connect: { id: estructura1.id } },
    },
  });

  // Unidades
  const unidad1 = await prisma.unidad.create({
    data: {
      codigo: 'A101',
      tipo: 'Departamento',
      descripcion: 'Departamento primer piso',
      propietario: { connect: { id: user1.id } },
      empresa: { connect: { id: empresa1.id } },
      complejo: { connect: { id: complejo1.id } },
      estructura: { connect: { id: estructura1.id } },
      piso: { connect: { id: piso1.id } },
    },
  });
  const unidad2 = await prisma.unidad.create({
    data: {
      codigo: 'A201',
      tipo: 'Departamento',
      descripcion: 'Departamento segundo piso',
      propietario: { connect: { id: user2.id } },
      empresa: { connect: { id: empresa1.id } },
      complejo: { connect: { id: complejo1.id } },
      estructura: { connect: { id: estructura1.id } },
      piso: { connect: { id: piso2.id } },
    },
  });
  const unidad3 = await prisma.unidad.create({
    data: {
      codigo: 'B101',
      tipo: 'Departamento',
      descripcion: 'Bloque B primer piso',
      propietario: { connect: { id: user1.id } },
      empresa: { connect: { id: empresa1.id } },
      complejo: { connect: { id: complejo1.id } },
      estructura: { connect: { id: estructura2.id } },
    },
  });

  // Conceptos
  const concepto1 = await prisma.concepto.create({
    data: {
      nombre: 'Mantenimiento',
      descripcion: 'Cuota mensual de mantenimiento',
      tipo_monto: 'fijo',
      empresa: { connect: { id: empresa1.id } },
      activo: true,
    },
  });
  const concepto2 = await prisma.concepto.create({
    data: {
      nombre: 'Agua',
      descripcion: 'Consumo de agua',
      tipo_monto: 'variable',
      empresa: { connect: { id: empresa1.id } },
      activo: true,
    },
  });

  // Recibos
  const recibo1 = await prisma.recibo.create({
    data: {
      descripcion: 'Recibo julio 2025',
      fecha_emision: new Date('2025-07-01'),
      fecha_vencimiento: new Date('2025-07-15'),
      mes: 7,
      anio: 2025,
      estado: 'emitido',
      empresa: { connect: { id: empresa1.id } },
      complejo: { connect: { id: complejo1.id } },
      creado_por: { connect: { id: admin.id } },
    },
  });

  // ReciboConceptos
  const reciboConcepto1 = await prisma.reciboConcepto.create({
    data: {
      recibo: { connect: { id: recibo1.id } },
      concepto: { connect: { id: concepto1.id } },
      monto: 150.00,
      es_recargo: false,
      orden: 1,
    },
  });
  const reciboConcepto2 = await prisma.reciboConcepto.create({
    data: {
      recibo: { connect: { id: recibo1.id } },
      concepto: { connect: { id: concepto2.id } },
      monto: 30.50,
      es_recargo: false,
      orden: 2,
    },
  });

  // ReciboConceptoUnidades
  const rcu1 = await prisma.reciboConceptoUnidad.create({
    data: {
      reciboConcepto: { connect: { id: reciboConcepto1.id } },
      unidad: { connect: { id: unidad1.id } },
      monto: 150.00,
      estado_pago: 'pendiente',
    },
  });
  const rcu2 = await prisma.reciboConceptoUnidad.create({
    data: {
      reciboConcepto: { connect: { id: reciboConcepto2.id } },
      unidad: { connect: { id: unidad1.id } },
      monto: 30.50,
      estado_pago: 'pendiente',
    },
  });

  // Pagos
  await prisma.pago.create({
    data: {
      reciboConceptoUnidad: { connect: { id: rcu1.id } },
      monto: 150.00,
      usuario: { connect: { id: user1.id } },
      metodo_pago: 'transferencia',
      referencia: 'TRX123',
      observaciones: 'Pago completo',
    },
  });
  await prisma.pago.create({
    data: {
      reciboConceptoUnidad: { connect: { id: rcu2.id } },
      monto: 30.50,
      usuario: { connect: { id: user1.id } },
      metodo_pago: 'efectivo',
      referencia: 'EF456',
      observaciones: 'Pago parcial',
    },
  });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
