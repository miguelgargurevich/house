#!/usr/bin/env bash
# Revisión de un video del manual: saca 3 cuadros a .claude/videos/<video>/hoja/f1..f3.jpg — el final de cada escena (con 2 escenas, el final de la
# primera, el medio de la segunda y su final) — y los une en hoja.jpg (3 cuadros en columna) para mirarlos de una vez.
# Uso: scripts/marketing/hoja-video.sh <video> [escritorio]
set -euo pipefail
video="$1"; formato="${2:-escritorio}"
base=".claude/videos/$video"; mp4="$base/torre-$video-$formato.mp4"; hoja="$base/hoja"
[ -f "$mp4" ] || { echo "Falta $mp4"; exit 1; }
rm -rf "$hoja"; mkdir -p "$hoja"
tiempos=$(python3 - "$base" <<'PY'
import subprocess, sys, glob, os
base = sys.argv[1]
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).decode())
largos = [dur(f) + 0.7 for f in sorted(glob.glob(os.path.join(base, 'voz', 'e*.wav')), key=lambda x: int(os.path.basename(x)[1:-4]))]
fin = [sum(largos[:i+1]) for i in range(len(largos))]
if len(largos) >= 3: t = [fin[0]-0.3, fin[1]-0.3, fin[2]-0.3]
else: t = [fin[0]-0.3, fin[0] + largos[1]*0.55, fin[1]-0.3]
print(' '.join(f'{x:.2f}' for x in t))
PY
)
i=1
for t in $tiempos; do
  ffmpeg -v error -y -ss "$t" -i "$mp4" -frames:v 1 -q:v 3 "$hoja/f$i.jpg"
  i=$((i+1))
done
ffmpeg -v error -y -i "$hoja/f1.jpg" -i "$hoja/f2.jpg" -i "$hoja/f3.jpg" -filter_complex "[0:v]scale=960:540[a];[1:v]scale=960:540[b];[2:v]scale=960:540[c];[a][b][c]vstack=inputs=3" -frames:v 1 -q:v 3 "$hoja/hoja.jpg"
echo "$hoja/hoja.jpg"
