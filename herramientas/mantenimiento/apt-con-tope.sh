#!/usr/bin/env bash
# Ejecuta una orden que usa APT con un tope por intento. APT corta una conexión sin datos, pero no una que envía a
# cuentagotas: si el intento agota su tope, se corta todo su grupo de procesos, se deja APT y dpkg en un estado del
# que se puede partir y se repite, hasta agotar los intentos. Un fallo propio de la orden no se repite.
# Uso (como root): apt-con-tope.sh <tope por intento, s> <intentos> <gracia tras TERM, s> <orden> [argumentos...]
set -euo pipefail
tope_s="$1"
intentos="$2"
gracia_s="$3"
shift 3
# Los cerrojos de APT y dpkg: el núcleo los suelta al morir quien los tiene, y aquí se comprueba que nadie los retiene.
cerrojos='^(/var/lib/apt/lists/lock|/var/cache/apt/archives/lock|/var/lib/dpkg/lock|/var/lib/dpkg/lock-frontend)$'

grupo_vivo() { kill -0 -- "-$1" 2> /dev/null; }

# Espera a que no quede ningún proceso del grupo, como mucho los segundos indicados.
grupo_terminado() {
  local fin=$((SECONDS + $2))
  while grupo_vivo "$1" && ((SECONDS < fin)); do sleep 1; done
  ! grupo_vivo "$1"
}

# TERM deja a APT y dpkg salir por su cuenta; lo que siga vivo tras la gracia recibe KILL.
cortar() {
  kill -TERM -- "-$1" 2> /dev/null || ! grupo_vivo "$1"
  if ! grupo_terminado "$1" "$gracia_s"; then
    kill -KILL -- "-$1" 2> /dev/null || ! grupo_vivo "$1"
    if ! grupo_terminado "$1" "$gracia_s"; then
      echo "La instalación de bibliotecas no terminó ni tras cortarla: no se reintenta." >&2
      exit 1
    fi
  fi
  wait "$1" || true
}

# Antes de repetir: ningún cerrojo retenido y dpkg sin paquetes a medio instalar.
dejar_listo() {
  if lslocks --noheadings --output PATH | grep -Eq "$cerrojos"; then
    echo 'APT o dpkg siguen ocupados por otro proceso tras el corte: no se reintenta.' >&2
    exit 1
  fi
  local auditoria
  if ! auditoria="$(dpkg --audit)" || [[ -n "$auditoria" ]]; then
    echo 'dpkg quedó a medias con el corte: se terminan de configurar sus paquetes antes de reintentar.' >&2
    dpkg --configure -a
  fi
}

for ((intento = 1; intento <= intentos; intento++)); do
  inicio=$SECONDS
  # Con el control de trabajos, la orden arranca en un grupo de procesos propio que incluye a APT y dpkg.
  set -m
  "$@" &
  grupo=$!
  set +m
  while kill -0 "$grupo" 2> /dev/null && ((SECONDS - inicio < tope_s)); do sleep 1; done
  if ! kill -0 "$grupo" 2> /dev/null; then
    estado=0
    wait "$grupo" || estado=$?
    if ((estado == 0)); then
      echo "Las bibliotecas de los navegadores quedaron instaladas en $((SECONDS - inicio)) s (intento ${intento} de ${intentos})."
    fi
    exit "$estado"
  fi
  cortar "$grupo"
  if ((intento == intentos)); then
    echo "El espejo de Ubuntu no envió datos a ritmo útil en ninguno de los ${intentos} intentos de ${tope_s} s." >&2
    exit 1
  fi
  echo "El espejo de Ubuntu no envía datos a ritmo útil (más de ${tope_s} s): se corta y se reintenta, intento $((intento + 1)) de ${intentos}." >&2
  dejar_listo
done
