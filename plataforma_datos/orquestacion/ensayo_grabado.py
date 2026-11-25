"""Ensayo con datos grabados: el ciclo entero sobre la base conservada, sin descargar nada y sin salir a la red.

Órdenes, desde la raíz del repositorio y con el árbol de trabajo sin cambios sin confirmar:

    .venv/bin/python -m plataforma_datos.orquestacion.ensayo_grabado ejecutar --base CARPETA --salida CARPETA
    .venv/bin/python -m plataforma_datos.orquestacion.ensayo_grabado ejecutar --desde-r2 --salida CARPETA
    .venv/bin/python -m plataforma_datos.orquestacion.ensayo_grabado ejecutar --desde PASO --salida CARPETA
    .venv/bin/python -m plataforma_datos.orquestacion.ensayo_grabado huellas --salida CARPETA
    .venv/bin/python -m plataforma_datos.orquestacion.ensayo_grabado comparar HUELLAS_A HUELLAS_B

`ejecutar` restaura la base (`base_del_ensayo`), compone con ella y con el commit actual un candidato como el del
ciclo real y ejecuta en él, con su propio intérprete y desde su carpeta, el mismo ciclo que la acción
«actualizar-datos» (`candidato.ejecutar_candidato`), con todas las fuentes sin descargar. Siguen el paquete con todas
sus comprobaciones, la sombra de la retirada y el recibo del candidato. Al final exporta la generación que el ciclo
conservaría y escribe en la salida `huellas.json` y `minutos.json`.

El ciclo corre bajo la guardia de red del sistema (`guardia_sin_red`) y no empieza si no comprueba que lo está. Su
entorno es el de producción, sin proxy y con el reloj único del ensayo (`entorno_del_ensayo`): `--reloj-de HUELLAS`
repite el de otro ensayo para comparar, y `--hoy` e `--instante` lo fijan a mano. Nada se escribe en el almacén, en
los Workers ni en GitHub.

`ejecutar --desde PASO` (y `--hasta PASO`) repite solo un tramo del paquete sobre lo que conservó el ensayo
completo de esa salida (`ensayo_por_partes`, `repeticion_del_tramo`): sirve para trabajar, no para aceptar. Nada se
junta, se sube ni se publica sin la verificación completa, y el ensayo completo es la prueba final del ciclo.

`huellas` recalcula las huellas de una salida ya ejecutada, y `comparar` dice si las huellas de datos de dos ensayos
son iguales, qué campos difieren y qué excluye y por qué (código 0 si son iguales, 1 si no).
"""

import argparse
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, RAIZ
from plataforma_datos.orquestacion import huellas_del_ensayo
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3
from plataforma_datos.orquestacion.base_del_ensayo import (
    AlmacenSoloLectura,
    cobertura,
    descargar_base,
    fuentes_sin_originales,
    preparar_candidato,
    revision_limpia,
)
from plataforma_datos.orquestacion.candidato import ejecutar_candidato
from plataforma_datos.orquestacion.ensayo_por_partes import (
    CARPETA_DE_PASOS,
    CODIGO,
    PASOS_REPETIBLES,
    RegistroDePasos,
    codigo_de,
)
from plataforma_datos.orquestacion.entorno_del_ensayo import entorno_del_ciclo, reloj_del_ensayo
from plataforma_datos.orquestacion.generacion_del_ensayo import exportar_en_local, supervisor_se_detiene
from plataforma_datos.orquestacion.guardia_sin_red import Guardia, con_guardia, exigir_sin_red
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.repeticion_del_tramo import repetir
from plataforma_datos.orquestacion.transferir_generacion import configuracion_privada

REGLA_DE_TRABAJO = (
    "El ensayo por partes sirve para trabajar, no para aceptar: nada se junta, se sube ni se publica sin la "
    "verificación completa, y el ensayo completo es la prueba final del ciclo."
)
ACCION = "actualizar-datos"  # la acción del ciclo completo: todos los módulos y el paquete
INTERPRETE_DEL_CANDIDATO = Path(".venv/bin/python")


