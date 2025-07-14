
# Base de datos local con Docker Compose

Este proyecto incluye un archivo `docker-compose.yml` para levantar una base de datos PostgreSQL lista para desarrollo, persistente y con el esquema inicial cargado automáticamente.

## Concepto principal: complejo_habitacional

El modelo de datos está centrado en la entidad **complejo_habitacional**, que representa cualquier conjunto inmobiliario: condominios, residenciales, conjuntos, etc. Cada complejo puede tener bloques, casas, pisos, departamentos, cocheras y depósitos, permitiendo máxima flexibilidad y escalabilidad.

## ¿Qué hace cada parte?

- **version: '3.8'**: Versión de la sintaxis de Docker Compose.
- **services**: Define los servicios a levantar (aquí solo `db`).
- **image: postgres:15**: Usa la imagen oficial de Postgres versión 15.
- **container_name: pg-dev**: El contenedor se llamará así (útil para identificarlo).
- **environment**:
  - `POSTGRES_PASSWORD`: Contraseña del usuario `postgres` (aquí: `mipassword`).
  - `POSTGRES_DB`: Nombre de la base de datos inicial (aquí: `mi_bd_pg`).
- **ports**: Expone el puerto 5432 del contenedor al 5432 de tu máquina.
- **volumes**:
  - `./db/data:/var/lib/postgresql/data`: Los datos de la base se guardan en tu disco local (persistencia).
  - `./db/schema.sql:/docker-entrypoint-initdb.d/schema.sql`: Al crear la base por primera vez, ejecuta el script `schema.sql` para crear las tablas y estructura inicial.

## Comandos útiles

### Levantar la base de datos

```sh
docker compose up -d
```
Esto descarga la imagen (si no la tienes), crea el contenedor y lo deja corriendo en segundo plano.

### Apagar la base de datos

```sh
docker compose down
```
Esto detiene y elimina el contenedor, pero los datos quedan guardados en `./db/data`.

### Ver logs del contenedor

```sh
docker compose logs -f
```

### Conectarte a la base desde tu PC

- **Host:** `localhost`
- **Puerto:** `5432`
- **Usuario:** `postgres`
- **Contraseña:** `mipassword`
- **Base de datos:** `mi_bd_pg`

Puedes usar DBeaver, TablePlus, PgAdmin, o cualquier cliente SQL.

---

¿Dudas? Consulta este archivo o pregunta a Copilot 😉
