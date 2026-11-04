#!/usr/bin/env bash
# Graba y monta los videos del manual (escritorio 16:9): para cada video → voz (debe existir) → grabar → montar → hoja de revisión.
# Se puede reanudar: sin argumentos recorre la lista y SALTA los que ya tienen su mp4. Con ids, graba sólo esos (aunque ya existan).
# Uso (desde la raíz del repo o del worktree, con la app local en 5173 y 4000):
#   scripts/marketing/grabar-manual.sh                        # todos los pendientes
#   scripts/marketing/grabar-manual.sh m-admin-recibos …      # sólo esos, volviendo a grabarlos
# La voz NO la genera este script: sale de `audio_generar` (My Workspace, voice ef_dora); `node scripts/marketing/videos-manual.mjs --voz` deja el texto de
# cada escena en .claude/videos/voz-manual.json, y scripts/marketing/bajar-voz.sh baja los .wav. Un solo Chromium y un solo ffmpeg a la vez.
set -uo pipefail
cd "$(dirname "$0")/../.."
FORMATO=escritorio
if [ "$#" -gt 0 ]; then ids=("$@"); forzar=1; else ids=($(node scripts/marketing/videos-manual.mjs --pendientes)); forzar=0; fi
[ "${#ids[@]}" -gt 0 ] || { echo "No hay videos pendientes."; node scripts/marketing/videos-manual.mjs --lista; exit 0; }
# Tareas de prueba de mantenimiento y limpieza (idempotente; base LOCAL). NO_PREPARAR=1 lo salta.
[ "${NO_PREPARAR:-0}" = 1 ] || node scripts/marketing/videos-manual.mjs --preparar || echo "AVISO: no se pudieron preparar las tareas de prueba"
ok=(); fallo=()
for id in "${ids[@]}"; do
  mp4=".claude/videos/$id/torre-$id-$FORMATO.mp4"
  if [ "$forzar" = 0 ] && [ -f "$mp4" ]; then echo "== $id: ya está ($mp4), se salta"; continue; fi
  faltan=$(node scripts/marketing/videos-manual.mjs --voz-falta "$id")
  if [ -n "$faltan" ]; then echo "== $id: FALTA la voz de las escenas: $faltan (genéralas con audio_generar y bájalas con bajar-voz.sh)"; fallo+=("$id (sin voz)"); continue; fi
  echo "== $id"
  mkdir -p ".claude/videos/$id"
  if ! nice node scripts/marketing/grabar-video.mjs "$id" "$FORMATO" 2>&1 | tee ".claude/videos/$id/grabar.log" | grep -E '^  |Error|error'; then :; fi
  if [ ! -f ".claude/videos/$id/$FORMATO/recortes.json" ]; then fallo+=("$id (no grabó)"); continue; fi
  if nice scripts/marketing/montar-video.sh "$id" "$FORMATO" && scripts/marketing/hoja-video.sh "$id" "$FORMATO" >/dev/null; then ok+=("$id"); else fallo+=("$id (no montó)"); fi
done
echo; echo "Listos: ${#ok[@]}"; [ "${#fallo[@]}" -gt 0 ] && { echo "Con problemas:"; printf '  %s\n' "${fallo[@]}"; }
node scripts/marketing/videos-manual.mjs --lista
