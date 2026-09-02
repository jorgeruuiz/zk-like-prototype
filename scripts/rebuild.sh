#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

MODE=""
RESET_USERS=0
RESET_DATA=0
NO_CACHE=0

usage() {
    cat <<'EOF'
Uso:
  bash scripts/rebuild.sh --local [--reset-users]
  bash scripts/rebuild.sh --docker [--reset-users | --reset-data] [--no-cache]

Reconstruye el entorno sin borrar datos por defecto.

Opciones:
  --local        Reinstala dependencias y prepara PostgreSQL local usando .env.
  --docker       Reconstruye las imágenes y levanta Docker Compose.
  --reset-users  Vacía únicamente la tabla usuarios después de reconstruir.
  --reset-data   Solo Docker: elimina el volumen PostgreSQL y crea una base nueva.
  --no-cache     Solo Docker: reconstruye las imágenes sin usar caché.
  -h, --help     Muestra esta ayuda.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --local|--docker)
            if [ -n "$MODE" ]; then
                echo "ERROR: elige solo uno de --local o --docker." >&2
                exit 2
            fi
            MODE="${1#--}"
            ;;
        --reset-users)
            RESET_USERS=1
            ;;
        --reset-data)
            RESET_DATA=1
            ;;
        --no-cache)
            NO_CACHE=1
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

if [ -z "$MODE" ]; then
    echo "ERROR: indica explícitamente --local o --docker." >&2
    usage
    exit 2
fi

if [ "$RESET_USERS" -eq 1 ] && [ "$RESET_DATA" -eq 1 ]; then
    echo "ERROR: --reset-users y --reset-data son excluyentes." >&2
    exit 2
fi

if [ "$MODE" = "local" ] && { [ "$RESET_DATA" -eq 1 ] || [ "$NO_CACHE" -eq 1 ]; }; then
    echo "ERROR: --reset-data y --no-cache solo se aplican a Docker." >&2
    exit 2
fi

if [ "$MODE" = "local" ]; then
    if [ -f ".env" ]; then
        set -a
        # shellcheck disable=SC1091
        source .env
        set +a
    fi

    DB_USER="${DB_USER:-postgres}"
    DB_NAME="${DB_NAME:-server_zkp}"
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    export PGPASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"

    DB_USER="${DB_USER//$'\r'/}"
    DB_NAME="${DB_NAME//$'\r'/}"
    DB_HOST="${DB_HOST//$'\r'/}"
    DB_PORT="${DB_PORT//$'\r'/}"

    if ! command -v npm >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
        echo "ERROR: npm y psql deben estar disponibles en PATH." >&2
        exit 1
    fi

    echo "Instalando exactamente las dependencias de package-lock.json..."
    npm ci

    echo "Comprobando PostgreSQL local..."
    if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
        -tAc "SELECT 1" >/dev/null 2>&1; then
        echo "ERROR: no se puede conectar a PostgreSQL con DB_USER=$DB_USER." >&2
        echo "Revisa .env y que el servicio PostgreSQL esté iniciado." >&2
        exit 1
    fi

    if [ "$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
        -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != "1" ]; then
        echo "Creando la base de datos '$DB_NAME'..."
        psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
            -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
    fi

    echo "Creando o migrando el esquema..."
    npm run db:setup

    if [ "$RESET_USERS" -eq 1 ]; then
        bash scripts/clean.sh --local --yes
    fi

    echo "Reconstrucción local finalizada. Arranca con: npm start"
else
    if ! command -v docker >/dev/null 2>&1; then
        echo "ERROR: Docker no está instalado." >&2
        exit 1
    fi

    docker_ready() {
        docker info >/dev/null 2>&1
    }

    if ! docker_ready; then
        echo "Iniciando Docker..."
        docker desktop start >/dev/null 2>&1 || {
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

        deadline=$((SECONDS + 120))
        until docker_ready; do
            if [ "$SECONDS" -ge "$deadline" ]; then
                echo "ERROR: Docker no quedó disponible en 120 segundos." >&2
                exit 1
            fi
            sleep 2
        done
    fi

    COMPOSE=(docker compose)
    if [ -f ".env.docker" ]; then
        COMPOSE+=(--env-file .env.docker)
    fi

    echo "Deteniendo el despliegue anterior..."
    DOWN_ARGS=(down)
    if [ "$RESET_DATA" -eq 1 ]; then
        DOWN_ARGS+=(--volumes)
    fi
    "${COMPOSE[@]}" "${DOWN_ARGS[@]}"

    echo "Reconstruyendo imágenes Docker..."
    BUILD_ARGS=(build)
    if [ "$NO_CACHE" -eq 1 ]; then
        BUILD_ARGS+=(--no-cache)
    fi
    "${COMPOSE[@]}" "${BUILD_ARGS[@]}"

    bash scripts/start-docker.sh --no-build --no-browser

    if [ "$RESET_USERS" -eq 1 ]; then
        bash scripts/clean.sh --docker --yes
    fi

    echo "Reconstrucción Docker finalizada. Aplicación: http://localhost:${APP_PORT:-3000}"
fi
