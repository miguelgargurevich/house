# HANDOFF — house

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama feat/admin-cobranza

**Qué se hizo:** pantallas de cobranza del administrador, escritas contra `docs/API-CONTRATO.md` (sin backend nuevo para probarlas):
- `Recibos` (lista + filtro por condominio + modal «Emitir recibo» + detalle con cargos por unidad).
- `Pagos` (lista, filtro por método, `StatStrip`, modal «Registrar pago»).
- `Morosidad` (`StatStrip`, tabla con `Badge` ámbar/rojo, exportar CSV con BOM UTF-8).
- `Mantenimientos` (`Tabs` por estado, crear/editar, botones Iniciar/Completar).
- Piezas compartidas en `src/pages/admin/_parts/cobranza/`.

**Próximos pasos:** integrar con el backend nuevo y revisar en el navegador (430 px y escritorio, claro/oscuro).

**Decisiones / gotchas:**
- Los modales se montan sólo cuando están abiertos (`{abierto && <Modal open …/>}`), así cada apertura empieza con formulario y fetch limpios.
- «Registrar pago» pide aparte `estado=pendiente` y `estado=vencido`: el contrato calcula `estado` por fecha, y un cargo vencido ya no es «pendiente».
- Morosidad: el contrato no dice si `unidad`/`propietario` llegan como objeto o texto; se aceptan ambos. Pide `pageSize=100` y los totales del `StatStrip` salen de las filas cargadas (`unidades morosas` usa `total`).
- Selects de unidades y personal en el modal de tareas cargan `pageSize=100` (máximo del contrato): con más de 100 unidades faltarán opciones.
- La edición de tarea usa `PUT /api/tareas/:id` (el contrato sólo nombra POST y el PATCH de estado).
