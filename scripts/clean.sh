#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

MODE=""
ASSUME_YES=0

usage() {
    cat <<'EOF'
Uso:
  bash scripts/clean.sh --local [--yes]
  bash scripts/clean.sh --docker [--yes]

Vacía la tabla usuarios y reinicia su secuencia de identificadores.
No elimina node_modules, imágenes Docker ni el volumen PostgreSQL.

Opciones:
  --local    Usa PostgreSQL local y las variables de .env.
  --docker   Usa PostgreSQL dentro de Docker Compose.
  --yes      Omite la confirmación interactiva.
  -h, --help Muestra esta ayuda.
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
        --yes|-y)
            ASSUME_YES=1
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

if [ "$ASSUME_YES" -ne 1 ]; then
    read -r -p "Se eliminarán todos los usuarios del entorno $MODE. ¿Continuar? [y/N] " answer
    case "$answer" in
        y|Y|yes|YES|s|S|si|SI|sí|SÍ) ;;
        *)
            echo "Operación cancelada."
            exit 0
            ;;
    esac
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

    if ! command -v psql >/dev/null 2>&1; then
        echo "ERROR: psql no está instalado o no está disponible en PATH." >&2
        exit 1
    fi

    psql \
        -v ON_ERROR_STOP=1 \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        -c "DO \$\$ BEGIN
                IF to_regclass('public.usuarios') IS NOT NULL THEN
                    TRUNCATE TABLE public.usuarios RESTART IDENTITY;
                END IF;
            END \$\$;"
else
    if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
        echo "ERROR: Docker no está disponible. Inicia el sistema antes de limpiar usuarios." >&2
        exit 1
    fi

    COMPOSE=(docker compose)
    if [ -f ".env.docker" ]; then
        COMPOSE+=(--env-file .env.docker)
    fi

    if [ -z "$("${COMPOSE[@]}" ps --status running -q db)" ]; then
        echo "ERROR: el servicio db no está ejecutándose." >&2
        echo "Ejecuta primero: bash scripts/start-docker.sh --no-browser" >&2
        exit 1
    fi

    "${COMPOSE[@]}" exec -T db sh -ec '
        table_name="$(psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
            -tAc "SELECT to_regclass('\''public.usuarios'\'')")"
        if [ -n "$table_name" ]; then
            psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
                -c "TRUNCATE TABLE public.usuarios RESTART IDENTITY;"
        fi
    '
fi

echo "Limpieza completada: la tabla usuarios del entorno $MODE está vacía."
