#!/usr/bin/env bash
# Instala los motores pedidos, en las versiones que fija playwright-core, en una carpeta común a los HOME privados
# del job. Uso: preparar-navegadores.sh chromium [firefox] [webkit]
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
: "${RUNNER_TEMP:?Falta el directorio temporal del runner}"
: "${GITHUB_ENV:?Falta el registro del entorno del job}"

# Un espejo lento deja conexiones sin datos: se cortan a los pocos segundos y el paquete se pide de nuevo, en vez de
# esperar. Los dos valores salen del registro de un ciclo real; pruebas/herramientas/preparar-navegadores-medidas.test.ts
# los deriva de él.
reintentos_apt=6
espera_apt_s=4

if (($# == 0)); then
  echo 'Indica los motores que se instalan: chromium, firefox o webkit.' >&2
  exit 2
fi
for motor in "$@"; do
  case "$motor" in
    chromium | firefox | webkit) ;;
    *)
      echo "No se conoce el motor «${motor}»: se admiten chromium, firefox y webkit." >&2
      exit 2
      ;;
  esac
done

privado="$(mktemp -d "$RUNNER_TEMP/navegadores-entorno.XXXXXX")"
mkdir "$privado/home" "$privado/tmp"
cache="$RUNNER_TEMP/navegadores-cache"
nodo="$(command -v node)"
cli="$PWD/node_modules/playwright-core/cli.js"
limpio() {
  env -i PATH="$PATH" HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
    PLAYWRIGHT_BROWSERS_PATH="$cache" "$@"
}

# APT lee APT_CONFIG antes que /etc/apt/apt.conf.d, que podría pisar estos valores; el archivo principal se lee el
# último, así que la red va en uno propio, que incluye primero el del sistema si existe.
red="$privado/apt-red.conf"
{
  if [[ -f /etc/apt/apt.conf ]]; then printf '#include "/etc/apt/apt.conf";\n'; fi
  printf 'Acquire::Retries "%d";\n' "$reintentos_apt"
  printf 'Acquire::http::Timeout "%d";\nAcquire::https::Timeout "%d";\n' "$espera_apt_s" "$espera_apt_s"
} > "$red"
{
  limpio "$nodo" herramientas/red/configurar-apt.ts
  printf 'Dir::Etc::main "%s";\n' "$red"
} > "$privado/apt.conf"

# Si otra configuración ganara, APT esperaría como sin estos valores: se comprueba lo que va a usar.
esperado="$(printf "reintentos='%d'\nespera_http='%d'\nespera_https='%d'" \
  "$reintentos_apt" "$espera_apt_s" "$espera_apt_s")"
vigente="$(limpio APT_CONFIG="$privado/apt.conf" apt-config shell \
  reintentos Acquire::Retries espera_http Acquire::http::Timeout espera_https Acquire::https::Timeout)"
if [[ "$vigente" != "$esperado" ]]; then
  echo 'APT no usa los reintentos ni las esperas de la preparación de los navegadores.' >&2
  exit 1
fi

sudo env -i PATH="/usr/sbin:/usr/bin:/sbin:/bin" HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
  APT_CONFIG="$privado/apt.conf" "$nodo" "$cli" install-deps "$@"

primero=1
for motor in "$@"; do
  if ((primero == 0)); then sleep 2; fi
  primero=0
  limpio "$nodo" --require "$PWD/herramientas/red/identidad-http.cjs" "$cli" install "$motor"
done
# Solo se exporta la caché si arrancan todos los motores pedidos.
limpio "$nodo" --input-type=module -e '
  import * as playwright from "playwright-core";
  for (const nombre of process.argv.slice(1)) {
    const navegador = await playwright[nombre].launch({ headless: true });
    await navegador.close();
  }
' "$@"
printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "$cache" >> "$GITHUB_ENV"
