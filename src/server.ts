
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';

// Configuración Swagger
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'House API',
    version: '1.0.0',
    description: 'Documentación de la API de House SaaS multi-tenant',
  },
  servers: [
    { url: '/', description: 'Servidor actual' },
  ],
};
const swaggerOptions = {
  swaggerDefinition,
  apis: ['./src/server.ts'], // Puedes agregar más archivos si documentas con JSDoc
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Helper para obtener PrismaClient por request (serverless friendly)
function getPrisma() {
  return new PrismaClient();
}

// Middleware de autenticación (JWT simulado para desarrollo)
function authenticateToken(req: Request & { user?: any }, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    // En producción, usa tu clave secreta real
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'devsecret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido' });
  }
}

// Middleware de autorización por rol
function authorizeRoles(...roles: string[]) {
  return (req: Request & { user?: any }, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permisos suficientes' });
    }
    next();
  };
}

const app = express();

// Swagger UI endpoint
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(cors());
app.use(express.json());
// Endpoint de login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }
  try {
    const prisma = getPrisma();
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    if (!usuario.password_hash) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const validPassword = await bcrypt.compare(password, usuario.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    // Generar JWT
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET || 'devsecret',
      { expiresIn: '12h' }
    );
    res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } });
  } catch (error) {
    res.status(500).json({ error: 'Error en login', detalle: error instanceof Error ? error.message : error });
  }
});
// Endpoint para el chat de IA (Gemini)
app.post('/api/ai-chat', async (req, res) => {
  // LOG de depuración: body y headers
  console.log('--- [IA CHAT] Body recibido:', req.body);
  console.log('--- [IA CHAT] Headers:', req.headers);
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Método no permitido' } });
  }
  const GEMINI_MODEL = 'gemini-2.0-flash';
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: { message: 'La clave de API de IA no está configurada en el servidor. Por favor, contacta al administrador.' } });
  }

  try {
    let message = '';
    let context = '';
    let sentiment = '';
    let sessionId = '';
    let conversationContext = '';
    let userSentiment = '';
    if (req.body) {
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        message = req.body.message || '';
      } else {
        ({ message, context, sentiment, sessionId, conversationContext, userSentiment } = req.body);
      }
    }
    if (!message) return res.status(400).json({ error: { message: 'El mensaje es obligatorio.' } });

    // Leer el systemPrompt desde archivo externo (nueva ubicación)
    let systemPrompt = '';
    try {
      const promptPath = path.join(process.cwd(), 'src', 'config', 'ai-system-prompt.txt');
      systemPrompt = fs.readFileSync(promptPath, 'utf8');
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo leer el systemPrompt.' });
    }

    let enhancedPrompt = `${systemPrompt}\n`;
    if (conversationContext) enhancedPrompt += `CONTEXTO DE LA CONVERSACIÓN:\n${conversationContext}\n`;
    else if (context) enhancedPrompt += `CONVERSACIÓN PREVIA:\n${context}\n`;

    const sentimentData = userSentiment || sentiment;
    if (sentimentData) {
      let label = '';
      let score = '';
      if (typeof sentimentData === 'object' && sentimentData !== null) {
        label = (sentimentData as any).label || '';
        score = (sentimentData as any).score || '';
      }
      enhancedPrompt += `ANÁLISIS DE SENTIMIENTO DEL CLIENTE:\n- Sentimiento: ${label} (puntuación: ${score})\n`;
      if (label && typeof label === 'string' && label.includes('negative')) {
        enhancedPrompt += `- INSTRUCCIÓN: El cliente muestra sentimiento negativo. Usa un tono empático.\n`;
      } else if (label && typeof label === 'string' && label.includes('positive')) {
        enhancedPrompt += `- INSTRUCCIÓN: El cliente muestra entusiasmo. Mantén el tono positivo.\n`;
      }
      enhancedPrompt += `\n`;
    }
    if (sessionId) enhancedPrompt += `ID de Sesión: ${sessionId}\n`;
    enhancedPrompt += `\nMENSAJE DEL USUARIO:\n${message}\n`;

    const body = {
      contents: [
        { role: 'user', parts: [{ text: enhancedPrompt }] }
      ]
    };

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let data;
    try {
      data = await response.json();
    } catch (jsonErr) {
      data = {};
    }
    if (!response || typeof data !== 'object') {
      return res.status(503).json({ error: {
        code: 503,
        message: 'El servidor de IA no está disponible actualmente. Por favor, asegúrate de que el backend esté en funcionamiento o intenta más tarde.'
      }});
    }
    if (!response.ok) {
      if (response.status === 429) {
        return res.status(429).json({ error: {
          code: 429,
          message: 'La IA está temporalmente saturada o se ha superado la cuota gratuita. Por favor, intenta nuevamente en unos minutos o contáctanos si el problema persiste.'
        }});
      }
      if (response.status === 0 || !response.status) {
        return res.status(503).json({ error: {
          code: 503,
          message: 'No se pudo conectar con el servicio de IA. Por favor, revisa tu conexión o intenta más tarde.'
        }});
      }
      if (data && typeof data === 'object' && 'error' in data && (data as any).error && (data as any).error.message) {
        return res.status(response.status).json({ error: {
          code: response.status,
          message: (data as any).error.message
        }});
      }
      return res.status(response.status).json({ error: {
        code: response.status,
        message: 'El servidor de IA no pudo responder correctamente. Por favor, intenta de nuevo más tarde o contacta soporte si el problema persiste.'
      }});
    }

    let text = '';
    if (data && typeof data === 'object' && 'candidates' in data && Array.isArray((data as any).candidates)) {
      text = (data as any).candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    text = text.replace(/€(\d+)/g, '$$$1 USD');
    if (!text.trim()) {
      return res.status(503).json({ error: {
        code: 503,
        message: 'El servidor de IA no está disponible actualmente. Por favor, intenta de nuevo más tarde.'
      }});
    }
    return res.status(200).json({ response: text });
  } catch (error) {
    return res.status(503).json({ error: {
      code: 503,
      message: 'El servidor de IA no está disponible actualmente. Por favor, asegúrate de que el backend esté en funcionamiento o intenta más tarde.'
    }});
  }
});



