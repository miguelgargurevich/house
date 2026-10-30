#!/usr/bin/env bash
# Reinicia el backend LOCAL de house (remitentes apagados) para vaciar el límite de solicitudes en memoria antes de grabar.
cd ~/Projectos/house
pid=$(lsof -nP -tiTCP:4000 -sTCP:LISTEN); [ -n "$pid" ] && kill $pid; sleep 2
RESEND_API_KEY= MAIL_FROM= EVOLUTION_URL= EVOLUTION_APIKEY= AVISOS_PLANIFICADOR=off nohup npm run backend > "${TMPDIR:-/tmp}/house-backend.log" 2>&1 &
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}' localhost:5173/api/auth/me | grep -q 401 && exit 0; sleep 1; done; echo "backend no responde"; exit 1
