

import { PrismaClient, type Usuario, type EmpresaAdministradora, type Concepto, type ComplejoHabitacional, type Estructura, type Piso, type Unidad, type Recibo } from '@prisma/client';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();

// Cost 12 como en la API; se cachea por contraseña para no pagar 100+ hashes lentos en cada siembra.
const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const hashes = new Map<string, string>();
async function hash(password: string) {
  let h = hashes.get(password);
  if (!h) {
    h = await bcrypt.hash(password, 12);
    hashes.set(password, h);
  }
  return h;
}

async function main() {
  // Eliminar datos existentes
  await prisma.auditoria.deleteMany({});
  await prisma.pago.deleteMany({});
  await prisma.reciboConceptoUnidad.deleteMany({});
  await prisma.reciboConcepto.deleteMany({});
  await prisma.recibo.deleteMany({});
  await prisma.concepto.deleteMany({});
  await prisma.tareaMantenimiento.deleteMany({});
  await prisma.unidad.deleteMany({});
  await prisma.piso.deleteMany({});
  await prisma.estructura.deleteMany({});
  await prisma.complejoHabitacional.deleteMany({});
  await prisma.empresaAdministradora.deleteMany({});
  await prisma.usuario.deleteMany({});

  // Empresas administradoras reales
  const empresasArr = [
    { nombre: 'Gestión Urbana SAC', ruc: '20123456789', direccion: 'Av. Javier Prado 1234, Lima', telefono: '012345678', email: 'contacto@gestionurbana.com', representante_legal: 'Rosa Benavides', estado: 'activa' },
    { nombre: 'Edifica Perú S.A.', ruc: '20456789123', direccion: 'Calle Los Laureles 456, Miraflores', telefono: '014567890', email: 'info@edificaperu.com', representante_legal: 'Juan Espinoza', estado: 'activa' },
    { nombre: 'Condominios Modernos SRL', ruc: '20567891234', direccion: 'Jr. Amazonas 789, San Isidro', telefono: '016789012', email: 'admin@condominiosmodernos.com', representante_legal: 'Patricia León', estado: 'activa' },
    { nombre: 'Residenciales del Sur', ruc: '20678912345', direccion: 'Av. Benavides 321, Surco', telefono: '017890123', email: 'contacto@residencialesdelsur.com', representante_legal: 'Carlos Paredes', estado: 'activa' },
  ];
  let empresasDb: EmpresaAdministradora[] = [];
  for (const empresa of empresasArr) {
    const e = await prisma.empresaAdministradora.create({ data: empresa });
    empresasDb.push(e);
  }

  // Usuarios reales (crear uno por uno para obtener IDs)
  const usuariosData = [
    // Superadmins globales
    { nombre: 'Miguel Gargurevich', email: 'miguel.gargurevich@admin.com', telefono: '987654321', rol: 'superadmin', password: 'admin1234' },
    { nombre: 'Lucía Torres', email: 'lucia.torres@admin.com', telefono: '987654322', rol: 'superadmin', password: 'admin1234' },
    { nombre: 'Carlos Rivas', email: 'carlos.rivas@admin.com', telefono: '987654323', rol: 'superadmin', password: 'admin1234' },
    // Personal por empresa (más usuarios por empresa)
    // Gestión Urbana SAC
    { nombre: 'Ana López', email: 'ana.lopez@gestionurbana.com', telefono: '987654324', rol: 'admin', password: 'admin1234', empresa: 0 },
    { nombre: 'Pedro Sánchez', email: 'pedro.sanchez@gestionurbana.com', telefono: '987654325', rol: 'seguridad', password: 'seg1234', empresa: 0 },
    { nombre: 'María Fernández', email: 'maria.fernandez@gestionurbana.com', telefono: '987654326', rol: 'mantenimiento', password: 'mtto1234', empresa: 0 },
    { nombre: 'Laura Gutiérrez', email: 'laura.gutierrez@gestionurbana.com', telefono: '987654350', rol: 'admin', password: 'admin1234', empresa: 0 },
    { nombre: 'Ricardo Peña', email: 'ricardo.pena@gestionurbana.com', telefono: '987654351', rol: 'seguridad', password: 'seg1234', empresa: 0 },
    { nombre: 'Silvia Torres', email: 'silvia.torres@gestionurbana.com', telefono: '987654352', rol: 'mantenimiento', password: 'mtto1234', empresa: 0 },
    // Edifica Perú S.A.
    { nombre: 'Sonia Paredes', email: 'sonia.paredes@edificaperu.com', telefono: '987654328', rol: 'admin', password: 'admin1234', empresa: 1 },
    { nombre: 'Raúl Torres', email: 'raul.torres@edificaperu.com', telefono: '987654329', rol: 'seguridad', password: 'seg1234', empresa: 1 },
    { nombre: 'Patricia León', email: 'patricia.leon@edificaperu.com', telefono: '987654330', rol: 'mantenimiento', password: 'mtto1234', empresa: 1 },
    { nombre: 'Alfredo Díaz', email: 'alfredo.diaz@edificaperu.com', telefono: '987654354', rol: 'admin', password: 'admin1234', empresa: 1 },
    { nombre: 'Mónica Vera', email: 'monica.vera@edificaperu.com', telefono: '987654355', rol: 'seguridad', password: 'seg1234', empresa: 1 },
    { nombre: 'Esteban Bravo', email: 'esteban.bravo@edificaperu.com', telefono: '987654356', rol: 'mantenimiento', password: 'mtto1234', empresa: 1 },
    // Condominios Modernos SRL
    { nombre: 'Jorge Medina', email: 'jorge.medina@condominiosmodernos.com', telefono: '987654332', rol: 'admin', password: 'admin1234', empresa: 2 },
    { nombre: 'Luis Vargas', email: 'luis.vargas@condominiosmodernos.com', telefono: '987654333', rol: 'seguridad', password: 'seg1234', empresa: 2 },
    { nombre: 'Elena Salas', email: 'elena.salas@condominiosmodernos.com', telefono: '987654334', rol: 'mantenimiento', password: 'mtto1234', empresa: 2 },
    { nombre: 'Natalia Cueva', email: 'natalia.cueva@condominiosmodernos.com', telefono: '987654358', rol: 'admin', password: 'admin1234', empresa: 2 },
    { nombre: 'Hugo Ponce', email: 'hugo.ponce@condominiosmodernos.com', telefono: '987654359', rol: 'seguridad', password: 'seg1234', empresa: 2 },
    { nombre: 'Rocío Díaz', email: 'rocio.diaz@condominiosmodernos.com', telefono: '987654360', rol: 'mantenimiento', password: 'mtto1234', empresa: 2 },
    // Residenciales del Sur
    { nombre: 'Patricia León', email: 'patricia.leon@residencialesdelsur.com', telefono: '987654336', rol: 'admin', password: 'admin1234', empresa: 3 },
    { nombre: 'Carlos Paredes', email: 'carlos.paredes@residencialesdelsur.com', telefono: '987654337', rol: 'seguridad', password: 'seg1234', empresa: 3 },
    { nombre: 'Rosa Benavides', email: 'rosa.benavides@residencialesdelsur.com', telefono: '987654338', rol: 'mantenimiento', password: 'mtto1234', empresa: 3 },
    { nombre: 'Andrea Salazar', email: 'andrea.salazar@residencialesdelsur.com', telefono: '987654362', rol: 'admin', password: 'admin1234', empresa: 3 },
    { nombre: 'Mario Rivas', email: 'mario.rivas@residencialesdelsur.com', telefono: '987654363', rol: 'seguridad', password: 'seg1234', empresa: 3 },
    { nombre: 'Verónica Paz', email: 'veronica.paz@residencialesdelsur.com', telefono: '987654364', rol: 'mantenimiento', password: 'mtto1234', empresa: 3 },
    // Propietarios e inquilinos (sin empresa)
    { nombre: 'Javier Castro', email: 'javier.castro@prop.com', telefono: '987654340', rol: 'propietario', password: 'prop1234' },
    { nombre: 'Sofía Ramírez', email: 'sofia.ramirez@prop.com', telefono: '987654341', rol: 'propietario', password: 'prop1234' },
    { nombre: 'Gabriel Medina', email: 'gabriel.medina@prop.com', telefono: '987654342', rol: 'propietario', password: 'prop1234' },
    { nombre: 'Valentina Ruiz', email: 'valentina.ruiz@inq.com', telefono: '987654343', rol: 'inquilino', password: 'inq1234' },
    { nombre: 'Martín Herrera', email: 'martin.herrera@inq.com', telefono: '987654344', rol: 'inquilino', password: 'inq1234' },
    { nombre: 'Camila Paredes', email: 'camila.paredes@inq.com', telefono: '987654345', rol: 'inquilino', password: 'inq1234' },
    { nombre: 'Lucas Bravo', email: 'lucas.bravo@inq.com', telefono: '987654346', rol: 'inquilino', password: 'inq1234' },
    { nombre: 'Daniela Soto', email: 'daniela.soto@prop.com', telefono: '987654347', rol: 'propietario', password: 'prop1234' },
    { nombre: 'Emilia Torres', email: 'emilia.torres@prop.com', telefono: '987654348', rol: 'propietario', password: 'prop1234' },
    { nombre: 'Tomás Ríos', email: 'tomas.rios@inq.com', telefono: '987654349', rol: 'inquilino', password: 'inq1234' },
  ];

  // ...el resto del código permanece igual...

  // ...declaraciones y creación de conceptos y complejos ya están antes, eliminar duplicados aquí...

  // ...
  // (Mover este bloque justo después de la creación de complejosDb)
  // ...

  // ...el resto del código permanece igual...

  // Conceptos realistas
  const conceptosArr = [
    { nombre: 'Mantenimiento mensual', descripcion: 'Cuota mensual de mantenimiento de áreas comunes', tipo_monto: 'fijo', activo: true, empresa_id: empresasDb[0].id },
    { nombre: 'Fondo de reserva', descripcion: 'Aporte para fondo de emergencias del edificio', tipo_monto: 'fijo', activo: true, empresa_id: empresasDb[1].id },
    { nombre: 'Agua', descripcion: 'Consumo de agua potable', tipo_monto: 'variable', activo: true, empresa_id: empresasDb[2].id },
    { nombre: 'Luz común', descripcion: 'Consumo eléctrico de áreas comunes', tipo_monto: 'variable', activo: true, empresa_id: empresasDb[3].id },
    { nombre: 'Vigilancia', descripcion: 'Servicio de seguridad y vigilancia', tipo_monto: 'fijo', activo: true, empresa_id: empresasDb[0].id },
    { nombre: 'Ascensor', descripcion: 'Mantenimiento de ascensores', tipo_monto: 'fijo', activo: true, empresa_id: empresasDb[2].id },
    { nombre: 'Jardinería', descripcion: 'Mantenimiento de jardines', tipo_monto: 'fijo', activo: true, empresa_id: empresasDb[3].id },
  ];
  let conceptosDb: Concepto[] = [];
  for (const concepto of conceptosArr) {
    const c = await prisma.concepto.create({ data: concepto });
    conceptosDb.push(c);
  }

  // Complejos habitacionales realistas
  const complejosArr = [
    { nombre: 'Condominio Los Libertadores de Surco', tipo: 'Condominio', direccion: 'Av. Libertadores 1500, Surco', empresa_id: empresasDb[0].id, descripcion: 'Condominio con 14 torres, 32 departamentos por torre, áreas verdes y zona de juegos.' },
    { nombre: 'Residencial Los Álamos', tipo: 'Edificio', direccion: 'Av. Primavera 100, Surco', empresa_id: empresasDb[0].id, descripcion: 'Conjunto de 3 torres con áreas verdes y piscina.' },
    { nombre: 'Condominio El Bosque', tipo: 'Condominio', direccion: 'Calle Cipreses 200, La Molina', empresa_id: empresasDb[1].id, descripcion: 'Condominio cerrado con seguridad 24h.' },
    { nombre: 'Torre Central', tipo: 'Edificio', direccion: 'Jr. Central 300, San Borja', empresa_id: empresasDb[2].id, descripcion: 'Edificio moderno de 15 pisos.' },
    { nombre: 'Residencial Mirador', tipo: 'Edificio', direccion: 'Av. Mirador 400, Magdalena', empresa_id: empresasDb[3].id, descripcion: 'Edificio con vista al mar.' },
    { nombre: 'Condominio Las Palmeras', tipo: 'Condominio', direccion: 'Av. Palmeras 1200, San Miguel', empresa_id: empresasDb[0].id, descripcion: 'Conjunto residencial con gimnasio y sala de eventos.' },
    { nombre: 'Residencial Altavista', tipo: 'Edificio', direccion: 'Calle Las Lomas 250, Chorrillos', empresa_id: empresasDb[1].id, descripcion: 'Edificio con departamentos dúplex y ascensor panorámico.' },
    { nombre: 'Villa Jardín', tipo: 'Condominio', direccion: 'Pasaje Gardenias 155, Surquillo', empresa_id: empresasDb[2].id, descripcion: 'Condominio familiar con áreas comunes y parque interno.' },
    { nombre: 'Residencial Aurora', tipo: 'Edificio', direccion: 'Av. Arequipa 1890, Lince', empresa_id: empresasDb[3].id, descripcion: 'Edificio de oficinas y departamentos con cochera.' },
    { nombre: 'Torre Sol', tipo: 'Torre', direccion: 'Av. El Sol 500, Barranco', empresa_id: empresasDb[0].id, descripcion: 'Torre moderna con coworking y rooftop.' },
  ];
  let complejosDb: ComplejoHabitacional[] = [];
  for (const complejo of complejosArr) {
    const c = await prisma.complejoHabitacional.create({ data: complejo });
    complejosDb.push(c);
  }


  // --- CREACIÓN DE USUARIOS (después de empresas, conceptos y complejos) ---
  let usuariosDb: Usuario[] = [];
  // Primero, crear superadmins globales
  for (const u of usuariosData.filter(u => u.rol === 'superadmin')) {
    let data: any = {
      nombre: u.nombre,
      email: u.email,
      telefono: u.telefono,
      rol: u.rol,
      password_hash: await hash(u.password),
    };
    const user = await prisma.usuario.create({ data });
    usuariosDb.push(user);
  }

  // Para cada empresa, repartir personal entre los complejos de esa empresa
  for (let empresaIdx = 0; empresaIdx < empresasDb.length; empresaIdx++) {
    const empresa = empresasDb[empresaIdx];
    const complejosEmpresa = complejosDb.filter(c => c.empresa_id === empresa.id);
    const roles = ['admin', 'seguridad', 'mantenimiento'];
    // Filtrar usuarios de este empresa y rol
    let personalEmpresa = usuariosData.filter(u => u.empresa === empresaIdx && roles.includes(u.rol));
    // Si hay menos personal que complejos, crear más usuarios para cubrir todos los complejos
    while (personalEmpresa.length < complejosEmpresa.length * roles.length) {
      const nextRol = roles[personalEmpresa.length % roles.length];
      // Listas de nombres y apellidos realistas para personal
      const nombresPersonal = {
        admin: ['Ana', 'Laura', 'Sonia', 'Alfredo', 'Natalia', 'Andrea', 'Miguel', 'Lucía', 'Carlos', 'Patricia', 'Jorge', 'Luis', 'Elena', 'Diego', 'Hugo', 'Rocío', 'Felipe', 'Mario', 'Verónica', 'Gustavo'],
        seguridad: ['Pedro', 'Ricardo', 'Raúl', 'Mónica', 'Hugo', 'Mario', 'Carlos', 'Jorge', 'Sergio', 'Esteban', 'Julio', 'Axel', 'Samuel', 'Iván', 'Gonzalo', 'Esteban', 'Julio', 'Axel', 'Samuel', 'Iván'],
        mantenimiento: ['María', 'Silvia', 'Patricia', 'Esteban', 'Rocío', 'Verónica', 'Rosa', 'Gabriel', 'Fernando', 'Ignacio', 'Héctor', 'Rafael', 'Sergio', 'Julio', 'Axel', 'Samuel', 'Iván', 'Gonzalo', 'Esteban', 'Julio'],
      };
      const apellidosPersonal = ['Ramírez', 'García', 'Torres', 'Paredes', 'Soto', 'Vargas', 'León', 'Bravo', 'Salas', 'Ríos', 'Cueva', 'Paz', 'Medina', 'Rivas', 'Díaz', 'Benavides', 'Espinoza', 'Fernández', 'Peña', 'Gutiérrez'];
      const nombre = nombresPersonal[nextRol][personalEmpresa.length % nombresPersonal[nextRol].length];
      const apellido = apellidosPersonal[personalEmpresa.length % apellidosPersonal.length];
      const email = sinTildes(`${nombre.toLowerCase()}.${apellido.toLowerCase()}${empresaIdx}${personalEmpresa.length}@${empresa.nombre.replace(/\s/g, '').toLowerCase()}.com`);
      const telefono = `9${(empresaIdx * 100000 + personalEmpresa.length + 10000000).toString().padStart(8, '0')}`;
      personalEmpresa.push({
        nombre: `${nombre} ${apellido}`,
        email,
        telefono,
        rol: nextRol,
        password: `${nextRol}1234`,
        empresa: empresaIdx
      });
    }
    // Repartir personal entre complejos
    let personalIdx = 0;
    for (const complejo of complejosEmpresa) {
      for (const rol of roles) {
        const u = personalEmpresa[personalIdx];
        let data: any = {
          nombre: u.nombre,
          email: u.email,
          telefono: u.telefono,
          rol: u.rol,
          password_hash: await hash(u.password),
          empresa_id: empresa.id,
          complejo_id: complejo.id,
        };
        const user = await prisma.usuario.create({ data });
        usuariosDb.push(user);
        personalIdx++;
      }
    }
  }

  // Propietarios e inquilinos: asignar a complejos de forma repartida
  const residentes = usuariosData.filter(u => u.rol === 'propietario' || u.rol === 'inquilino');
  const pools: Record<string, typeof residentes> = {
    propietario: residentes.filter(u => u.rol === 'propietario'),
    inquilino: residentes.filter(u => u.rol === 'inquilino'),
  };
  const usados: Record<string, number> = { propietario: 0, inquilino: 0 };
  let residenteIdx = 0;
  for (const complejo of complejosDb) {
    // 2 propietarios y 2 inquilinos por complejo: primero los de la lista, luego generados
    for (const rol of ['propietario', 'inquilino']) {
      for (let i = 0; i < 2; i++) {
        let u = pools[rol][usados[rol]];
        if (u) usados[rol]++;
        else {
          const nombres = rol === 'propietario'
            ? ['Marina', 'Alonso', 'Cecilia', 'Joaquín', 'Rafael', 'Isabel', 'Fernando', 'Paula', 'Sergio', 'Lorena', 'Ignacio', 'Claudia', 'Héctor', 'Patricia', 'Gonzalo', 'Andrea', 'Julio', 'Valeria', 'Esteban', 'Marta']
            : ['Bruno', 'Camila', 'Matías', 'Renata', 'Emilio', 'Luciana', 'Tomás', 'Gabriela', 'Nicolás', 'Jimena', 'Samuel', 'Ariana', 'Damián', 'Bianca', 'Iván', 'Florencia', 'Axel', 'Julieta', 'Simón', 'Agustina'];
          const apellidos = ['Ramírez', 'García', 'Torres', 'Paredes', 'Soto', 'Vargas', 'León', 'Bravo', 'Salas', 'Ríos', 'Cueva', 'Paz', 'Medina', 'Rivas', 'Díaz', 'Benavides', 'Espinoza', 'Fernández', 'Peña', 'Gutiérrez'];
          const nombre = nombres[residenteIdx % nombres.length];
          const apellido = apellidos[residenteIdx % apellidos.length];
          u = {
            nombre: `${nombre} ${apellido}`,
            email: sinTildes(`${nombre.toLowerCase()}.${apellido.toLowerCase()}${residenteIdx}@mail.com`),
            telefono: `9${(residenteIdx + 10000000).toString().padStart(8, '0')}`,
            rol,
            password: `${rol}1234`,
          };
        }
        const user = await prisma.usuario.create({
          data: {
            nombre: u.nombre,
            email: u.email,
            telefono: u.telefono,
            rol: u.rol,
            password_hash: await hash(u.password),
            empresa_id: complejo.empresa_id,
            complejo_id: complejo.id,
          },
        });
        usuariosDb.push(user);
        residenteIdx++;
      }
    }
  }

  // --- CREACIÓN DE UNIDADES, TAREAS Y RECIBOS (después de usuariosDb) ---
  // Variables globales para estructuras, pisos y unidades
  let estructurasDb: Estructura[] = [];
  let pisosDb: Piso[] = [];
  const propietarios = usuariosDb.filter(u => u.rol === 'propietario');
  const complejoPorId = new Map(complejosDb.map(c => [c.id, c]));
  // El propietario de una unidad es siempre un propietario del mismo complejo (y por tanto de su misma empresa)
  const propietarioDe = (complejoId: number, n: number) => {
    const delComplejo = propietarios.filter(p => p.complejo_id === complejoId);
    return delComplejo[n % delComplejo.length];
  };
  let unidadesDb: Unidad[] = [];
  let unidadCount = 1;

  // Estructuras (torres, bloques)
  // Para cada complejo, crear al menos una estructura (torre/bloque) con nombre y tipo según el tipo del complejo
  for (const complejo of complejosDb) {
    // Si es el nuevo condominio especial, crear 14 torres, cada una con 8 pisos y 4 departamentos por piso
    if (complejo.nombre === 'Condominio Los Libertadores de Surco') {
      for (let t = 1; t <= 14; t++) {
        const torre = await prisma.estructura.create({ data: { nombre: `Torre ${t}`, tipo: 'Torre', complejo_id: complejo.id } });
        estructurasDb.push(torre);
        // 8 pisos por torre
        for (let p = 1; p <= 8; p++) {
          const piso = await prisma.piso.create({ data: { numero: p, estructura_id: torre.id } });
          pisosDb.push(piso);
          // 4 departamentos por piso
          for (let d = 1; d <= 4; d++) {
            const u = await prisma.unidad.create({
              data: {
                codigo: `LIB-T${t}-P${p}-D${d}`,
                tipo: 'Departamento',
                estructura_id: torre.id,
                piso_id: piso.id,
                complejo_id: complejo.id,
                descripcion: `Departamento Torre ${t} Piso ${p} Dpto ${d}`,
                propietario_id: propietarioDe(complejo.id, t * p * d).id,
                empresa_id: complejo.empresa_id,
                estado: 'activa',
              },
            });
            unidadesDb.push(u);
            unidadCount++;
          }
        }
      }
      continue; // Saltar el resto del loop para este complejo
    }
    // Si es Edificio o Torre, crear una torre principal, si es Condominio, crear un bloque principal
    let nombre = '';
    let tipo = '';
    if (complejo.tipo.toLowerCase().includes('torre')) {
      nombre = 'Torre Principal';
      tipo = 'Torre';
    } else if (complejo.tipo.toLowerCase().includes('bloque')) {
      nombre = 'Bloque Principal';
      tipo = 'Bloque';
    } else if (complejo.tipo.toLowerCase().includes('condominio')) {
      nombre = 'Bloque Principal';
      tipo = 'Bloque';
    } else {
      nombre = 'Torre Principal';
      tipo = 'Torre';
    }
    // Para los primeros 4 complejos, mantener la variedad original
    if (complejo.nombre === 'Residencial Los Álamos') {
      estructurasDb.push(await prisma.estructura.create({ data: { nombre: 'Torre A', tipo: 'Torre', complejo_id: complejo.id } }));
      estructurasDb.push(await prisma.estructura.create({ data: { nombre: 'Torre B', tipo: 'Torre', complejo_id: complejo.id } }));
    } else if (complejo.nombre === 'Condominio El Bosque') {
      estructurasDb.push(await prisma.estructura.create({ data: { nombre: 'Bloque 1', tipo: 'Bloque', complejo_id: complejo.id } }));
      estructurasDb.push(await prisma.estructura.create({ data: { nombre: 'Bloque 2', tipo: 'Bloque', complejo_id: complejo.id } }));
    } else if (complejo.nombre === 'Torre Central') {
      estructurasDb.push(await prisma.estructura.create({ data: { nombre: 'Torre Única', tipo: 'Torre', complejo_id: complejo.id } }));
    } else if (complejo.nombre === 'Residencial Mirador') {
      estructurasDb.push(await prisma.estructura.create({ data: { nombre: 'Torre Vista', tipo: 'Torre', complejo_id: complejo.id } }));
    } else {
      estructurasDb.push(await prisma.estructura.create({ data: { nombre, tipo, complejo_id: complejo.id } }));
    }
  }

  // Pisos (por estructura)
  for (const estructura of estructurasDb) {
    // Si la estructura es de un complejo tipo "Edificio" o "Torre", 3 pisos; si es "Condominio" o "Bloque", 2 pisos
    const complejo = complejosDb.find(c => c.id === estructura.complejo_id);
    let numPisos = 3;
    if (complejo && (complejo.tipo.toLowerCase().includes('condominio') || estructura.tipo === 'Bloque')) {
      numPisos = 2;
    }
    for (let i = 1; i <= numPisos; i++) {
      const p = await prisma.piso.create({ data: { numero: i, estructura_id: estructura.id } });
      pisosDb.push(p);
    }
  }

  // Unidades (departamentos)
  for (const piso of pisosDb) {
    // Si el piso pertenece a una estructura tipo "Torre" o "Edificio", 2 unidades por piso; si es "Bloque" o "Condominio", 3 unidades por piso
    const estructura = estructurasDb.find(e => e.id === piso.estructura_id);
    let numUnidades = 2;
    if (estructura && estructura.tipo === 'Bloque') {
      numUnidades = 3;
    }
    for (let i = 1; i <= numUnidades; i++) {
      const u = await prisma.unidad.create({
        data: {
          codigo: `Dpto-${unidadCount}`,
          tipo: 'Departamento',
          estructura_id: piso.estructura_id,
          piso_id: piso.id,
          complejo_id: estructura?.complejo_id,
          descripcion: `Departamento ${unidadCount} con vista panorámica`,
          propietario_id: propietarioDe(estructura!.complejo_id!, unidadCount).id,
          empresa_id: complejoPorId.get(estructura!.complejo_id!)!.empresa_id,
          estado: 'activa',
        },
      });
      unidadesDb.push(u);
      unidadCount++;
    }
  }

  // Tareas de Mantenimiento realistas
  const mantenimientos = [
    { titulo: 'Reparación de ascensor', descripcion: 'El ascensor de la Torre A presenta fallas intermitentes.', estado: 'pendiente' },
    { titulo: 'Pintura de fachada', descripcion: 'Se requiere pintar la fachada del Bloque 1.', estado: 'en_progreso' },
    { titulo: 'Cambio de luminarias', descripcion: 'Reemplazo de luces LED en áreas comunes.', estado: 'completada' },
    { titulo: 'Limpieza de cisterna', descripcion: 'Limpieza anual de la cisterna de agua.', estado: 'pendiente' },
    { titulo: 'Mantenimiento de piscina', descripcion: 'Revisión y limpieza de la piscina principal.', estado: 'en_progreso' },
    { titulo: 'Reparación de portón', descripcion: 'El portón eléctrico no cierra correctamente.', estado: 'pendiente' },
  ];
  const mttoUsers = usuariosDb.filter(u => u.rol === 'mantenimiento');
  for (let i = 0; i < mantenimientos.length; i++) {
    await prisma.tareaMantenimiento.create({
      data: {
        ...mantenimientos[i],
        unidad_id: unidadesDb[i % unidadesDb.length].id,
        asignado_id: mttoUsers[i % mttoUsers.length].id,
        creado_por_id: usuariosDb[0].id,
      },
    });
  }

  // Inquilinos: cada uno ocupa una unidad distinta de las de su complejo
  const inquilinos = usuariosDb.filter(u => u.rol === 'inquilino');
  for (const complejo of complejosDb) {
    const unidadesComplejo = unidadesDb.filter(u => u.complejo_id === complejo.id);
    const delComplejo = inquilinos.filter(i => i.complejo_id === complejo.id);
    for (const [k, inq] of delComplejo.entries()) {
      await prisma.unidad.update({ where: { id: unidadesComplejo[k * 2 + 1].id }, data: { inquilino_id: inq.id } });
    }
  }

  // Recibos de los últimos 3 meses por complejo; un cargo por unidad y concepto, con mezcla de pagados / pendientes / vencidos
  const superadmin = usuariosDb.find(u => u.rol === 'superadmin');
  const hoy = new Date();
  const dia = 24 * 60 * 60 * 1000;
  const periodos = [
    { atras: 2, vence: new Date(hoy.getTime() - 50 * dia), pagados: 80 },
    { atras: 1, vence: new Date(hoy.getTime() - 20 * dia), pagados: 55 },
    { atras: 0, vence: new Date(hoy.getTime() + 15 * dia), pagados: 25 },
  ];
  for (const complejo of complejosDb) {
    const conceptosEmpresa = conceptosDb.filter(c => c.empresa_id === complejo.empresa_id).slice(0, 2);
    const unidadesComplejo = unidadesDb.filter(u => u.complejo_id === complejo.id);
    for (const per of periodos) {
      const f = new Date(hoy.getFullYear(), hoy.getMonth() - per.atras, 1);
      const recibo: Recibo = await prisma.recibo.create({
        data: {
          descripcion: `Cuota de ${f.toLocaleString('es-PE', { month: 'long' })} ${f.getFullYear()} - ${complejo.nombre}`,
          fecha_emision: f,
          fecha_vencimiento: per.vence,
          mes: f.getMonth() + 1,
          anio: f.getFullYear(),
          estado: 'emitido',
          empresa_id: complejo.empresa_id,
          complejo_id: complejo.id,
          creado_por_id: superadmin?.id,
        },
      });
      for (const [ci, concepto] of conceptosEmpresa.entries()) {
        const monto = ci === 0 ? 180 : 60;
        const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, es_recargo: false, orden: ci + 1 } });
        const pagadoEn = new Date(Math.min(hoy.getTime(), per.vence.getTime()) - 3 * dia);
        await prisma.reciboConceptoUnidad.createMany({
          data: unidadesComplejo.map((u, ui) => {
            const pagado = (ui * 7 + ci * 3) % 100 < per.pagados;
            return { recibo_concepto_id: rc.id, unidad_id: u.id, monto, estado_pago: pagado ? 'pagado' : 'pendiente', fecha_pago: pagado ? pagadoEn : null };
          }),
        });
        const pagados = await prisma.reciboConceptoUnidad.findMany({ where: { recibo_concepto_id: rc.id, estado_pago: 'pagado' }, select: { id: true, unidad_id: true, monto: true, fecha_pago: true } });
        await prisma.pago.createMany({
          data: pagados.map((c, pi) => ({
            recibo_concepto_unidad_id: c.id,
            monto: c.monto,
            fecha_pago: c.fecha_pago ?? pagadoEn,
            usuario_id: unidadesComplejo.find(u => u.id === c.unidad_id)?.propietario_id ?? null,
            metodo_pago: ['transferencia', 'yape', 'plin', 'efectivo', 'tarjeta'][pi % 5],
            referencia: `TRX-${recibo.id}-${c.id}`,
            observaciones: `Pago de ${concepto.nombre}`,
          })),
        });
      }
    }
  }

  console.log('Seed realista completado.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());


