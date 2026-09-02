#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

REMOVE_DATA=0
REMOVE_IMAGES=0
STOP_DOCKER=0

usage() {
    cat <<'EOF'
Uso:
  bash scripts/stop-docker.sh [--remove-data] [--remove-images] [--stop-docker]

Opciones:
  --remove-data  Elimina también el volumen PostgreSQL.
  --remove-images  Elimina las imágenes locales construidas para el prototipo.
  --stop-docker  Intenta cerrar Docker Desktop después de detener el prototipo.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --remove-data)
            REMOVE_DATA=1
            ;;
        --remove-images)
            REMOVE_IMAGES=1
            ;;
        --stop-docker)
            STOP_DOCKER=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: opción desconocida: $1" >&2
            usage
            exit 2
            ;;
    esac
    shift
done

if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: Docker no está instalado." >&2
    exit 1
fi

COMPOSE=(docker compose)
if [ -f ".env.docker" ]; then
    COMPOSE+=(--env-file .env.docker)
fi

DOWN_ARGS=(down)
if [ "$REMOVE_DATA" -eq 1 ]; then
    DOWN_ARGS+=(--volumes)
fi
if [ "$REMOVE_IMAGES" -eq 1 ]; then
    DOWN_ARGS+=(--rmi local)
fi
"${COMPOSE[@]}" "${DOWN_ARGS[@]}"

if [ "$REMOVE_DATA" -eq 1 ] && [ "$REMOVE_IMAGES" -eq 1 ]; then
    echo "Sistema detenido; se eliminaron el volumen PostgreSQL y las imágenes locales del prototipo."
elif [ "$REMOVE_DATA" -eq 1 ]; then
    echo "Sistema detenido y volumen PostgreSQL eliminado."
elif [ "$REMOVE_IMAGES" -eq 1 ]; then
    echo "Sistema detenido e imágenes locales del prototipo eliminadas."
else
    echo "Sistema detenido. Los datos PostgreSQL y las imágenes se conservan."
fi

if [ "$STOP_DOCKER" -eq 1 ]; then
    if docker desktop stop >/dev/null 2>&1; then
        echo "Docker Desktop detenido."
    elif [ "$(uname -s)" = "Darwin" ]; then
        osascript -e 'quit app "Docker"' >/dev/null
        echo "Docker Desktop detenido."
    elif [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
        systemctl --user stop docker-desktop >/dev/null 2>&1 || true
        echo "Se solicitó la parada de Docker Desktop."
    else
        echo "AVISO: el prototipo se detuvo, pero Docker no pudo cerrarse automáticamente." >&2
    fi
fi
