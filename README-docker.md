
# Deploy local con Docker Compose: Backend, Frontend y Base de Datos

Stack actualizado (julio 2025):
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion
- **Backend:** Node.js, Express, Prisma ORM
- **Base de datos:** PostgreSQL 15
- **Autenticación:** JWT, bcrypt, protección por roles
- **IA:** Gemini API (Google)
- **Sidebars:** Todos los sidebars por rol son responsivos y agrupados, drawer en mobile y colapsado en desktop.

Este proyecto permite levantar todo el stack (React + Node.js + PostgreSQL) con un solo comando usando Docker Compose.


## Estructura de servicios
- **db**: PostgreSQL 15, datos persistentes en `./db/data`.
- **backend**: Node.js + Express + Prisma, expone la API en el puerto 4000.
- **frontend**: React 18 + Vite, servido por nginx en el puerto 80.


## Primer uso (desarrollo o demo)

1. **Clona el repo y asegúrate de tener Docker Desktop instalado.**
2. **Levanta todo el stack:**
   ```sh
   docker compose up --build -d
   ```
3. **(Solo si la base está vacía o es nueva) Ejecuta el seed:**
   ```sh
   docker compose exec backend npx prisma migrate deploy
   docker compose exec backend npx prisma db seed
   ```
   Esto poblará la base con datos realistas.

4. **Accede a la app:**
   - Frontend: http://localhost/
   - Backend API: http://localhost:4000/api
   - Base de datos: localhost:5432 (usuario: postgres, pass: mipassword)

## Variables de entorno

- `.env.docker` contiene las variables para el entorno Docker Compose.
- El backend usa `DATABASE_URL=postgresql://postgres:mipassword@db:5432/mi_bd_pg`.
- El frontend no requiere variables para producción (usa estáticos y proxy nginx).



## Entorno exclusivo "certi" (stack aislado)

Puedes levantar un entorno completamente aislado para pruebas, demos o certificación, con su propia base de datos, backend y frontend, sin interferir con otros entornos ni puertos.

### ¿Cómo levantar el entorno certi?

1. Ejecuta:
   ```sh
   docker compose -f docker-compose.certi.yml up --build -d
   ```
   Esto creará:
   - Base de datos: servicio `db-certi` en el puerto 55432 (usuario: postgres, pass: certipass, base: certi_db)
   - Backend: servicio `backend-certi` en el puerto 33001
   - Frontend: servicio `frontend-certi` en el puerto 18080

2. El backend ejecuta automáticamente las migraciones y el seed al iniciar, así que tendrás datos realistas listos.

3. Accede a:
   - Frontend: http://localhost:18080/
   - Backend API: http://localhost:33001/api
   - Base de datos: localhost:55432

### Notas para certi

- Las variables de entorno están en `.env.certi`.
- Este stack no afecta tu base de datos ni servicios actuales.
- Puedes tener varios entornos levantados a la vez si usas puertos distintos.
- El seed borra todos los datos de la base `certi_db` cada vez que se levanta el backend.

---


¿Dudas? Consulta este archivo o pregunta a Copilot 😉

---

Actualizado julio 2025. Para detalles de roles, sidebars, layouts y despliegue, consulta el README principal.

---

¿Dudas? Consulta este archivo o pregunta a Copilot 😉
