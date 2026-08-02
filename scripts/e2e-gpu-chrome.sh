#!/usr/bin/env bash
# Launch Chrome on the Windows host with CDP enabled, then find a URL where WSL can
# reach it, for the Tier B (real GPU) Playwright suite (docs/E2E.md).
#
#   ./scripts/e2e-gpu-chrome.sh
#   export AEROFLOW_CDP_URL=<printed url>
#   npm run test:e2e:gpu
#
# The dedicated --user-data-dir is mandatory: Chrome 136+ ignores --remote-debugging-port
# on the default profile, and it keeps the e2e session out of the daily browser profile.
set -euo pipefail

CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
PORT=9222
PROXY_PORT=9223

if [[ ! -x "$CHROME" ]]; then
  echo "Chrome not found at $CHROME" >&2
  exit 1
fi

probe() {
  curl -fsS --max-time 3 "$1/json/version" >/dev/null 2>&1
}

if ! probe "http://localhost:$PORT" && ! probe "http://127.0.0.1:$PORT"; then
  echo "starting Windows Chrome with --remote-debugging-port=$PORT ..."
  "$CHROME" \
    --remote-debugging-port=$PORT \
    --user-data-dir='C:\Temp\aeroflow-e2e-profile' \
    --no-first-run --no-default-browser-check \
    >/dev/null 2>&1 &
  sleep 3
fi

# 1) Mirrored networking (.wslconfig networkingMode=mirrored): localhost works directly.
for url in "http://localhost:$PORT" "http://127.0.0.1:$PORT"; do
  if probe "$url"; then
    echo "CDP reachable."
    echo "export AEROFLOW_CDP_URL=$url"
    exit 0
  fi
done

# 2) NAT mode: CDP binds to Windows loopback only; a portproxy on the host bridges it.
GATEWAY=$(ip route show default | awk '{print $3; exit}')
if probe "http://$GATEWAY:$PROXY_PORT"; then
  echo "CDP reachable via portproxy."
  echo "export AEROFLOW_CDP_URL=http://$GATEWAY:$PROXY_PORT"
  exit 0
fi

cat >&2 <<EOF
Chrome is running but CDP is not reachable from WSL. Two fixes (either works):

A) Mirrored networking (recommended, Windows 11 22H2+):
   add to %UserProfile%\\.wslconfig:
       [wsl2]
       networkingMode=mirrored
   then run 'wsl --shutdown' from Windows and retry.

B) NAT portproxy (one-time, admin PowerShell on Windows):
   netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$PROXY_PORT connectaddress=127.0.0.1 connectport=$PORT
   New-NetFirewallRule -DisplayName aeroflow-cdp -Direction Inbound -LocalPort $PROXY_PORT -Protocol TCP -Action Allow
   then retry; the URL will be http://$GATEWAY:$PROXY_PORT
EOF
exit 1
