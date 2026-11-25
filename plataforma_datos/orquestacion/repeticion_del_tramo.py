"""Repetir un tramo del paquete sobre lo que conservó un ensayo con datos grabados (`ensayo_por_partes`).

Sirve para trabajar: nada se junta, se sube ni se publica sin la verificación completa, y el ensayo completo es la
prueba final del ciclo. La repetición nunca publica: trabaja en un clon propio del área conservada, en
`SALIDA/repeticiones/NN/`, donde deja su recibo y sus huellas.

Antes de empezar comprueba los datos conservados y se niega si no coinciden con su huella. Si el código cambió desde
el ensayo, repite con el código actual y marca la ejecución como que no vale para aceptar.
"""

import json
import os
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion import huellas_del_ensayo
from plataforma_datos.orquestacion.base_del_ensayo import revision_limpia
from plataforma_datos.orquestacion.ensayo_por_partes import (
    CARPETA_DE_PASOS,
    CODIGO,
    NO_VALE_PARA_ACEPTAR,
    PASOS_REPETIBLES,
    PRIMER_PASO,
    aplicar_codigo,
    clonar,
    codigo_de,
    comprobar_conservado,
    reutilizados,
)
from plataforma_datos.orquestacion.entorno_del_ensayo import entorno_del_ciclo
from plataforma_datos.orquestacion.guardia_sin_red import con_guardia

Lanzar = Callable[..., subprocess.CompletedProcess]


def _leer(ruta: Path) -> dict[str, Any]:
    return json.loads(ruta.read_bytes())


def _escribir(ruta: Path, valor: object) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(valor, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def _nueva_repeticion(salida: Path) -> Path:
    carpeta = salida / "repeticiones"
    numero = len([c for c in carpeta.iterdir() if c.is_dir()]) + 1 if carpeta.exists() else 1
    return carpeta / f"{numero:02d}"


def orden_del_tramo(repeticion: Path, desde: str, hasta: str | None) -> list[str]:
    """La orden del tramo con el intérprete del área de la repetición, envuelta en la guardia de red.

    Returns:
        La orden, lista para lanzarse con `cwd` en el área.
    """
    interprete = repeticion / "area" / ".venv" / "bin" / "python"
    propia = [str(interprete), "-m", "plataforma_datos.orquestacion.ensayo_por_partes", "tramo"]
    propia += ["--repeticion", str(repeticion), "--desde", desde, *(["--hasta", hasta] if hasta else [])]
    return con_guardia(propia)


def _repetidos(tramo: dict[str, Any]) -> list[dict[str, Any]]:
    por_nombre = {anotado["paso"]: anotado for anotado in tramo["huellas"].values()}
    filas = []
    for paso in tramo["pasos"]:
        anotado = por_nombre.get(paso["paso"], {})
        filas.append({**paso, **{c: anotado[c] for c in ("entrada", "salida") if c in anotado}})
    return filas


def repetir(  # noqa: PLR0913 - El reloj, la raíz, el entorno y el lanzador llegan como dato para probarlos.
    salida: Path,
    desde: str,
    hasta: str | None = None,
    *,
    raiz: Path = RAIZ,
    entorno: Mapping[str, str] = os.environ,
    lanzar: Lanzar = subprocess.run,
) -> int:
    """Repite un tramo del paquete y deja su recibo y sus huellas.

    Args:
        salida: La salida de un ensayo completo, con sus pasos conservados.
        desde: El paso repetible desde el que se empieza.
        hasta: El último paso repetible del tramo, o None para seguir hasta el final del paquete.
        raiz: El repositorio cuyo código se repite; tiene que estar sin cambios sin confirmar.
        entorno: El entorno de quien ejecuta.
        lanzar: Cómo se lanza la orden del tramo.

    Returns:
        Cero si el tramo terminó bien; uno si no.

    Raises:
        SalidaConservadaAlterada: Si lo conservado no coincide con su huella.
    """
    salida = salida.resolve()
    indice = comprobar_conservado(salida, desde)
    antes = _leer(salida / CARPETA_DE_PASOS / CODIGO)
    ahora = codigo_de(revision_limpia(raiz), raiz)
    repeticion = _nueva_repeticion(salida)
    clonar(salida / CARPETA_DE_PASOS / desde / "area", repeticion / "area")
    # El candidato de antes del paquete, para publicar en él el tramo y exportar su generación.
    if (salida / CARPETA_DE_PASOS / PRIMER_PASO / "candidato").exists():
        clonar(salida / CARPETA_DE_PASOS / PRIMER_PASO / "candidato", repeticion / "candidato")
    mismo = antes["arbol"] == ahora["arbol"]
    aplicado = [] if mismo else aplicar_codigo(repeticion / "area", antes["revision"], ahora["revision"], raiz)
    _escribir(repeticion / CARPETA_DE_PASOS / CODIGO, ahora)
    reloj = _leer(salida / "reloj.json")
    orden = orden_del_tramo(repeticion, desde, hasta)
    proceso = lanzar(orden, cwd=repeticion / "area", env=entorno_del_ciclo(entorno, reloj, repeticion), check=False)
    vacio = {"pasos": [], "huellas": {}, "generacion": None}
    tramo = _leer(repeticion / "tramo.json") if (repeticion / "tramo.json").exists() else vacio
    generacion = tramo["generacion"] or {}
    por_partes = {
        "desde": PASOS_REPETIBLES[desde].nombre,
        "hasta": PASOS_REPETIBLES[hasta].nombre if hasta else None,
        "valeParaAceptar": mismo,
        "aviso": None if mismo else NO_VALE_PARA_ACEPTAR,
        "archivosDeCodigoAplicados": aplicado,
        "reutilizados": reutilizados(indice, desde, ahora),
        "repetidos": _repetidos(tramo),
    }
    resultado = "validado" if proceso.returncode == 0 else "rechazado"
    recibo = {
        "resultado": resultado,
        "publica": False,
        "porPartes": por_partes,
        "generacionDelEnsayo": tramo["generacion"],
    }
    _escribir(repeticion / "recibo.json", recibo)
    datos, firmas = huellas_del_ensayo.archivos_de(repeticion / "area" / "datos")
    sin_minutos = {
        **por_partes,
        "repetidos": [{k: v for k, v in p.items() if k != "minutos"} for p in por_partes["repetidos"]],
    }
    _escribir(
        repeticion / "huellas.json",
        {
            "version": huellas_del_ensayo.VERSION,
            "reloj": reloj,
            "porPartes": sin_minutos,
            "datos": {
                "paquete": datos,
                "estadoDeLaGeneracion": {c: v for c, v in generacion.items() if c != "sha256Manifiesto"} or None,
            },
            "codigo": {"paquete": firmas, "compuestas": {"sha256Manifiesto": generacion.get("sha256Manifiesto")}},
        },
    )
    print(f"Tramo: {resultado}. {'' if mismo else NO_VALE_PARA_ACEPTAR + '. '}Recibo y huellas en {repeticion}")
    return proceso.returncode
