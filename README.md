# House

**House** es una aplicación SaaS multi-tenant para administración de propiedades, edificios y condominios. Incluye gestión de usuarios, unidades, empresas, recibos, pagos, mantenimientos y más, con roles avanzados y chat IA integrado.

### Stack actualizado (julio 2025)
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Node.js, Express, Prisma ORM
- **Base de datos:** PostgreSQL
- **Autenticación:** JWT, bcrypt, protección por roles
- **IA:** Gemini API (Google)
- **Infraestructura:** Docker Compose para desarrollo local, VPS con Coolify en producción

### Cambios recientes

- Todos los sidebars ahora muestran los ítems alineados en una sola línea (icono y texto), tanto en modo expandido como colapsado, para todos los roles.
- Efectos de hover y transición unificados en iconos y textos de los menús.
- Nuevo endpoint `/auth/login` en el backend para login seguro con JWT y bcrypt, alineado con el frontend.
- Script `dev:all` ahora incluye Prisma Studio para edición visual de la base de datos.
- Color de acento actualizado a gris claro (`#F3F4F6`).

## Cambios funcionales y técnicos recientes

- **Sincronización total front-back:** Todas las entidades y páginas del frontend están alineadas con los modelos y endpoints del backend.
- **Roles soportados:** superadmin, admin, propietario, inquilino, mantenimiento (con navegación y permisos diferenciados).
- **Modelo extendido:**
  - Unificación de "Propiedad" como "Unidad" en todo el sistema.
  - Nuevo modelo `TareaMantenimiento` para gestión de tareas/mantenimientos.
  - Seed robusto: 12+ registros por tabla, datos de prueba para todos los roles y relaciones.
- **Endpoints REST centralizados:** Todo el backend está en `src/server.ts` y expone rutas bajo `/api` (ej: `/api/usuarios`, `/api/unidades`, `/api/recibos`, etc.).
- **Autenticación y roles:** JWT, protección de endpoints por rol, login seguro con bcrypt.
- **Swagger:** Documentación interactiva en `/api-docs`.
- **Chat IA Gemini:** Prompt configurable, integración backend y UI flotante.
- **Accesibilidad y SEO:** UI y componentes accesibles, responsivos y con buenas prácticas.
- **Migraciones y seed automáticos:** Prisma ORM, scripts para poblar y migrar la base de datos.




## Estructura y organización
- **src/server.ts:** Backend Express centralizado, todos los endpoints bajo `/api`.
- **src/pages:** Páginas por rol (admin, superadmin, propietario, inquilino, mantenimiento).
- **src/components, src/layouts:** Componentes y layouts reutilizables, sidebars y navbars por rol. Todos los sidebars son responsivos: drawer en mobile, colapsado en desktop, agrupados por contexto y protegidos por RoleGuard.
- **src/hooks, src/utils, src/types:** Hooks y utilidades custom.
- **src/config/ai-system-prompt.txt:** Prompt de sistema para IA Gemini.
- **Prisma:** Modelos, migraciones y seed en `/prisma`.
- **Modo claro/oscuro:** Soportado en toda la UI.
- **Accesibilidad:** Navegación por teclado, etiquetas ARIA, contraste adecuado.

## Variables de entorno


Configura el archivo `.env` en la raíz del proyecto frontend y backend:

```env
GEMINI_API_KEY=tu_clave_gemini
DATABASE_URL=postgresql://usuario:password@host:puerto/db
JWT_SECRET=tu_clave_secreta
VITE_API_URL=https://tu-backend.com/api
```
Asistente de IA (todas `on|off`, activas por defecto solo en producción): `MODELOS_SYNC` (descubre y depreca modelos de cada clave del llavero), `ASISTENTE_CANARY` (consulta mínima periódica de salud) y `ASISTENTE_LIMPIEZA` (borra conversaciones de más de 90 días); opcionales `LLAVERO_MAX_INTENTOS` y `LLAVERO_TOPE_MS`. Detalle en `docs/SEGURIDAD.md`.

Avisos por correo y WhatsApp (opcionales; sin ellas los avisos quedan «omitidos»): `RESEND_API_KEY` y `MAIL_FROM` (correo, Resend), `EVOLUTION_URL`, `EVOLUTION_INSTANCE` y `EVOLUTION_APIKEY` (WhatsApp, Evolution API) y `AVISOS_PLANIFICADOR=on|off` (activo por defecto solo en producción). Detalle en `docs/SEGURIDAD.md`.

