#!/usr/bin/env bash
# Backend aislado para las E2E: copia la base local `house` (semilla Los Libertadores) a una base propia y la sirve con el dist/ del
# checkout principal, SIN envíos reales (correo y WhatsApp apagados). Nunca toca la base `house` ni producción.
# Uso: bash scripts/e2e/levantar.sh [puerto=4100] [base=house_e2e] [--sin-copiar]   (--sin-copiar: reinicia sin volver a copiar la base)
# Antes: `npm run build` en el checkout principal. Log en ${TMPDIR:-/tmp}/house-e2e-<puerto>.log.
# Mercado simulado (ver docs/pruebas/simulacion-mercado.md): `bash scripts/e2e/levantar.sh 4110 house_mercado` sirve la base `house_mercado` (sembrada con
# `npm run seed:mercado`) y NUNCA la copia desde `house` (siempre --sin-copiar). `HOUSE_REPO=<carpeta>` elige qué código sirve (por defecto, el checkout principal;
# en un worktree: HOUSE_REPO=$PWD, con su propio dist/ si hace falta el frontend).
set -euo pipefail
P=${1:-4100}; DB=${2:-house_e2e}; COPIAR=1; [ "${3:-}" = "--sin-copiar" ] && COPIAR=0
[[ $DB =~ ^house_e2e[a-z0-9_]*$ || $DB = house_mercado ]] || { echo "La base debe llamarse house_e2e… o house_mercado"; exit 1; }
[ "$DB" = house_mercado ] && COPIAR=0
cd "${HOUSE_REPO:-$HOME/Projectos/house}"
pid=$(lsof -nP -tiTCP:$P -sTCP:LISTEN || true); [ -n "$pid" ] && kill $pid && sleep 2
if [ $COPIAR = 1 ]; then
  docker exec house-pg sh -c "dropdb -U postgres --if-exists $DB && createdb -U postgres $DB && pg_dump -U postgres -Fc house | pg_restore -U postgres -d $DB --no-owner"
  # Registro abierto en la copia (los flujos de registro lo necesitan).
  docker exec house-pg psql -U postgres -d $DB -qc 'update "ConfiguracionComercial" set registro_abierto = true'
fi
PORT=$P DATABASE_URL=postgresql://postgres:house@localhost:5433/$DB CORS_ORIGIN=http://localhost:$P \
  RESEND_API_KEY= MAIL_FROM= EVOLUTION_URL= EVOLUTION_APIKEY= AVISOS_PLANIFICADOR=off \
  nohup npx tsx src/server.ts > "${TMPDIR:-/tmp}/house-e2e-$P.log" 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}' localhost:$P/api/auth/me | grep -q 401 && { echo "listo: http://localhost:$P ($DB)"; exit 0; }; sleep 1; done
echo "backend $P no responde"; tail -20 "${TMPDIR:-/tmp}/house-e2e-$P.log"; exit 1
