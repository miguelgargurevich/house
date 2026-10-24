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
import { aiChatRouter } from './routes/aiChat';
import { auditoriaRouter } from './routes/auditoria';
import { llaveroRouter } from './routes/llavero';
import { loginRouter, sesionRouter } from './routes/auth';
import { cargosRouter } from './routes/cargos';
import { comprobantesRouter } from './routes/comprobantes';
import { complejosRouter } from './routes/complejos';
import { conceptosRouter } from './routes/conceptos';
import { dashboardRouter } from './routes/dashboard';
import { empresasRouter } from './routes/empresas';
import { estructurasRouter } from './routes/estructuras';
import { meRouter } from './routes/me';
import { pagosRouter } from './routes/pagos';
import { pisosRouter } from './routes/pisos';
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
      contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': isProduction() ? [] : null } },
    }),
  );

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
        components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      },
      apis: ['./src/server/routes/*.ts'],
    });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
  }

  const api = Router();
  api.use(limiters.api);
  api.get('/health', (_req, res) => { res.json({ ok: true }); }); // público: healthcheck del contenedor
  api.use('/auth', loginRouter(limiters.login)); // único tramo público
  api.use(authenticate);
  api.use(auditoria);
  api.use('/auth', sesionRouter);
  api.use('/ai-chat', limiters.ai, aiChatRouter);
  api.use('/llavero', llaveroRouter(limiters.llavero));
  api.use('/me', meRouter(limiters.password));
  api.use('/dashboard', dashboardRouter);
  api.use('/reportes', reportesRouter);
  api.use('/usuarios', usuariosRouter);
  api.use('/empresas', empresasRouter);
  api.use('/complejos', complejosRouter);
  api.use('/estructuras', estructurasRouter);
  api.use('/pisos', pisosRouter);
  api.use('/unidades', unidadesRouter);
  api.use('/conceptos', conceptosRouter);
  api.use('/recibos', recibosRouter);
  api.use('/pagos', comprobantesRouter); // antes del CRUD: sus rutas (/:id/comprobante, /:id/validacion) admiten también a residentes
  api.use('/pagos', pagosRouter);
  api.use('/recibo-conceptos', reciboConceptosRouter);
  api.use('/recibo-concepto-unidades', cargosRouter);
  api.use('/tareas', tareasRouter);
  api.use('/auditoria', auditoriaRouter);
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