// Endpoint de prueba: obtener todos los usuarios

// CRUD Usuarios
// Obtener todos los usuarios
app.get('/api/usuarios', async (_req, res) => {
  try {
    const usuarios = await getPrisma().usuario.findMany();
    res.json(usuarios);
  } catch (error) {
    console.error('Error real al obtener usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios', detalle: error instanceof Error ? error.message : error });
  }
});

// Obtener usuario por ID
app.get('/api/usuarios/:id', async (req, res) => {
  try {
    const usuario = await getPrisma().usuario.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// Crear usuario
app.post('/api/usuarios', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const { nombre, email, telefono, rol, password_hash } = req.body;
    const usuario = await getPrisma().usuario.create({
      data: { nombre, email, telefono, rol, password_hash },
    });
    res.status(201).json(usuario);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// Actualizar usuario
app.put('/api/usuarios/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const { nombre, email, telefono, rol, password_hash } = req.body;
    const usuario = await getPrisma().usuario.update({
      where: { id: Number(req.params.id) },
      data: { nombre, email, telefono, rol, password_hash },
    });
    res.json(usuario);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// Eliminar usuario
app.delete('/api/usuarios/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().usuario.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// CRUD ComplejoHabitacional
app.get('/api/complejos', async (_req, res) => {
  try {
    const complejos = await getPrisma().complejoHabitacional.findMany();
    res.json(complejos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener complejos' });
  }
});
app.get('/api/complejos/:id', async (req, res) => {
  try {
    const complejo = await getPrisma().complejoHabitacional.findUnique({ where: { id: Number(req.params.id) } });
    if (!complejo) return res.status(404).json({ error: 'Complejo no encontrado' });
    res.json(complejo);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener complejo' });
  }
});
app.post('/api/complejos', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const complejo = await getPrisma().complejoHabitacional.create({ data: req.body });
    res.status(201).json(complejo);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear complejo' });
  }
});
app.put('/api/complejos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const complejo = await getPrisma().complejoHabitacional.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(complejo);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar complejo' });
  }
});
app.delete('/api/complejos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().complejoHabitacional.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar complejo' });
  }
});

// CRUD EmpresaAdministradora
app.get('/api/empresas', async (_req, res) => {
  try {
    const empresas = await getPrisma().empresaAdministradora.findMany();
    res.json(empresas);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener empresas' });
  }
});
app.get('/api/empresas/:id', async (req, res) => {
  try {
    const empresa = await getPrisma().empresaAdministradora.findUnique({ where: { id: Number(req.params.id) } });
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    res.json(empresa);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener empresa' });
  }
});
app.post('/api/empresas', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const empresa = await getPrisma().empresaAdministradora.create({ data: req.body });
    res.status(201).json(empresa);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear empresa' });
  }
});
app.put('/api/empresas/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const empresa = await getPrisma().empresaAdministradora.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(empresa);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar empresa' });
  }
});
app.delete('/api/empresas/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().empresaAdministradora.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar empresa' });
  }
});

