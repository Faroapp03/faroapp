"""La instalación de la que leen los enlaces, montada como es: preparados y validaciones, sin conjunto de formación.

En la instalación, `validados/formacion/` solo tiene `validacion.json`: los cursos y las especialidades salen de los
preparados (`preparados_formacion/`, líneas reales sin cambiar) compuestos por `paquete_formacion`. El Consorci sí tiene
su conjunto validado. Las carpetas son las vigentes de `entrada_salida`: quien llama las redirige antes.
"""

import json
from contextlib import ExitStack
from pathlib import Path
from typing import Any
from unittest import mock

from plataforma_datos.comun import entrada_salida
from plataforma_datos.cursos.fuentes.formacion import exportacion

MUESTRA = Path(__file__).parent / "preparados_formacion"
VALIDACION_ADMITIDA = {
    "estado": "Admitido",
    "controles": [{"control": "La muestra de la instalación se lee", "resultado": "correcto"}],
    "cobertura": {"cursos": 2},
}


def cursos_de_la_muestra() -> list[dict[str, Any]]:
    """Los cursos reales de la muestra, tal como los deja el preparado.

    Returns:
        Un curso por línea de `soc-cursos.jsonl`.
    """
    lineas = (MUESTRA / "soc-cursos.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(linea) for linea in lineas]


def montar_consorci(conjunto: dict[str, Any]) -> None:
    """El conjunto validado del Consorci con su validación admitida.

    Args:
        conjunto: Las ediciones y las entidades.
    """
    entrada_salida.guardar_json(entrada_salida.ruta_del_conjunto("consorci"), conjunto)
    entrada_salida.guardar_json(entrada_salida.carpetas("consorci").validacion, VALIDACION_ADMITIDA)


def montar_formacion(contexto: ExitStack, *, cursos: int = 2, ficha_repetida: bool = False) -> dict[str, Path]:
    """Los preparados de la formación, su validación admitida y las procedencias que lee el paquete.

    Args:
        contexto: Donde se registra la redirección de las rutas de los preparados.
        cursos: Cuántas líneas de la muestra de cursos se montan, desde la primera.
        ficha_repetida: Si un segundo curso, copia del primero con otro identificador, enseña la misma ficha.

    Returns:
        La ruta de cada preparado, por su clave en `PREPARADOS_FORMACION`.
    """
    carpetas = entrada_salida.carpetas("formacion")
    carpetas.preparado.mkdir(parents=True)
    rutas = {}
    for clave in ("eures", "especialidades", "cursos"):
        nombre = exportacion.PREPARADOS_FORMACION[clave].name
        rutas[clave] = carpetas.preparado / nombre
        lineas = (MUESTRA / nombre).read_text(encoding="utf-8").splitlines(keepends=True)
        rutas[clave].write_text("".join(lineas[:cursos] if clave == "cursos" else lineas), encoding="utf-8")
    if ficha_repetida:
        copia = {**cursos_de_la_muestra()[0], "id": "25/FOAP/781/0195455/999"}
        with rutas["cursos"].open("a", encoding="utf-8") as archivo:
            archivo.write(json.dumps(copia, ensure_ascii=False, separators=(",", ":")) + "\n")
    contexto.enter_context(mock.patch.object(exportacion, "PREPARADOS_FORMACION", rutas))
    entrada_salida.guardar_json(carpetas.validacion, VALIDACION_ADMITIDA)
    entrada_salida.guardar_json(
        carpetas.original / "procedencia.json", {"archivos": [{"archivo": "soc-cursos-2026-09-27.json"}]}
    )
    entrada_salida.guardar_json(
        entrada_salida.carpetas("sepe").original / "procedencia.json", {"descargado": "2026-09-27"}
    )
    return rutas
