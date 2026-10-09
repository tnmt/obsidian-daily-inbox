#!/bin/sh
# Reads repository paths on stdin and fails if any of them may hold personal
# data. gitleaks cannot enforce this: its default global allowlist skips image
# extensions and git-mode scans ignore binary diffs.
set -eu

forbidden='\.(jpe?g|png|heic|heif|gif|webp|tiff?|dng|raw|mov|mp4|m4v|gpx|kml|kmz|geojson|sqlite3?|db|db-wal|db-shm|pem|key|p12|pfx)$|(^|/)(History|Local State|Cookies|Login Data|data\.json|\.env(\..*)?)$|(^|/)\.obsidian/'
# Notes belong in the vault; only project docs are allowed as Markdown.
allowed_markdown='^((README|AGENTS|CHANGELOG|CLAUDE|LICENSE)\.md|docs/[^/]+\.md)$'

offending=$(
  sort -u | while IFS= read -r path; do
    [ -z "$path" ] && continue
    if printf '%s\n' "$path" | grep -Eiq "$forbidden"; then
      printf '%s\n' "$path"
    elif printf '%s\n' "$path" | grep -Eq '\.md$' && ! printf '%s\n' "$path" | grep -Eq "$allowed_markdown"; then
      printf '%s\n' "$path"
    fi
  done
)

if [ -n "$offending" ]; then
  echo "Refusing paths that may contain personal data:" >&2
  printf '%s\n' "$offending" | sed 's/^/  /' >&2
  exit 1
fi
