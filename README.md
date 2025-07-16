# House

**House** es una aplicación SaaS multi-tenant para administración de propiedades, edificios y condominios. Incluye gestión de usuarios, unidades, empresas, recibos, pagos, mantenimientos y más, con roles avanzados y chat IA integrado.

### Stack actualizado (julio 2025)
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Node.js, Express, Prisma ORM
- **Base de datos:** PostgreSQL
- **Autenticación:** JWT, bcrypt, protección por roles
- **IA:** Gemini API (Google)
- **Infraestructura:** Docker Compose para desarrollo local, Render (backend/db) y Vercel (frontend) en producción

### Cambios recientes
- Sidebars de todos los roles ahora son responsivos y agrupados por contexto, con drawer en mobile y colapsado en desktop.
- Protección de rutas y menús por rol con RoleGuard.
- Layouts y componentes desacoplados y reutilizables.
- Seed robusto y migraciones automáticas con Prisma.
- Documentación y scripts actualizados para despliegue y desarrollo.

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

Configura el archivo `.env` en la raíz:

```env
GEMINI_API_KEY=tu_clave_gemini
DATABASE_URL=postgresql://usuario:password@host:puerto/db
JWT_SECRET=tu_clave_secreta
```
No subas `.env` al repo. El backend y frontend usan estas variables.

## Endpoints principales (`src/server.ts`)

- `/api/usuarios` — CRUD usuarios (roles: superadmin, admin, propietario, inquilino, mantenimiento)
- `/api/empresas` — CRUD empresas administradoras
- `/api/unidades` — CRUD unidades (propiedades)
- `/api/recibos` — CRUD recibos
- `/api/pagos` — CRUD pagos
- `/api/conceptos` — CRUD conceptos
- `/api/pisos`, `/api/estructuras`, `/api/complejos` — CRUD jerarquía de edificios
- `/api/tarea-mantenimientos` — CRUD tareas de mantenimiento
- `/api/login` — Login seguro (JWT)
- `/api/ai-chat` — Chat IA Gemini

Todos los endpoints sensibles están protegidos por JWT y roles. El backend Express centraliza toda la lógica y la documentación Swagger está disponible en `/api-docs`.

## Scripts útiles

- `npm run dev` — Frontend (Vite, puerto 5173)
- `npm run backend` — Backend (Express, puerto 4000)
- `npm run dev:all` — Frontend y backend juntos
- `npm run build` — Build de producción
- `npm run preview` — Preview build
- `npx prisma migrate dev` — Migraciones Prisma
- `npx prisma db seed` — Ejecutar seed de base de datos
  # Eliminado: ver README-docker.md para levantar el stack local con compose exclusivo

## Configuración Tailwind

- Colores base: `#0D1B2A`, `#F4A261`, `#FFFFFF`
- Tipografía: Inter, Poppins


## Despliegue en producción

### Backend y Base de Datos (Render)
- Crea un servicio web en Render para el backend (Node.js/Express) y un servicio de base de datos PostgreSQL.
- Configura las variables de entorno en Render (`DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`).
- Render expone la URL del backend, por ejemplo: `https://house-backend.onrender.com`.
- Render gestiona automáticamente la persistencia y backups de la base de datos.
- Ejecuta las migraciones y el seed en Render usando los scripts de Prisma.

### Frontend (Vercel)
- Despliega el frontend (Vite/React) en Vercel conectando el repo de GitHub.
- Configura la variable de entorno `VITE_API_URL` con la URL pública del backend de Render.
- Vercel gestiona automáticamente el build y el CDN global.

### Recomendaciones
- Asegúrate de que el backend permita CORS desde el dominio de Vercel.
- Usa HTTPS en todas las URLs de producción.
- Mantén las variables sensibles solo en Render y Vercel, nunca en el repo.

---


## Próximos pasos
- Mejorar validaciones y lógica avanzada de negocio
- Agregar tests automáticos
- Documentar endpoints y ejemplos de uso
- Mantener la estructura centralizada y sin archivos legacy
- Unificar lógica de permisos finos en frontend y backend
- Mejorar la experiencia mobile y accesibilidad

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
- Todas las rutas API están bajo `/api` por convención REST.
- El seed y los modelos están sincronizados con las páginas y roles del frontend.
- El sistema es multi-tenant y seguro, listo para producción y escalabilidad.
