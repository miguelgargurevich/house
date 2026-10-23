# HANDOFF

Entradas por fecha (la más reciente arriba).

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/plataforma-staff`

**Qué se hizo**
- Superadmin: `Dashboard` (resumen global), `Empresas` (CRUD, RUC de 11 dígitos), `Auditoria` (sólo lectura + modal con `detalle`), `Usuarios` re-exporta `admin/Usuarios`.
- `admin/Usuarios`: filtro por rol, filtro por empresa y selector de empresa en el formulario (sólo superadmin).
- Mantenimiento: `Inicio` (StatStrip + 3 tareas abiertas) y `Tareas` (Tabs por estado, tarjeta con un botón de acción). Piezas en `mantenimiento/_parts/TareaCard.tsx`.
- Seguridad: `Inicio` y `Unidades` (lectura, búsqueda).
- Piezas de superadmin en `superadmin/_parts/` (`EstadoCargos`, `fechas`).

**Próximos pasos**
- Integrar con el backend nuevo y revisar visualmente (nada se ha visto con datos reales).
- Confirmar con el backend los nombres de campos/filtros de `/api/auditoria` (ver gotchas).

**Gotchas**
- `/api/auditoria` no está en el contrato ni en `schema.prisma`: se asumió `{id, fecha|created_at, usuario:{nombre}|usuario_nombre, accion, entidad, entidad_id, ip, detalle}` y filtros `?entidad=&accion=&orden=fecha:desc`. Acciones esperadas: crear, editar, eliminar, login; entidades en singular minúscula (usuario, empresa, unidad…). Si el backend usa otros valores, ajustar `ACCIONES`/`ENTIDADES` en `superadmin/Auditoria.tsx`.
- `/api/tareas` se asume con `unidad:{id,codigo}` incluido y `orden=fecha_creacion:desc`. El backend debería filtrar por el usuario asignado cuando el rol es mantenimiento.
- Usuarios: se envía `empresa_id` sólo si el usuario actual es superadmin (`null` para rol superadmin). Empresa obligatoria en el formulario para admin, mantenimiento y seguridad.
- `IconButton` del kit mide 36 px (h-9), por debajo del objetivo táctil de 40 px.
