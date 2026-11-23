#!/usr/bin/env bash
# Instala los motores fijados por playwright-core en una carpeta común a los HOME privados del job.
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
: "${RUNNER_TEMP:?Falta el directorio temporal del runner}"
: "${GITHUB_ENV:?Falta el registro del entorno del job}"

privado="$(mktemp -d "$RUNNER_TEMP/navegadores-entorno.XXXXXX")"
mkdir "$privado/home" "$privado/tmp"
cache="$RUNNER_TEMP/navegadores-cache"
nodo="$(command -v node)"
cli="$PWD/node_modules/playwright-core/cli.js"
limpio() {
  env -i PATH="$PATH" HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
    PLAYWRIGHT_BROWSERS_PATH="$cache" "$@"
}

limpio "$nodo" herramientas/red/configurar-apt.ts > "$privado/apt.conf"
sudo env -i PATH="/usr/sbin:/usr/bin:/sbin:/bin" HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
  APT_CONFIG="$privado/apt.conf" "$nodo" "$cli" install-deps chromium firefox webkit

for motor in chromium firefox webkit; do
  if [[ "$motor" != chromium ]]; then sleep 2; fi
  limpio "$nodo" --require "$PWD/herramientas/red/identidad-http.cjs" "$cli" install "$motor"
done
limpio "$nodo" --input-type=module -e '
  import { chromium, firefox, webkit } from "playwright-core";
  for (const motor of [chromium, firefox, webkit]) {
    const navegador = await motor.launch({ headless: true });
    await navegador.close();
  }
'
printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "$cache" >> "$GITHUB_ENV"
