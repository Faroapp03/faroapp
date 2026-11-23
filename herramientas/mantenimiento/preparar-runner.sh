#!/usr/bin/env bash
# Herramientas de la imagen Ubuntu y de las distribuciones oficiales verificadas.
set -euo pipefail
umask 077

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
: "${RUNNER_TOOL_CACHE:?Falta la caché de herramientas del runner}"
: "${RUNNER_TEMP:?Falta el directorio temporal del runner}"
: "${GITHUB_PATH:?Falta el registro de PATH del job}"
: "${GITHUB_ENV:?Falta el registro del entorno del job}"

agente='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
pista_1='sec-ch-ua: "Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"'
pista_2='sec-ch-ua-mobile: ?0'
pista_3='sec-ch-ua-platform: "Windows"'
# Esta distribución incorpora la versión de SQLite que usa Faro.
node_version=24.22.3
node_paquete="node-v$node_version-linux-x64"
node_origen="https://nodejs.org/dist/v$node_version"
python_version=3.12.15
python_publicacion=3.12.15-36805895057
python_paquete="python-$python_version-linux-24.04-x64.tar.gz"
python_sha256=fcb672b0437c2d8df5565b7cc250b2b0d7455e2b8d6a4a107cfa6f2efe4f7ed8
python_bytes=95218570
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'El runner requiere la imagen ubuntu-24.04 para Linux x86_64.' >&2
  exit 1
fi

# env -i evita que npm, pip, curl o sus imports reciban OIDC, claves, proxies o configuración ambiental.
privado="$(mktemp -d "$RUNNER_TEMP/entorno.XXXXXX")"
descarga="$privado/descarga"
python_prefijo="$privado/python"
python_bin="$python_prefijo/bin"
python_lib="$python_prefijo/lib"
python_cache="$RUNNER_TOOL_CACHE/Python/$python_version/x64"
mkdir "$privado/home" "$privado/tmp" "$descarga" "$python_prefijo"
descargar() {
  env -i PATH="$PATH" HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
    curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --max-redirs 3 --connect-timeout 15 --max-time 300 --retry 2 --retry-delay 2 \
    --user-agent "$agente" --header "$pista_1" --header "$pista_2" --header "$pista_3" --output "$2" "$1"
}

if [[ -x "$python_cache/bin/python3.12" ]]; then
  cp -a "$python_cache/." "$python_prefijo/"
else
  archivo="$descarga/$python_paquete"
  descargar "https://github.com/actions/python-versions/releases/download/$python_publicacion/$python_paquete" "$archivo"
  if [[ "$(wc -c < "$archivo" | awk '{ print $1 }')" != "$python_bytes" || \
        "$(sha256sum "$archivo" | awk '{ print $1 }')" != "$python_sha256" ]]; then
    echo "El tamaño o la suma SHA-256 de $python_paquete difiere de la publicación oficial." >&2
    exit 1
  fi
  tar -xzf "$archivo" -C "$python_prefijo" --no-same-owner
fi

# Node de la caché si GitHub ya trae la versión; si no, descarga oficial verificada con SHASUMS256.txt.
node_bin="$RUNNER_TOOL_CACHE/node/$node_version/x64/bin"
if [[ ! -x "$node_bin/node" ]]; then
  descargar "$node_origen/SHASUMS256.txt" "$descarga/SHASUMS256.txt"
  sleep 2
  descargar "$node_origen/$node_paquete.tar.xz" "$descarga/$node_paquete.tar.xz"
  esperada="$(awk -v n="$node_paquete.tar.xz" '$2 == n { print $1 }' "$descarga/SHASUMS256.txt")"
  obtenida="$(sha256sum "$descarga/$node_paquete.tar.xz" | awk '{ print $1 }')"
  if [[ ! "$esperada" =~ ^[0-9a-f]{64}$ || "$obtenida" != "$esperada" ]]; then
    echo "La suma SHA-256 de $node_paquete.tar.xz no coincide con el SHASUMS256.txt oficial." >&2
    exit 1
  fi
  tar -xJf "$descarga/$node_paquete.tar.xz" -C "$privado" --no-same-owner
  node_bin="$privado/$node_paquete/bin"
fi

herramientas="$node_bin:$python_bin:/usr/bin:/bin"
limpio() {
  env -i PATH="$herramientas" HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
    LD_LIBRARY_PATH="$python_lib" "$@"
}
fuente="$PWD/herramientas/mantenimiento/fuente-sqlite.py"
origen_sqlite="$(env -i /usr/bin/python3 -I "$fuente")"
descargar "$origen_sqlite" "$descarga/sqlite.zip"
env -i /usr/bin/python3 -I "$fuente" "$descarga/sqlite.zip" "$privado/sqlite"
env -i PATH=/usr/bin:/bin HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
  /bin/bash herramientas/mantenimiento/instalar-sqlite-linux.sh "$python_prefijo" "$privado/sqlite"
comprobar_motor() {
  # También comprueba el arranque directo sin LD_LIBRARY_PATH ni secretos de Actions.
  env -i "$1/bin/python3.12" -I "$PWD/herramientas/mantenimiento/comprobar-sqlite-linux.py" \
    "$python_prefijo" "$1" "$privado/sqlite/sqlite3.h"
}
comprobar_motor "$python_prefijo"
[[ "$(limpio node -p process.versions.node)" == "$node_version" ]]
limpio node "$PWD/herramientas/mantenimiento/comprobar-sqlite-node.mjs" "$privado/sqlite/sqlite3.h"
[[ "$(limpio python3.12 -c 'import platform, sqlite3, ssl, venv; print(platform.python_version())')" == "$python_version" ]]

limpio node --require "$PWD/herramientas/red/identidad-http.cjs" "$node_bin/../lib/node_modules/npm/bin/npm-cli.js" ci --ignore-scripts --no-audit --no-fund --include=dev --include=optional \
  --user-agent="$agente" --update-notifier=false --registry=https://registry.npmjs.org --cache "$privado/npm-cache"
limpio python3.12 -m plataforma_datos.orquestacion.preparar_dependencias "$PWD"
comprobar_motor "$PWD/.venv"
# esbuild necesita su paquete binario opcional: comprobarlo antes de abrir el almacén privado.
limpio node --input-type=module -e \
  "import {transformSync} from 'esbuild'; transformSync('const n: number = 1', {loader: 'ts'});"

printf '%s\n' "$node_bin" "$python_bin" >> "$GITHUB_PATH"
printf 'TMPDIR=%s\n' "$privado/tmp" >> "$GITHUB_ENV"
printf 'LD_LIBRARY_PATH=%s\n' "$python_lib" >> "$GITHUB_ENV"