// CRUD Piso
app.get('/api/pisos', async (_req, res) => {
  try {
    const pisos = await getPrisma().piso.findMany();
    res.json(pisos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pisos' });
  }
});
app.get('/api/pisos/:id', async (req, res) => {
  try {
    const piso = await getPrisma().piso.findUnique({ where: { id: Number(req.params.id) } });
    if (!piso) return res.status(404).json({ error: 'Piso no encontrado' });
    res.json(piso);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener piso' });
  }
});
app.post('/api/pisos', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const piso = await getPrisma().piso.create({ data: req.body });
    res.status(201).json(piso);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear piso' });
  }
});
app.put('/api/pisos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const piso = await getPrisma().piso.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(piso);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar piso' });
  }
});
app.delete('/api/pisos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().piso.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar piso' });
  }
});

// CRUD Unidad
app.get('/api/unidades', async (_req, res) => {
  try {
    const unidades = await getPrisma().unidad.findMany();
    res.json(unidades);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener unidades' });
  }
});
app.get('/api/unidades/:id', async (req, res) => {
  try {
    const unidad = await getPrisma().unidad.findUnique({ where: { id: Number(req.params.id) } });
    if (!unidad) return res.status(404).json({ error: 'Unidad no encontrada' });
    res.json(unidad);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener unidad' });
  }
});
app.post('/api/unidades', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const unidad = await getPrisma().unidad.create({ data: req.body });
    res.status(201).json(unidad);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear unidad' });
  }
});
app.put('/api/unidades/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const unidad = await getPrisma().unidad.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(unidad);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar unidad' });
  }
});
app.delete('/api/unidades/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().unidad.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar unidad' });
  }
});

// CRUD Concepto
app.get('/api/conceptos', async (_req, res) => {
  try {
    const conceptos = await getPrisma().concepto.findMany();
    res.json(conceptos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener conceptos' });
  }
});
app.get('/api/conceptos/:id', async (req, res) => {
  try {
    const concepto = await getPrisma().concepto.findUnique({ where: { id: Number(req.params.id) } });
    if (!concepto) return res.status(404).json({ error: 'Concepto no encontrado' });
    res.json(concepto);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener concepto' });
  }
});
app.post('/api/conceptos', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const concepto = await getPrisma().concepto.create({ data: req.body });
    res.status(201).json(concepto);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear concepto' });
  }
});
app.put('/api/conceptos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const concepto = await getPrisma().concepto.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(concepto);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar concepto' });
  }
});
app.delete('/api/conceptos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().concepto.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar concepto' });
  }
});

// CRUD Recibo
app.get('/api/recibos', async (_req, res) => {
  try {
    const recibos = await getPrisma().recibo.findMany();
    res.json(recibos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener recibos' });
  }
});
app.get('/api/recibos/:id', async (req, res) => {
  try {
    const recibo = await getPrisma().recibo.findUnique({ where: { id: Number(req.params.id) } });
    if (!recibo) return res.status(404).json({ error: 'Recibo no encontrado' });
    res.json(recibo);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener recibo' });
  }
});
app.post('/api/recibos', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const recibo = await getPrisma().recibo.create({ data: req.body });
    res.status(201).json(recibo);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear recibo' });
  }
});
app.put('/api/recibos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const recibo = await getPrisma().recibo.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(recibo);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar recibo' });
  }
});
app.delete('/api/recibos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().recibo.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar recibo' });
  }
});

// CRUD Pago
app.get('/api/pagos', async (_req, res) => {
  try {
    const pagos = await getPrisma().pago.findMany();
    res.json(pagos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pagos' });
  }
});
app.get('/api/pagos/:id', async (req, res) => {
  try {
    const pago = await getPrisma().pago.findUnique({ where: { id: Number(req.params.id) } });
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
    res.json(pago);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pago' });
  }
});
app.post('/api/pagos', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const pago = await getPrisma().pago.create({ data: req.body });
    res.status(201).json(pago);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear pago' });
  }
});
app.put('/api/pagos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const pago = await getPrisma().pago.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(pago);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar pago' });
  }
});
app.delete('/api/pagos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().pago.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar pago' });
  }
});

