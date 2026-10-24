# Respaldos de la base `house`

Fecha de la verificación: 2026-10-24 · Responsable: Miguel · Sistema: el 3-2-1 del VPS (skill `backups`).

## Cómo queda cubierta
`house` vive en el PostgreSQL compartido del VPS (contenedor `postgres`, base `house`, usuario `house`). El respaldo diario del VPS usa `pg_dumpall`, que incluye **todas** las bases y roles, así que `house` entra sin configurar nada:

| Capa | Qué | Cuándo | Retención |
|---|---|---|---|
| Local | `/opt/backups/postgres_<fecha>.sql.gz` (`backup.sh`) | 02:00 hora del servidor (00:00 UTC) | 3 días |
| Externa | copia a Cloudflare R2 (`r2-backup-sync.sh`) | 02:20 | 30 días |
| Secretos | `.env` y similares cifrados con GPG (`secrets-vault.sh`) | 02:10 | — |

Las variables de la app en Coolify (`DATABASE_URL`, `JWT_SECRET`, `LLAVERO_ENC_KEY`, …) **no** están en el volcado de PostgreSQL. Se guardan en la configuración de Coolify, cuyos archivos sí respalda `backup.sh` (`coolify-apps`). `LLAVERO_ENC_KEY` es crítica: sin ella las claves del llavero guardadas en la base no se pueden descifrar (hay que volver a cargarlas).

## Simulacro de restauración (hecho el 2026-10-24)
1. Contenedor temporal: `docker run -d --rm --name house-restore-drill -e POSTGRES_PASSWORD=drill postgres:16-alpine`.
2. Ubicar la base dentro del volcado: `zcat postgres_<fecha>.sql.gz | grep -n -E '^.connect '` → la sección de `house` va de `CREATE DATABASE house` hasta el siguiente `\connect`.
3. Restaurar solo esa sección más `CREATE ROLE house;`: `zcat … | awk 'NR>=<inicio> && NR<=<fin> || /^CREATE ROLE house;/ {print}' | docker exec -i house-restore-drill psql -U postgres -q`.
4. Verificar: tablas (14), usuarios, superadmins y que exista `ClaveIntegracion`. Resultado: coincide con producción.
5. Limpiar: `docker stop house-restore-drill` (el contenedor se borra solo por `--rm`).

Para una restauración real sobre producción: detener la app en Coolify, restaurar la base `house` desde el volcado más reciente (o desde R2 si el local ya rotó) y volver a desplegar. Si cambió `LLAVERO_ENC_KEY`, volver a cargar las claves del llavero.

## Pendientes y observaciones
- **Repetir el simulacro** cada 3 meses y después de cambios grandes del esquema.
- **No verificado:** el contenido de R2 (no hay `rclone` en el shell de operaciones); el log de la sincronización dice «completed» y reporta 152 objetos.
- **Costo:** R2 reporta ~19,8 GiB frente a los ~1,9 GB «a régimen» que decía la documentación del respaldo (el nivel gratuito es 10 GB). Conviene revisar la retención de lo más pesado (volcados de ~124 MB al día).
