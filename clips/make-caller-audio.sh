#!/usr/bin/env bash
# Render clips/caller-lines.txt to 48 kHz WAVs in clips/audio/ with ffmpeg's built-in flite voice.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p audio
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
grep -v '^#' caller-lines.txt | grep '|' | while IFS='|' read -r id text; do
  printf '%s' "$text" > "$tmp"
  # slt is the clearest flite voice; pad 300 ms of silence at both ends
  ffmpeg -nostdin -y -loglevel error -f lavfi -i "flite=textfile=$tmp:voice=slt" \
    -af "adelay=300|300,apad=pad_dur=0.3,aresample=48000" -ac 1 "audio/$id.wav"
  echo "audio/$id.wav"
done
