#!/usr/bin/env bash
# Baja a .claude/videos/<video>/voz/e<N>.wav las voces que devolvió `audio_generar` (My Workspace, voz ef_dora).
# Uso: scripts/marketing/bajar-voz.sh "<video> <escena> <hash-o-url>" …      (cada argumento es una voz; el hash es lo que sigue a «voz-» en la URL)
set -euo pipefail
for a in "$@"; do
  set -- $a; video="$1"; n="$2"; h="${3##*/}"; h="${h%.wav}"; h="${h#voz-}"
  mkdir -p ".claude/videos/$video/voz"
  curl -fsS -o ".claude/videos/$video/voz/e$n.wav" "https://api-dashboardia.gargurevich.dev/media/voz-$h.wav"
  printf '%s e%s %.1f s\n' "$video" "$n" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 ".claude/videos/$video/voz/e$n.wav")"
done
