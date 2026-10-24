#!/usr/bin/env bash
# Concatenate clips into clips/proposal_cut.mp4. Clips without audio get a silent track so the
# cut has continuous AAC audio. Default list is the brief's: C01 C04 C05 C06 C16 (~45 s).
# Add clips to reach 60-90 s, e.g.:  ./build-proposal.sh C01 C02 C04 C05 C06 C15 C16
set -euo pipefail
cd "$(dirname "$0")"
ids=("$@"); [ $# -eq 0 ] && ids=(C01 C04 C05 C06 C16)
inputs=() filters="" n=0
for id in "${ids[@]}"; do
  f=$(ls ${id}_*.mp4 2>/dev/null | head -1) || true
  [ -z "$f" ] && { echo "missing clip $id (record it first)"; exit 1; }
  inputs+=(-i "$f")
  if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f" | grep -q .; then
    filters+="[$n:a]aresample=48000,aformat=channel_layouts=stereo[a$n];"
  else
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
    filters+="anullsrc=r=48000:cl=stereo,atrim=0:$d[a$n];"
  fi
  filters+="[$n:v]fps=30,format=yuv420p,setsar=1[v$n];"
  n=$((n + 1))
done
concat=""
for i in $(seq 0 $((n - 1))); do concat+="[v$i][a$i]"; done
ffmpeg -nostdin -y -loglevel error "${inputs[@]}" -filter_complex "${filters}${concat}concat=n=$n:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 18 -c:a aac -b:a 160k -movflags +faststart proposal_cut.mp4
echo "proposal_cut.mp4 $(ffprobe -v error -show_entries format=duration -of csv=p=0 proposal_cut.mp4)s"