No subas `.env` al repo. El backend y frontend usan estas variables. En Vite, todas las variables que comiencen con `VITE_` estarán disponibles en el frontend vía `import.meta.env.VITE_API_URL`.

## Endpoints principales (`src/server.ts`)

- `/api/usuarios` — CRUD usuarios (roles: superadmin, admin, propietario, inquilino, mantenimiento)
- `/api/empresas` — CRUD empresas administradoras
- `/api/unidades` — CRUD unidades (propiedades)
- `/api/recibos` — CRUD recibos
- `/api/pagos` — CRUD pagos
- `/api/conceptos` — CRUD conceptos
- `/api/pisos`, `/api/estructuras`, `/api/complejos` — CRUD jerarquía de edificios
- `/api/tarea-mantenimientos` — CRUD tareas de mantenimiento
- `/auth/login` — Login seguro (JWT)
- `/api/ai-chat` — Chat IA Gemini

Todos los endpoints sensibles están protegidos por JWT y roles. El backend Express centraliza toda la lógica y la documentación Swagger está disponible en `/api-docs`.


## Scripts útiles

- `npm run dev` — Frontend (Vite, puerto 5173)
- `npm run backend` — Backend (Express, puerto 4000)
- `npm run dev:all` — Frontend, backend y Prisma Studio juntos
- `npm run build` — Build de producción
- `npm run preview` — Preview build
- `npx prisma migrate dev` — Migraciones Prisma
- `npx prisma db seed` — Ejecutar seed de base de datos
  # Eliminado: ver README-docker.md para levantar el stack local con compose exclusivo

## Prisma Studio

Para explorar y editar la base de datos visualmente, ejecuta:

```bash
npx prisma studio
```

Prisma Studio estará disponible en [http://localhost:5555](http://localhost:5555).

## Configuración Tailwind

- Colores base: `#0D1B2A`, `#F3F4F6`, `#FFFFFF` (acento gris claro)
- Tipografía: Inter, Poppins


## Despliegue en producción (VPS + Coolify)

Todo corre en el VPS con Coolify, en un único contenedor (API Express + frontend compilado) definido por el `Dockerfile`.

1. En Coolify crea una base de datos PostgreSQL y copia su URL interna.
2. Crea una aplicación desde este repo de GitHub con *Build Pack: Dockerfile* y puerto 4000.
3. Variables de entorno: `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY` (ver `.env.example`).
4. Asigna el dominio; Coolify/Traefik emite el HTTPS. El frontend usa rutas relativas (`/api`), no requiere `VITE_API_URL` ni CORS.
5. Al arrancar, el contenedor ejecuta `prisma db push`. Para cargar datos de prueba: `npx prisma db seed` dentro del contenedor.

---


## Próximos pasos

1. Revisión visual final: verificar consistencia de layouts, sidebars y fondo azul claro en todos los roles y resoluciones.
2. Pruebas de usuario: testear funcionalidad, usabilidad y accesibilidad, detectar bugs menores.
3. Optimización de rendimiento: auditar bundle, lazy loading, optimizar recursos.
4. SEO y accesibilidad: validar meta tags, roles ARIA, navegación con teclado y contraste.
5. Seguridad frontend: revisar manejo de roles, protección de rutas y sanitización de datos.
6. Documentación: actualizar README y docs técnicas para onboarding.
7. Automatización: configurar tests automáticos (unitarios/e2e), CI/CD y backups.
8. Feedback: recopilar feedback de usuarios y stakeholders para priorizar mejoras o nuevas funcionalidades.

---

## Demo de acceso

**Usuario:** admin@demo.com  
**Contraseña:** admin123

## Comandos útiles para desarrollo

- `npm run backend` — Solo backend (Express, puerto 4000)
- `npm run dev` — Solo frontend (Vite, puerto 5173)
- `npm run dev:all` — Frontend y backend juntos (requiere ts-node y concurrently)

---

## Notas y aclaraciones
- El backend real es `src/server.ts`, no hay duplicidad de servidores.
- Todas las rutas API están bajo `/api` por convención REST, excepto `/auth/login` y `/api/ai-chat`.
- El seed y los modelos están sincronizados con las páginas y roles del frontend.
- El sistema es seguro, escalable y listo para producción, con sidebars alineados, roles avanzados y experiencia moderna.
