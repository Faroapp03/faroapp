#!/bin/bash
# v2: reserva atómica del directorio; conserva el estado del comando real.
set -u
if [ "$#" -lt 3 ] || [ "$2" != "--" ]; then
  echo "Uso: guardar-resultado-v2.sh DIRECTORIO_NUEVO -- COMANDO [ARGUMENTOS...]" >&2
  exit 64
fi
resultado_dir="$1"
shift 2
if [ -z "$resultado_dir" ]; then exit 64; fi
case "$resultado_dir" in
  /*) ;;
  *) resultado_dir="$PWD/$resultado_dir" ;;
esac
mkdir -p "$(dirname "$resultado_dir")" || exit 73
# No usar mkdir -p aquí: dos ejecuciones no pueden compartir ni truncar los registros.
if ! mkdir "$resultado_dir"; then
  echo "No se pudo reservar el directorio nuevo; no se ejecuta el comando" >&2
  exit 73
fi
if "$@" > "$resultado_dir/ejecucion.log" 2>&1; then
  resultado_codigo=0
else
  resultado_codigo=$?
fi
if ! printf '%s\n' "$resultado_codigo" > "$resultado_dir/codigo-salida.txt"; then exit 74; fi
printf 'Código del comando real: %s; registro: %s/ejecucion.log\n' "$resultado_codigo" "$resultado_dir"
exit "$resultado_codigo"
