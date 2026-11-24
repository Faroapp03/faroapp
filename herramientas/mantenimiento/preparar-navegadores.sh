#!/usr/bin/env bash
# Instala los motores pedidos, en las versiones que fija playwright-core, en una carpeta común a los HOME privados
# del job. APT solo entra si algún motor no arranca: la imagen del runner suele traer sus bibliotecas, y un espejo
# degradado puede tardar más que todo lo demás. Uso: preparar-navegadores.sh chromium [firefox] [webkit]
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
: "${RUNNER_TEMP:?Falta el directorio temporal del runner}"
: "${GITHUB_ENV:?Falta el registro del entorno del job}"

# Todos los números salen de registros de ciclos reales; pruebas/herramientas/preparar-navegadores-medidas.test.ts
# los deriva de ellos. Una conexión sin datos se corta a los pocos segundos y el paquete se pide de nuevo; un intento
# entero de instalar las bibliotecas que pasa de su tope se corta y se repite, porque APT no corta lo que le llega a
# cuentagotas.
reintentos_apt=6
espera_apt_s=4
tope_intento_apt_s=71
intentos_apt=3
gracia_apt_s=5

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

# Con «anotar» escribe, uno por línea, los motores que no arrancan; con «estricto», el primero que no arranque para
# el guion con su error.
probar_motores() {
  limpio "$nodo" --input-type=module -e '
    import * as playwright from "playwright-core";
    const [modo, ...motores] = process.argv.slice(1);
    for (const nombre of motores) {
      try {
        const navegador = await playwright[nombre].launch({ headless: true });
        await navegador.close();
      } catch (error) {
        if (modo === "estricto") throw error;
        console.error(`${nombre} no arranca sin sus bibliotecas: ${String(error.message).split("\n")[0]}`);
        console.log(nombre);
      }
    }
  ' "$@"
}

# APT lee APT_CONFIG antes que /etc/apt/apt.conf.d, que podría pisar estos valores; el archivo principal se lee el
# último, así que la red y las fuentes van en uno propio, que incluye primero el del sistema si existe. Las fuentes son
# solo el archivo oficial de Ubuntu, sin las demás del sistema.
instalar_bibliotecas() {
  local red="$privado/apt-red.conf" lista="$privado/fuentes-oficiales.list" piezas="$privado/fuentes.d"
  local arquitectura
  arquitectura="$(dpkg --print-architecture)"
  mkdir "$piezas"
  {
    if [[ -f /etc/apt/apt.conf ]]; then printf '#include "/etc/apt/apt.conf";\n'; fi
    printf 'Acquire::Retries "%d";\n' "$reintentos_apt"
    printf 'Acquire::http::Timeout "%d";\nAcquire::https::Timeout "%d";\n' "$espera_apt_s" "$espera_apt_s"
    limpio "$nodo" herramientas/red/configurar-apt.ts fuentes "$lista" "$piezas" "$arquitectura"
  } > "$red"
  {
    limpio "$nodo" herramientas/red/configurar-apt.ts identidad
    printf 'Dir::Etc::main "%s";\n' "$red"
  } > "$privado/apt.conf"

  # Si otra configuración ganara, APT esperaría o leería otras fuentes: se comprueba lo que va a usar.
  local esperado vigente
  esperado="$(printf "reintentos='%d'\nespera_http='%d'\nespera_https='%d'\nfuentes='%s'\npiezas='%s'" \
    "$reintentos_apt" "$espera_apt_s" "$espera_apt_s" "$lista" "$piezas")"
  vigente="$(limpio APT_CONFIG="$privado/apt.conf" apt-config shell \
    reintentos Acquire::Retries espera_http Acquire::http::Timeout espera_https Acquire::https::Timeout \
    fuentes Dir::Etc::sourcelist piezas Dir::Etc::sourceparts)"
  if [[ "$vigente" != "$esperado" ]]; then
    echo 'APT no usa los reintentos, las esperas ni las fuentes de la preparación de los navegadores.' >&2
    exit 1
  fi

  sudo env -i PATH="/usr/sbin:/usr/bin:/sbin:/bin" HOME="$privado/home" TMPDIR="$privado/tmp" LANG=C.UTF-8 \
    APT_CONFIG="$privado/apt.conf" bash "$PWD/herramientas/mantenimiento/apt-con-tope.sh" \
    "$tope_intento_apt_s" "$intentos_apt" "$gracia_apt_s" "$nodo" "$cli" install-deps "$@"
}

# Los motores se descargan con el CLI oficial, que no usa APT.
primero=1
for motor in "$@"; do
  if ((primero == 0)); then sleep 2; fi
  primero=0
  limpio "$nodo" --require "$PWD/herramientas/red/identidad-http.cjs" "$cli" install "$motor"
done

sin_bibliotecas="$(probar_motores anotar "$@")"
faltan=()
for motor in $sin_bibliotecas; do faltan+=("$motor"); done
if ((${#faltan[@]} > 0)); then
  instalar_bibliotecas "${faltan[@]}"
  # Solo se exporta la caché si, con sus bibliotecas, arrancan todos los motores pedidos.
  probar_motores estricto "$@"
fi
printf 'PLAYWRIGHT_BROWSERS_PATH=%s\n' "$cache" >> "$GITHUB_ENV"
