#!/bin/sh
# Manual AC14 check: starts a test Pi with this extension in dev mode, an isolated agent dir, and the scripted offline
# test model. Run it in a plain Ghostty window, NOT inside tmux:
#   sh /path/to/pi-interactive-widgets/tests/e2e/plain-ghostty.sh
# The agent dir (with env.txt and the dev log dev.log) is printed first and kept for inspection.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DIR="${TMPDIR:-/tmp}"
DIR="${DIR%/}/piw-ghostty-manual"
rm -rf "$DIR"
mkdir -p "$DIR"
printf 'TERM_PROGRAM=%s\nTERM=%s\nTMUX=%s\n' "${TERM_PROGRAM:-}" "${TERM:-}" "${TMUX:-}" > "$DIR/env.txt"
if [ -n "${TMUX:-}" ]; then echo "This check must run outside tmux (TMUX is set)." >&2; exit 1; fi
echo "test Pi agent dir: $DIR"
cd "$ROOT"
exec env PI_WIDGETS_DEV=1 PI_WIDGETS_DEV_LOG="$DIR/dev.log" PI_CODING_AGENT_DIR="$DIR" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 \
	pi -ne -ns -np -nc --no-session -e ./src/index.ts -e ./tests/e2e/probe-extension.ts --model e2e-faux/echo --tui-mode fullscreen
