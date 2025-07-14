# House

Aplicación web SaaS multi-tenant para administración de propiedades y departamentos (residenciales, condominios).

## Stack
- **Frontend:** React 18 + Vite + TypeScript
- **UI:** Tailwind CSS + Framer Motion
- **Backend:** Node.js + Express + Prisma ORM
- **Base de datos:** PostgreSQL (Docker Compose)
- **Auth:** JWT (simulado para desarrollo), protección de endpoints por roles (admin, superadmin)
- **AI Chat:** Gemini API (proxy backend)
- **ORM:** Prisma
- **Otros:** CORS, dotenv, node-fetch

## Estructura
- Rutas protegidas y layouts reutilizables
- Integración con Supabase y Framer Motion
- Carpetas principales: `src/components`, `src/pages`, `src/layouts`, `src/hooks`, `src/utils`, `src/types`, `src/assets`, `src/server.ts`, `src/config/ai-system-prompt.txt`

## Variables de entorno
Configura tus variables en el archivo `.env` en la raíz del proyecto (no existe `.env.example`):

```
GEMINI_API_KEY=tu_clave_gemini
DATABASE_URL=postgresql://usuario:password@host:puerto/db
JWT_SECRET=tu_clave_secreta
```

No subas tu archivo `.env` al repositorio. Solo usa `.env` para desarrollo y producción (Vercel). El backend Express y todos los endpoints usan estas variables.


## Endpoints principales (Express + Prisma, centralizados en `src/server.ts`)
- CRUD Usuarios
- CRUD Complejos Habitacionales
- CRUD Empresas Administradoras
- CRUD Pisos
- CRUD Unidades
- CRUD Conceptos
- CRUD Recibos
- CRUD Pagos
- CRUD ReciboConceptos
- CRUD ReciboConceptoUnidades
- CRUD Estructuras
- Endpoint de chat IA (`/api/ai-chat`) — centralizado en `src/server.ts`. El prompt de sistema está en `src/config/ai-system-prompt.txt`.

Todos los endpoints sensibles (crear, actualizar, eliminar) están protegidos por JWT y roles (`admin`, `superadmin`).
Todos los endpoints están implementados en un único backend Express (`src/server.ts`). Ya no existen archivos de API sueltos ni lógica en la carpeta `api/`.
El prompt de IA se encuentra en `src/config/ai-system-prompt.txt`.

## Scripts
- `npm run dev` — desarrollo frontend
- `npm run backend` — desarrollo backend
- `npm run dev:all` — ambos servidores a la vez (requiere `concurrently`)
- `npm run build` — build producción
- `npm run preview` — preview build
- `npx prisma migrate dev` — migraciones Prisma
- `docker-compose up` — levantar base de datos local

## Configuración Tailwind
- Colores base: `#0D1B2A`, `#F4A261`, `#FFFFFF`
- Tipografía: Inter, Poppins

## Próximos pasos
- Integrar frontend con endpoints protegidos
- Mejorar validaciones y lógica de negocio avanzada
- Documentar endpoints y ejemplos de uso
- Mantener la estructura centralizada y sin archivos legacy en `/api`.


# Demo de acceso

**Usuario:** admin@demo.com  
**Contraseña:** admin123

# Comandos útiles para desarrollo

- `npm run backend` — Solo backend (Express, puerto 4000)
- `npm run dev` — Solo frontend (Vite, puerto 5173)
- `npm run dev:all` — Frontend y backend juntos (requiere ts-node y concurrently)
