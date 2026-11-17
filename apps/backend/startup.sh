#!/bin/bash
# Azure App Service (Linux) startup: makes sure Blender is available for the Interior 3D
# render worker, then starts the API. Blender lives under /home (persistent across restarts);
# the install runs in the background so the API is up immediately. Until it finishes,
# render jobs fail with a retryable "Blender not found" and the UI offers Retry.
BLENDER_VERSION="${BLENDER_VERSION:-4.2.3}"
BLENDER_DIR="${BLENDER_DIR:-/home/blender}"

install_blender() {
  # Complete only if the marker exists AND Blender's bundled Python is present (a restart
  # mid-extract leaves the binary without its python/ folder).
  if [ -f "$BLENDER_DIR/.installed" ] && ls "$BLENDER_DIR"/*/python/lib >/dev/null 2>&1; then return 0; fi
  # /home is shared by every instance of the app: only one may install at a time. mkdir is
  # atomic; a lock older than 30 minutes is treated as left over from a crashed install.
  LOCK="$BLENDER_DIR.lock"
  waited=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rm -rf "$LOCK"; continue; fi
    echo "[startup] another instance is installing Blender; waiting"
    sleep 20; waited=$((waited + 20))
    if [ -f "$BLENDER_DIR/.installed" ] && ls "$BLENDER_DIR"/*/python/lib >/dev/null 2>&1; then return 0; fi
    if [ "$waited" -gt 2400 ]; then echo "[startup] gave up waiting for the install lock"; return 1; fi
  done
  trap 'rm -rf "$LOCK"' RETURN
  rm -rf "$BLENDER_DIR"/* "$BLENDER_DIR"/.installed 2>/dev/null
  echo "[startup] installing Blender $BLENDER_VERSION into $BLENDER_DIR"
  mkdir -p "$BLENDER_DIR" /home/tmp
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
    xz-utils libxi6 libxrender1 libxkbcommon0 libxxf86vm1 libxfixes3 libxext6 libx11-6 libsm6 libgl1 libegl1 libgomp1 ca-certificates) \
    || echo "[startup] apt step failed (continuing)"
  MAJOR="${BLENDER_VERSION%.*}"
  URL="https://download.blender.org/release/Blender${MAJOR}/blender-${BLENDER_VERSION}-linux-x64.tar.xz"
  echo "[startup] downloading $URL"
  # Stream straight into tar (no temp file), with retries; the pipe fails if either side fails.
  set -o pipefail
  for attempt in 1 2 3; do
    if curl -fL --retry 3 --retry-delay 5 --connect-timeout 30 "$URL" | tar -xJm --no-same-owner -C "$BLENDER_DIR" --strip-components=1; then
      touch "$BLENDER_DIR/.installed"
      echo "[startup] Blender installed: $("$BLENDER_DIR/blender" --version 2>&1 | head -1)"
      return 0
    fi
    echo "[startup] attempt $attempt failed"
    rm -rf "$BLENDER_DIR"/* 2>/dev/null
    sleep 5
  done
  echo "[startup] Blender install failed after 3 attempts"
}

# Runtime libraries are not persistent (container filesystem), so always run the apt step,
# but only download Blender once.
( install_blender >> /home/LogFiles/blender-install.log 2>&1 ) &

exec node apps/backend/dist/index.js
