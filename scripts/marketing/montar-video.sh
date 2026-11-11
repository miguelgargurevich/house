#!/usr/bin/env bash
# Monta un video de marketing: cada clip de grabar-video.mjs / grabar-app.mjs / grabar-iphone.mjs (sin lo que tardó en cargar) con su voz, en orden, y exporta un MP4 H.264 + AAC
# listo para redes. Uso: scripts/marketing/montar-video.sh <video> <escritorio|celular|iphone> [oscuro]
#   «iphone»: clips de grabar-iphone.mjs (9:16) y, si existe, la voz de voz-iphone/ (v9 cambia la escena 1: Safari en vez de «Descargar para Android»).
#   → .claude/videos/<video>/torre-<video>-<formato>.mp4  (con «oscuro»: clips de <formato>-oscuro/ y torre-<video>-<formato>-oscuro.mp4)
set -euo pipefail
video="${1:-v1}"; formato="${2:-escritorio}"; tema="${3:-}"
[ -z "$tema" ] || [ "$tema" = oscuro ] || { echo "tema? (vacío u oscuro)"; exit 1; }
dir="$formato${tema:+-$tema}"
base="$(pwd)/.claude/videos/$video"; clips="$base/$dir"; voz="$base/voz"
[ ! -d "$base/voz-$formato" ] || voz="$base/voz-$formato"
[ -f "$clips/recortes.json" ] || { echo "Falta $clips/recortes.json: graba primero"; exit 1; }
case "$formato" in escritorio) ancho=1920; alto=1080 ;; celular|iphone) ancho=1080; alto=1920 ;; *) echo "formato?"; exit 1 ;; esac
tmp="$clips/montaje"; rm -rf "$tmp"; mkdir -p "$tmp"
lista="$tmp/lista.txt"; : > "$lista"
n=1
# Clip de la escena: .webm (escritorio, Playwright) o .mp4 (celular, adb screenrecord o la tarjeta de cierre).
clip_de() { for ext in webm mp4; do [ -f "$clips/e$1.$ext" ] && { echo "$clips/e$1.$ext"; return; }; done; }
# FONDO: color de las franjas cuando el clip no llena el cuadro (el celular, 1080x2340, entra en 9:16 con franjas).
fondo="${FONDO:-white}"
while clip=$(clip_de "$n") && [ -n "$clip" ]; do
  recorte=$(python3 -c "import json;print(json.load(open('$clips/recortes.json'))['e$n'])")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$voz/e$n.wav")
  largo=$(python3 -c "print(round($dur + 0.7, 3))")
  # Escena: el video desde que la pantalla quedó lista, del largo de su voz (+0.7 s); la voz entra a los 0.2 s.
  # iphone: simctl recordVideo sólo guarda cuadros cuando la pantalla cambia; un -ss de entrada descartaría el cuadro inicial (el inicio del teléfono,
  # fijo hasta el primer toque). Se rellena a 30 fps ANTES de recortar.
  if [ "$formato" = iphone ]; then
    ffmpeg -v error -y -i "$clip" -i "$voz/e$n.wav" \
      -filter_complex "[0:v]fps=30,trim=start=${recorte},setpts=PTS-STARTPTS,scale=${ancho}:${alto}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2:color=${fondo},fps=30,format=yuv420p,tpad=stop_mode=clone:stop_duration=30[v];[1:a]adelay=200|200,apad,aresample=48000,aformat=channel_layouts=stereo[a]" \
      -map "[v]" -map "[a]" -t "$largo" -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k "$tmp/e$n.mp4"
  else
  ffmpeg -v error -y -ss "$recorte" -i "$clip" -i "$voz/e$n.wav" \
    -filter_complex "[0:v]scale=${ancho}:${alto}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2:color=${fondo},fps=30,format=yuv420p,tpad=stop_mode=clone:stop_duration=30[v];[1:a]adelay=200|200,apad,aresample=48000,aformat=channel_layouts=stereo[a]" \
    -map "[v]" -map "[a]" -t "$largo" -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k "$tmp/e$n.mp4"
  fi
  echo "file 'e$n.mp4'" >> "$lista"
  n=$((n + 1))
done
salida="$base/torre-$video-$dir.mp4"
ffmpeg -v error -y -f concat -safe 0 -i "$lista" -c copy -movflags +faststart "$salida"
printf '%s  %.1f s\n' "$salida" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$salida")"