// CRUD ReciboConcepto
app.get('/api/recibo-conceptos', async (_req, res) => {
  try {
    const reciboConceptos = await getPrisma().reciboConcepto.findMany();
    res.json(reciboConceptos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reciboConceptos' });
  }
});
app.get('/api/recibo-conceptos/:id', async (req, res) => {
  try {
    const reciboConcepto = await getPrisma().reciboConcepto.findUnique({ where: { id: Number(req.params.id) } });
    if (!reciboConcepto) return res.status(404).json({ error: 'ReciboConcepto no encontrado' });
    res.json(reciboConcepto);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reciboConcepto' });
  }
});
app.post('/api/recibo-conceptos', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const reciboConcepto = await getPrisma().reciboConcepto.create({ data: req.body });
    res.status(201).json(reciboConcepto);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear reciboConcepto' });
  }
});
app.put('/api/recibo-conceptos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const reciboConcepto = await getPrisma().reciboConcepto.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(reciboConcepto);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar reciboConcepto' });
  }
});
app.delete('/api/recibo-conceptos/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().reciboConcepto.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar reciboConcepto' });
  }
});

// CRUD ReciboConceptoUnidad
app.get('/api/recibo-concepto-unidades', async (_req, res) => {
  try {
    const reciboConceptoUnidades = await getPrisma().reciboConceptoUnidad.findMany();
    res.json(reciboConceptoUnidades);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reciboConceptoUnidades' });
  }
});
app.get('/api/recibo-concepto-unidades/:id', async (req, res) => {
  try {
    const reciboConceptoUnidad = await getPrisma().reciboConceptoUnidad.findUnique({ where: { id: Number(req.params.id) } });
    if (!reciboConceptoUnidad) return res.status(404).json({ error: 'ReciboConceptoUnidad no encontrado' });
    res.json(reciboConceptoUnidad);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reciboConceptoUnidad' });
  }
});
app.post('/api/recibo-concepto-unidades', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const reciboConceptoUnidad = await getPrisma().reciboConceptoUnidad.create({ data: req.body });
    res.status(201).json(reciboConceptoUnidad);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear reciboConceptoUnidad' });
  }
});
app.put('/api/recibo-concepto-unidades/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const reciboConceptoUnidad = await getPrisma().reciboConceptoUnidad.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(reciboConceptoUnidad);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar reciboConceptoUnidad' });
  }
});
app.delete('/api/recibo-concepto-unidades/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().reciboConceptoUnidad.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar reciboConceptoUnidad' });
  }
});

// CRUD Estructura
app.get('/api/estructuras', async (_req, res) => {
  try {
    const estructuras = await getPrisma().estructura.findMany();
    res.json(estructuras);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estructuras' });
  }
});
app.get('/api/estructuras/:id', async (req, res) => {
  try {
    const estructura = await getPrisma().estructura.findUnique({ where: { id: Number(req.params.id) } });
    if (!estructura) return res.status(404).json({ error: 'Estructura no encontrada' });
    res.json(estructura);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estructura' });
  }
});
app.post('/api/estructuras', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const estructura = await getPrisma().estructura.create({ data: req.body });
    res.status(201).json(estructura);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear estructura' });
  }
});
app.put('/api/estructuras/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    const estructura = await getPrisma().estructura.update({ where: { id: Number(req.params.id) }, data: req.body });
    res.json(estructura);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar estructura' });
  }
});
app.delete('/api/estructuras/:id', authenticateToken, authorizeRoles('admin', 'superadmin'), async (req, res) => {
  try {
    await getPrisma().estructura.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar estructura' });
  }
});

// Endpoint de login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y password requeridos' });
  }
  try {
    const prisma = getPrisma();
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    // Validar password usando bcrypt
    if (!usuario.password_hash) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const passwordValido = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValido) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    // Generar JWT
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      process.env.JWT_SECRET || 'devsecret',
      { expiresIn: '7d' }
    );
    return res.json({ token, user: { id: usuario.id, email: usuario.email, rol: usuario.rol } });
  } catch (error) {
    return res.status(500).json({ error: 'Error en login' });
  }
});

// Producción: el mismo contenedor sirve el frontend compilado (dist/)
const distDir = path.join(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
});