def orden_del_ciclo(salida: Path, revision: str, guardia: Guardia = con_guardia) -> list[str]:
    """La orden que ejecuta el ciclo con el intérprete del candidato, ya envuelta en la guardia de red.

    Se lanza desde la carpeta del candidato, como hace el ejecutor de producción: así el motor que corre es el del
    commit del candidato, no el del árbol de quien ejecuta el ensayo.

    Args:
        salida: La salida del ensayo.
        revision: La revisión del candidato.
        guardia: Cómo se envuelve la orden en la guardia de red.

    Returns:
        La orden, lista para `subprocess.run` con `cwd` en el candidato.
    """
    interprete = salida / "candidato" / INTERPRETE_DEL_CANDIDATO
    propia = [str(interprete), "-m", "plataforma_datos.orquestacion.ensayo_grabado", "ciclo", "--salida", str(salida)]
    return guardia([*propia, "--revision", revision])


@contextmanager
def _medir(minutos: dict[str, float], fase: str) -> Iterator[None]:
    inicio = time.monotonic()
    try:
        yield
    finally:
        minutos[fase] = round((time.monotonic() - inicio) / 60, 2)
        print(f"{fase}: {minutos[fase]:.2f} min", flush=True)


def _escribir(ruta: Path, valor: object) -> None:
    ruta.write_text(json.dumps(valor, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def ciclo(
    salida: Path,
    revision: str,
    ejecutar: Callable[..., dict[str, Any]] = ejecutar_candidato,
    exigir_guardia: Callable[[], None] = exigir_sin_red,
) -> int:
    """Ejecuta el ciclo del candidato con todas las fuentes sin descargar, guarda el recibo y exporta la generación.

    Es la parte que corre bajo la guardia de red: la lanza `ejecutar`, no se llama a mano, y no empieza si una
    conexión externa no se niega.

    Returns:
        Cero si el recibo es «validado» y su generación se conservaría; uno si no, también cuando el supervisor se
        detendría por no poder conservar lo que validó.
    """
    exigir_guardia()
    minutos: dict[str, float] = {}
    candidato = salida / "candidato"
    reutilizadas = fuentes_sin_originales(candidato)
    print(f"Reutilizan su validado vigente: {', '.join(reutilizadas) or 'ninguna'}.", flush=True)
    with _medir(minutos, "ciclo: fuentes, paquete, sombra y recibo"):
        # Cada paso repetible del paquete deja su entrada conservada, sus huellas y su código (ensayo_por_partes).
        registro = RegistroDePasos(salida)
        recibo = ejecutar(
            candidato, ACCION, ejecutor=registro, sin_descargar=tuple(FUENTES), reutilizar_validado=reutilizadas
        )
    # Como el supervisor tras el recibo: exportar la generación del intento, aquí a una carpeta local de la salida.
    with _medir(minutos, "exportar la generación"):
        generacion = exportar_en_local(candidato, salida / "generacion-resultado", revision, recibo["resultado"])
    print(f"Generación: {generacion['estado']}. El supervisor {generacion['supervisor']}.", flush=True)
    # El recibo del candidato no cambia; el del ensayo añade cómo se trató cada fuente y qué pasó con la generación.
    recibo = {**recibo, "coberturaDelEnsayo": cobertura(reutilizadas), "generacionDelEnsayo": generacion}
    _escribir(salida / "recibo.json", recibo)
    _escribir(salida / "minutos-del-ciclo.json", minutos)
    return 0 if recibo["resultado"] == "validado" and not supervisor_se_detiene(recibo["resultado"], generacion) else 1


def pasos_del_informe(candidato: Path) -> list[dict[str, Any]]:
    """Los pasos del ciclo con sus minutos, del informe que escribió en el candidato.

    Returns:
        Nombre, código y minutos de cada paso; vacía si el ciclo no llegó a escribir su informe.
    """
    informes = sorted((candidato / DATOS_RELATIVOS / "ejecuciones").glob("[0-9]*.json"))
    if not informes:
        return []
    pasos = json.loads(informes[-1].read_bytes())["pasos"]
    return [{"paso": p["nombre"], "codigo": p["codigo"], "minutos": round(p["segundos"] / 60, 2)} for p in pasos]


def huellas(salida: Path) -> dict[str, Any]:
    """Calcula y escribe las huellas de una salida ya ejecutada.

    Returns:
        Las huellas escritas en `SALIDA/huellas.json`.
    """
    recibo = json.loads((salida / "recibo.json").read_bytes())
    reloj = json.loads((salida / "reloj.json").read_bytes())
    generacion = salida / "generacion-resultado"
    valor = huellas_del_ensayo.calcular(
        salida / "candidato", recibo, generacion if generacion.is_dir() else None, reloj
    )
    _escribir(salida / "huellas.json", valor)
    return valor


def _abrir_almacen() -> AlmacenSoloLectura:
    return AlmacenSoloLectura(AlmacenS3(configuracion_privada(os.environ)))


def ejecutar(
    salida: Path,
    base: Path | None,
    reloj: dict[str, str],
    abrir_almacen: Callable[[], AlmacenSoloLectura] = _abrir_almacen,
    guardia: Guardia = con_guardia,
) -> int:
    """Ejecuta el ensayo entero en una salida nueva y deja en ella las huellas y los minutos de cada paso.

    Args:
        salida: Carpeta nueva, fuera del repositorio.
        base: Carpeta base ya descargada, o None para leerla del almacén privado.
        reloj: El reloj único del ensayo (`reloj_del_ensayo`).
        abrir_almacen: Cómo se abre el almacén en solo lectura.
        guardia: Cómo se envuelve el ciclo en la guardia de red.

    Returns:
        Cero si el recibo es «validado» y las huellas quedaron escritas; uno si no.

    Raises:
        ValueError: Si la salida ya existe o está dentro del repositorio, o si el árbol tiene cambios sin confirmar.
    """
    salida = salida.resolve()
    if salida.is_relative_to(RAIZ) or salida.exists():
        raise ValueError("la salida del ensayo tiene que ser nueva y estar fuera del repositorio")
    revision = revision_limpia()
    salida.mkdir(mode=0o700)
    _escribir(salida / "reloj.json", reloj)
    (salida / CARPETA_DE_PASOS).mkdir()
    _escribir(salida / CARPETA_DE_PASOS / CODIGO, codigo_de(revision))
    minutos: dict[str, float] = {}
    if base is None:
        with _medir(minutos, "restaurar la base del almacén (solo lectura)"), abrir_almacen() as almacen:
            descargar_base(almacen, salida / "base")
        base = salida / "base"
    with _medir(minutos, "componer el candidato"):
        preparar_candidato(base.resolve(), salida / "candidato", revision)
    entorno = entorno_del_ciclo(os.environ, reloj, salida)
    orden = orden_del_ciclo(salida, revision, guardia)
    codigo = subprocess.run(orden, cwd=salida / "candidato", env=entorno, check=False).returncode
    if not (salida / "minutos-del-ciclo.json").exists():
        print(f"El ciclo se cortó sin dejar su recibo (código {codigo}). El candidato queda en {salida}/candidato.")
        return 1
    minutos.update(json.loads((salida / "minutos-del-ciclo.json").read_bytes()))
    with _medir(minutos, "huellas"):
        huellas(salida)
    _escribir(salida / "minutos.json", {"fases": minutos, "pasos": pasos_del_informe(salida / "candidato")})
    print(f"Recibo: {json.loads((salida / 'recibo.json').read_bytes())['resultado']}. Huellas: {salida}/huellas.json")
    return codigo


def _reloj_de_los_argumentos(parser: argparse.ArgumentParser, argumentos: argparse.Namespace) -> dict[str, str]:
    """El reloj pedido: el de unas huellas (comprobado) o el de `--hoy` e `--instante`; nunca los dos a la vez.

    Returns:
        El reloj del ensayo.
    """
    if argumentos.reloj_de is None:
        return reloj_del_ensayo(argumentos.hoy, argumentos.instante)
    if argumentos.hoy is not None or argumentos.instante is not None:
        parser.error("--reloj-de repite el reloj de unas huellas: no admite --hoy ni --instante")
    reloj = json.loads(argumentos.reloj_de.read_bytes())["reloj"]
    return reloj_del_ensayo(reloj["hoy"], reloj["instante"])


def _ejecutar_desde_los_argumentos(parser: argparse.ArgumentParser, argumentos: argparse.Namespace) -> int:
    """El ensayo completo (desde una base) o un tramo (desde un paso conservado), según los argumentos.

    Returns:
        El código del ensayo o del tramo.
    """
    if argumentos.desde is not None:
        if argumentos.reloj_de or argumentos.hoy or argumentos.instante:
            parser.error("un tramo repite el reloj de su ensayo: no admite --reloj-de, --hoy ni --instante")
        print(REGLA_DE_TRABAJO)
        return repetir(argumentos.salida, argumentos.desde, argumentos.hasta)
    if argumentos.hasta is not None:
        parser.error("--hasta solo se usa con --desde")
    if argumentos.base is None and not argumentos.desde_r2:
        parser.error("indica --base, --desde-r2 o --desde")
    reloj = _reloj_de_los_argumentos(parser, argumentos)
    return ejecutar(argumentos.salida, None if argumentos.desde_r2 else argumentos.base, reloj)


def main(argv: list[str] | None = None) -> int:
    """Ejecuta el ensayo, recalcula sus huellas o compara dos.

    Returns:
        Cero si el ensayo termina validado o las huellas son iguales; uno si no; dos si la referencia no vale.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ordenes = parser.add_subparsers(dest="orden", required=True)
    orden_ejecutar = ordenes.add_parser("ejecutar", help="el ensayo entero")
    origen = orden_ejecutar.add_mutually_exclusive_group()
    origen.add_argument("--base", type=Path, help="carpeta base ya descargada")
    origen.add_argument("--desde-r2", action="store_true", help="lee la base vigente del almacén privado")
    origen.add_argument(
        "--desde", choices=PASOS_REPETIBLES, help="repite el paquete desde este paso. " + REGLA_DE_TRABAJO
    )
    orden_ejecutar.add_argument("--hasta", choices=PASOS_REPETIBLES, help="último paso del tramo que se repite")
    orden_ejecutar.add_argument("--salida", type=Path, required=True)
    orden_ejecutar.add_argument("--reloj-de", type=Path, help="repite el reloj de unas huellas, para compararlas")
    orden_ejecutar.add_argument("--hoy", help="día de validación del ciclo, AAAA-MM-DD")
    orden_ejecutar.add_argument("--instante", help="instante único del ciclo, AAAA-MM-DDTHH:MM:SSZ")
    orden_ciclo = ordenes.add_parser("ciclo", help="interna: la lanza «ejecutar» bajo la guardia de red")
    orden_ciclo.add_argument("--salida", type=Path, required=True)
    orden_ciclo.add_argument("--revision", required=True)
    ordenes.add_parser("huellas", help="recalcula las huellas de una salida").add_argument(
        "--salida", type=Path, required=True
    )
    orden_comparar = ordenes.add_parser("comparar", help="compara dos huellas")
    orden_comparar.add_argument("a", type=Path)
    orden_comparar.add_argument("b", type=Path)
    argumentos = parser.parse_args(argv)
    if argumentos.orden == "ejecutar":
        return _ejecutar_desde_los_argumentos(parser, argumentos)
    if argumentos.orden == "ciclo":
        return ciclo(argumentos.salida.resolve(), argumentos.revision)
    if argumentos.orden == "huellas":
        huellas(argumentos.salida.resolve())
        return 0
    referencia = json.loads(argumentos.a.read_bytes())
    try:
        huellas_del_ensayo.exigir_referencia(referencia)
    except huellas_del_ensayo.ReferenciaNoAceptable as error:
        print(error)
        return 2
    diferencias, de_codigo = huellas_del_ensayo.comparar(referencia, json.loads(argumentos.b.read_bytes()))
    print("\n".join([*huellas_del_ensayo.exclusiones(), *diferencias, *de_codigo]))
    print("Las huellas de datos son distintas." if diferencias else "Las huellas de datos son iguales.")
    return 1 if diferencias else 0


if __name__ == "__main__":
    sys.exit(main())
