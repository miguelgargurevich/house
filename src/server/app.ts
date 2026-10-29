import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { Router, type Request, type Response } from 'express';
import helmet from 'helmet';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { isProduction, parseCorsOrigins } from './config';
import { auditoria } from './middleware/audit';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { crearLimitadores, type RateLimitOptions } from './middleware/rateLimit';
import { aguaRouter } from './routes/agua';
import { aiChatRouter } from './routes/aiChat';
import { auditoriaRouter } from './routes/auditoria';
import { juntasRouter } from './routes/juntas';
import { llaveroRouter } from './routes/llavero';
import { mcpRouter } from './routes/mcp';
import { tokensApiRouter } from './routes/tokensApi';
import { whatsappRouter } from './routes/whatsapp';
import { canalesMeRouter } from './routes/canales';
import { canalesTelegramRouter, canalesWebhookRouter } from './routes/canalesWebhook';
import { loginRouter, sesionRouter } from './routes/auth';
import { cargosRouter } from './routes/cargos';
import { comprobantesRouter } from './routes/comprobantes';
import { comunicadosRouter } from './routes/comunicados';
import { complejosRouter } from './routes/complejos';
import { conceptosRouter } from './routes/conceptos';
import { dashboardRouter } from './routes/dashboard';
import { empresasRouter } from './routes/empresas';
import { estructurasRouter } from './routes/estructuras';
import { avisosPersonalesRouter } from './routes/avisosPersonales';
import { meRouter } from './routes/me';
import { mediosPagoMeRouter, mediosPagoRouter } from './routes/mediosPago';
import { notificacionesRouter } from './routes/notificaciones';
import { pagosRouter } from './routes/pagos';
import { publicoRouter } from './routes/publico';
import { comercialRouter } from './routes/comercial';
import { pisosRouter } from './routes/pisos';
import { proveedoresRouter } from './routes/proveedores';
import { reciboConceptosRouter } from './routes/reciboConceptos';
import { recibosRouter } from './routes/recibos';
import { reportesRouter } from './routes/reportes';
import { tareasRouter } from './routes/tareas';
import { unidadesRouter } from './routes/unidades';
import { usuariosRouter } from './routes/usuarios';

export interface AppOptions {
  /** Sólo para pruebas: sube o baja los topes de rate-limit. */
  rateLimits?: RateLimitOptions;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  const limiters = crearLimitadores(opts.rateLimits);

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      // `upgrade-insecure-requests` rompe el HTTP local; en producción (HTTPS) se conserva.
      contentSecurityPolicy: { useDefaults: true, directives: {
          'upgrade-insecure-requests': isProduction() ? [] : null,
          // El comprobante y el QR se descargan con la sesión y se muestran como URL local (`blob:`): sin esto el navegador bloquea la imagen.
          'img-src': ["'self'", 'data:', 'blob:'],
        },
      },
    }),
  );

  // `/mcp` va ANTES de CORS y del JSON global: su propio filtro de Origin (403), su Bearer, su límite de tasa y su cuerpo acotado.
  app.use('/mcp', mcpRouter({ porMinuto: opts.rateLimits?.mcp, fallos: limiters.mcpFallos }));

  // Webhook de Evolution (bot de WhatsApp): también antes del JSON global, con su secreto por instancia y su propio tope de 64 kB.
  app.use('/api/canales/whatsapp', canalesWebhookRouter());
  app.use('/api/canales/telegram', canalesTelegramRouter());

  // CORS desactivado por defecto (mismo origen); sólo se habilita para los orígenes listados en CORS_ORIGIN.
  const origenes = parseCorsOrigins();
  if (origenes.length) app.use(cors({ origin: origenes }));

  app.use(express.json({ limit: '100kb' }));

  if (!isProduction()) {
    const spec = swaggerJSDoc({
      definition: {
        openapi: '3.0.0',
        info: { title: 'House API', version: '2.0.0', description: 'API de House SaaS multi-tenant. Contrato completo en docs/API-CONTRATO.md.' },
        servers: [{ url: '/' }],
        components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'house_sesion' } } },
      },
      apis: ['./src/server/routes/*.ts'],
    });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
  }

  const api = Router();
  api.use(limiters.api);
  api.get('/health', (_req, res) => { res.json({ ok: true }); }); // público: healthcheck del contenedor
  api.use('/auth', loginRouter(limiters.login, limiters.loginCuenta)); // tramo público: inicio de sesión
  api.use('/publico', publicoRouter({ registroIp: limiters.registroIp, registroCorreo: limiters.registroCorreo, verificacion: limiters.verificacion })); // tramo público: planes, registro y verificación del correo
  api.use(authenticate);
  api.use(auditoria);
  api.use('/auth', sesionRouter);
  api.use('/ai-chat', aiChatRouter(limiters.ai)); // el límite por usuario sólo cuenta los mensajes (POST), no las lecturas
  api.use('/llavero', llaveroRouter(limiters.llavero));
  api.use('/me/tokens-api', tokensApiRouter); // antes de /me: tokens de API (MCP) del propio usuario
  api.use('/me/avisos', avisosPersonalesRouter); // antes de /me: ruta propia, sin tocar me.ts
  api.use('/me/medios-pago', mediosPagoMeRouter); // antes de /me: ruta propia, sin tocar me.ts
  api.use('/me/canales', canalesMeRouter); // antes de /me: vincular el WhatsApp propio
  api.use('/me', meRouter(limiters.password));
  api.use('/medios-pago', mediosPagoRouter);
  api.use('/juntas', juntasRouter);
  api.use('/notificaciones', notificacionesRouter);
  api.use('/comunicados', comunicadosRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/reportes', reportesRouter);
  api.use('/usuarios', usuariosRouter);
  api.use('/empresas', empresasRouter);
  api.use('/complejos', complejosRouter);
  api.use('/estructuras', estructurasRouter);
  api.use('/pisos', pisosRouter);
  api.use('/unidades', unidadesRouter);
  api.use('/conceptos', conceptosRouter);
  api.use('/recibos', aguaRouter); // lecturas de agua, foto del contómetro y fecha de corte: antes del CRUD de recibos
  api.use('/recibos', recibosRouter);
  api.post('/pagos/:id/evaluacion', limiters.evaluacion); // por usuario; sigue a comprobantesRouter
  api.use('/pagos', comprobantesRouter); // antes del CRUD: sus rutas (/:id/comprobante, /:id/validacion) admiten también a residentes
  api.use('/pagos', pagosRouter);
  api.use('/recibo-conceptos', reciboConceptosRouter);
  api.use('/recibo-concepto-unidades', cargosRouter);
  api.use('/proveedores', proveedoresRouter);
  api.use('/tareas', tareasRouter);
  api.use('/auditoria', auditoriaRouter);
  api.use('/whatsapp', whatsappRouter);
  api.use('/comercial', comercialRouter);
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  // Producción: el mismo contenedor sirve el frontend compilado (dist/).
  const distDir = path.join(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    // Archivos con hash en el nombre: inmutables. Si falta uno (pestaña abierta durante un redespliegue)
    // debe ser un 404 real: devolver index.html con 200 deja la pantalla en blanco sin ningún error.
    app.use('/assets', express.static(path.join(distDir, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use('/assets', (_req: Request, res: Response) => { res.status(404).type('text/plain').send('No encontrado'); });
    app.use(express.static(distDir, { index: false }));
    app.get(/^(?!\/api)(?!.*\.[a-z0-9]+$).*/i, (_req: Request, res: Response) => {
      res.set('Cache-Control', 'no-cache'); // la página de inicio siempre se revalida: apunta a los archivos vigentes
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

export const app = createApp();
