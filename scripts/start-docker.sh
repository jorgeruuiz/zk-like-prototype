#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

BUILD=1
OPEN_BROWSER=1
TIMEOUT_SECONDS=120

usage() {
    cat <<'EOF'
Uso:
  bash scripts/start-docker.sh [--no-build] [--no-browser] [--timeout SEGUNDOS]

Inicia Docker Desktop/Engine si es posible, levanta Compose y espera al healthcheck.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --no-build)
            BUILD=0
            ;;
        --no-browser)
            OPEN_BROWSER=0
            ;;
        --timeout)
            shift
            TIMEOUT_SECONDS="${1:?Falta el número de segundos para --timeout}"
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
    echo "ERROR: Docker no está instalado o no está disponible en PATH." >&2
    exit 1
fi

docker_ready() {
    docker info >/dev/null 2>&1
}

start_docker_engine() {
    if docker desktop start >/dev/null 2>&1; then
        return 0
    fi

    case "$(uname -s)" in
        Darwin)
            open -a Docker
            ;;
        Linux)
            if command -v systemctl >/dev/null 2>&1; then
                systemctl --user start docker-desktop >/dev/null 2>&1 ||
                    systemctl start docker >/dev/null 2>&1 ||
                    true
            fi
            ;;
    esac
}

if ! docker_ready; then
    echo "Iniciando Docker..."
    start_docker_engine

    deadline=$((SECONDS + TIMEOUT_SECONDS))
    until docker_ready; do
        if [ "$SECONDS" -ge "$deadline" ]; then
            echo "ERROR: Docker no quedó disponible en $TIMEOUT_SECONDS segundos." >&2
            echo "Inicia Docker Desktop o el servicio docker y vuelve a intentarlo." >&2
            exit 1
        fi
        sleep 2
    done
fi

COMPOSE=(docker compose)
if [ -f ".env.docker" ]; then
    echo "Usando variables de .env.docker"
    COMPOSE+=(--env-file .env.docker)
else
    echo "No existe .env.docker; se usarán los valores de demostración de compose.yaml."
fi

UP_ARGS=(up)
if [ "$BUILD" -eq 1 ]; then
    UP_ARGS+=(--build)
fi
UP_ARGS+=(-d)

"${COMPOSE[@]}" "${UP_ARGS[@]}"

APP_PORT=3000
if [ -f ".env.docker" ]; then
    configured_port="$(
        sed -nE 's/^[[:space:]]*APP_PORT[[:space:]]*=[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' \
            .env.docker |
            tail -n 1 |
            tr -d '\r'
    )"
    if [ -n "$configured_port" ]; then
        APP_PORT="$configured_port"
    fi
fi

HEALTH_URL="http://127.0.0.1:$APP_PORT/api/health"
APP_URL="http://localhost:$APP_PORT"

health_ok() {
    if command -v curl >/dev/null 2>&1; then
        curl --fail --silent --show-error "$HEALTH_URL" 2>/dev/null |
            grep -q '"status":"ok"'
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- "$HEALTH_URL" 2>/dev/null |
            grep -q '"status":"ok"'
    else
        container_id="$("${COMPOSE[@]}" ps -q app)"
        [ -n "$container_id" ] &&
            [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id")" = "healthy" ]
    fi
}

echo "Esperando a que la aplicación esté saludable..."
deadline=$((SECONDS + TIMEOUT_SECONDS))
until health_ok; do
    if [ "$SECONDS" -ge "$deadline" ]; then
        "${COMPOSE[@]}" ps -a
        "${COMPOSE[@]}" logs --no-color --tail 80 app db-init
        echo "ERROR: la aplicación no quedó saludable en $TIMEOUT_SECONDS segundos." >&2
        exit 1
    fi
    sleep 2
done

echo
echo "Sistema ZKP iniciado correctamente."
echo "Aplicación: $APP_URL"
echo "Estado:     docker compose ps"
echo "Logs:       docker compose logs -f app"
echo "Parada:     bash scripts/stop-docker.sh"

if [ "$OPEN_BROWSER" -eq 1 ]; then
    case "$(uname -s)" in
        Darwin)
            open "$APP_URL"
            ;;
        Linux)
            if command -v xdg-open >/dev/null 2>&1; then
                xdg-open "$APP_URL" >/dev/null 2>&1 &
            fi
            ;;
    esac
fi
