

# Base de datos local con Docker y Prisma

Este proyecto recomienda usar el entorno `certi` (ver README-docker.md) para levantar la base de datos PostgreSQL, el backend y el frontend de forma aislada y reproducible. El modelo y los datos de ejemplo se gestionan con Prisma ORM.

## Concepto principal: complejo_habitacional

El modelo de datos está centrado en la entidad **complejo_habitacional**, que representa cualquier conjunto inmobiliario: condominios, residenciales, conjuntos, etc. Cada complejo puede tener bloques, casas, pisos, departamentos, cocheras y depósitos, permitiendo máxima flexibilidad y escalabilidad.

## ¿Qué hace cada parte?


Para desarrollo local, puedes levantar solo la base de datos con un comando similar, pero se recomienda usar el stack completo para pruebas realistas. El backend expone la API en el puerto 4000 (ver README-docker.md).



## Flujo recomendado de desarrollo

1. Usa el entorno `certi` para levantar todo el stack (ver README-docker.md).
2. Si solo necesitas la base, puedes usar el servicio `db-certi` del compose exclusivo.
3. Aplica migraciones y seed desde el backend del entorno `certi`.

---

## Comandos útiles



### Levantar solo la base de datos (opcional)

Puedes levantar solo el servicio de base de datos del entorno `certi` si lo necesitas para pruebas manuales.



### Apagar la base de datos

Consulta el README-docker.md para los comandos correctos según el entorno que uses.



### Ver logs del contenedor

Consulta el README-docker.md para los comandos correctos según el entorno que uses.


### Conectarte a la base desde tu PC

- **Host:** `localhost`
- **Puerto:** `5432`
- **Usuario:** `postgres`
- **Contraseña:** `mipassword`
- **Base de datos:** `mi_bd_pg`
- **Backend API:** `http://localhost:4000/api`

Puedes usar DBeaver, TablePlus, PgAdmin, o cualquier cliente SQL.

---

### Notas importantes

- El archivo `prisma/schema.prisma` define el modelo de datos. Modifica este archivo y ejecuta migraciones para cambiar la estructura.
- El script de seed (`prisma/seed.ts`) genera datos realistas para pruebas y demos, incluyendo personal, propietarios, inquilinos y unidades asociadas.
- **El seed borra todos los datos antes de poblar. No lo uses en producción.**

¿Dudas? Consulta este archivo o pregunta a Copilot 😉

---

¿Dudas? Consulta este archivo o pregunta a Copilot 😉
