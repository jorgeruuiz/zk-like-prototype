#!/usr/bin/env bash

set -euo pipefail

DIAGRAM_ROOT="${1:-doc/diagramas}"
SOURCE_DIR="$DIAGRAM_ROOT/memoria"
STYLE_FILE="$DIAGRAM_ROOT/zkp_style.config"
SVG_DIR="$SOURCE_DIR/svg"
PNG_DIR="$SOURCE_DIR/png"
PDF_DIR="$SOURCE_DIR/pdf"
CROPPED_PDF_DIR="$PDF_DIR/cropped"

if ! command -v plantuml >/dev/null 2>&1; then
    echo "ERROR: plantuml no está instalado."
    echo "Instálalo junto con Graphviz antes de generar los diagramas."
    exit 1
fi

if ! command -v dot >/dev/null 2>&1; then
    echo "ERROR: graphviz no está instalado."
    exit 1
fi

if [ ! -f "$STYLE_FILE" ]; then
    echo "ERROR: no existe el fichero de estilo $STYLE_FILE."
    exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
    echo "ERROR: no existe el directorio de fuentes $SOURCE_DIR."
    exit 1
fi

shopt -s nullglob
PUML_FILES=("$SOURCE_DIR"/*.puml)

if [ "${#PUML_FILES[@]}" -eq 0 ]; then
    echo "ERROR: no se han encontrado diagramas .puml en $SOURCE_DIR."
    exit 1
fi

mkdir -p "$SVG_DIR" "$PNG_DIR" "$PDF_DIR" "$CROPPED_PDF_DIR"

echo "Eliminando salidas anteriores..."
rm -f "$SVG_DIR"/*.svg
rm -f "$PNG_DIR"/*.png
rm -f "$PDF_DIR"/*.pdf
rm -f "$CROPPED_PDF_DIR"/*.pdf

echo "Generando ${#PUML_FILES[@]} diagramas desde $SOURCE_DIR..."
plantuml -charset UTF-8 -config "$STYLE_FILE" -tsvg -o svg "${PUML_FILES[@]}"
plantuml -charset UTF-8 -config "$STYLE_FILE" -tpng -o png "${PUML_FILES[@]}"
plantuml -charset UTF-8 -config "$STYLE_FILE" -tpdf -o pdf "${PUML_FILES[@]}"
plantuml -charset UTF-8 -config "$STYLE_FILE" -tpdf -o pdf/cropped "${PUML_FILES[@]}"

count_files() {
    local directory="$1"
    local pattern="$2"
    local files=("$directory"/$pattern)
    printf '%s\n' "${#files[@]}"
}

EXPECTED="${#PUML_FILES[@]}"
SVG_COUNT="$(count_files "$SVG_DIR" '*.svg')"
PNG_COUNT="$(count_files "$PNG_DIR" '*.png')"
PDF_COUNT="$(count_files "$PDF_DIR" '*.pdf')"
CROPPED_COUNT="$(count_files "$CROPPED_PDF_DIR" '*.pdf')"

if [ "$SVG_COUNT" -ne "$EXPECTED" ] ||
   [ "$PNG_COUNT" -ne "$EXPECTED" ] ||
   [ "$PDF_COUNT" -ne "$EXPECTED" ] ||
   [ "$CROPPED_COUNT" -ne "$EXPECTED" ]; then
    echo "ERROR: la generación no ha producido todas las salidas esperadas."
    exit 1
fi

echo "Generación completada:"
echo "  SVG: $SVG_COUNT -> $SVG_DIR"
echo "  PNG: $PNG_COUNT -> $PNG_DIR"
echo "  PDF: $PDF_COUNT -> $PDF_DIR"
echo "  PDF recortados: $CROPPED_COUNT -> $CROPPED_PDF_DIR"
