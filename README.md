

# House

Aplicación web SaaS multi-tenant para administración de propiedades y departamentos (residenciales, condominios). UI moderna, responsiva, con roles y chat IA integrado.


## Stack
- **Frontend:** React 18 + Vite + TypeScript
- **UI:** Tailwind CSS + Framer Motion
- **Backend:** Node.js + Express + Prisma ORM
- **Base de datos:** PostgreSQL (Docker Compose local, listo para Supabase en producción)
- **Auth:** JWT (Express), protección de endpoints por roles (`admin`, `superadmin`)
- **AI Chat:** Gemini API (proxy backend, chat flotante UI)
- **ORM:** Prisma
- **Otros:** CORS, dotenv, node-fetch


## Estructura
- Rutas protegidas y layouts reutilizables
- Integración con Framer Motion
- Tablas y formularios modernos, responsivos y con paginación
- Tablas adaptadas: en móvil solo muestran columnas críticas
- Chat IA flotante, solo visible tras login, con soporte modo claro/oscuro
- Sidebar y Navbar modernos, accesibles y responsivos
- Carpetas principales: `src/components`, `src/pages`, `src/layouts`, `src/hooks`, `src/utils`, `src/types`, `src/assets`, `src/server.ts`, `src/config/ai-system-prompt.txt`


## Variables de entorno

Configura tus variables en el archivo `.env` en la raíz del proyecto (no existe `.env.example`):

```env
GEMINI_API_KEY=tu_clave_gemini
DATABASE_URL=postgresql://usuario:password@host:puerto/db
JWT_SECRET=tu_clave_secreta
```

No subas tu archivo `.env` al repositorio. Solo usa `.env` para desarrollo y producción (Vercel). El backend Express y todos los endpoints usan estas variables.




## Endpoints principales (Express + Prisma, centralizados en `src/server.ts`)
- CRUD Usuarios
- CRUD Empresas Administradoras
- CRUD Recibos
- CRUD Pagos
- CRUD Unidades, Pisos, Conceptos, Estructuras, etc.
- Endpoint de chat IA (`/api/ai-chat`) — centralizado en `src/server.ts`. El prompt de sistema está en `src/config/ai-system-prompt.txt`.


Todos los endpoints sensibles (crear, actualizar, eliminar) están protegidos por JWT y roles (`admin`, `superadmin`).
Toda la lógica backend está centralizada en Express (`src/server.ts`).
El prompt de IA se encuentra en `src/config/ai-system-prompt.txt`.



## Scripts
- `npm run dev` — desarrollo frontend (Vite, puerto 5173)
- `npm run backend` — desarrollo backend (Express, puerto 4000)
- `npm run dev:all` — ambos servidores a la vez (requiere `concurrently` y `ts-node`)
- `npm run build` — build producción
- `npm run preview` — preview build
- `npx prisma migrate dev` — migraciones Prisma
- `docker-compose up` — levantar base de datos local


## Configuración Tailwind
- Colores base: `#0D1B2A`, `#F4A261`, `#FFFFFF`
- Tipografía: Inter, Poppins



## Producción en Supabase
- Para producción, crea una base PostgreSQL en Supabase y actualiza la variable `DATABASE_URL` en `.env`.
- No necesitas el SDK de Supabase, solo la URL de conexión.
- El backend y frontend funcionan igual, solo cambia la base.

## Próximos pasos
- Mejorar validaciones y lógica de negocio avanzada
- Agregar tests automáticos si lo deseas
- Documentar endpoints y ejemplos de uso
- Mantener la estructura centralizada y sin archivos legacy en `/api`.


---


## Demo de acceso

**Usuario:** admin@demo.com  
**Contraseña:** admin123

## Comandos útiles para desarrollo

- `npm run backend` — Solo backend (Express, puerto 4000)
- `npm run dev` — Solo frontend (Vite, puerto 5173)
- `npm run dev:all` — Frontend y backend juntos (requiere ts-node y concurrently)
