"""Registro de la adquisición de cada fuente del catálogo: qué función recibe su conjunto.

`operacion_fuente.descargar` lee las identidades conocidas y la procedencia anterior y entrega la recepción a la
función de su fuente. Las fuentes con módulo de adquisición propio se importan al usarlas, porque esos módulos importan
`operacion_fuente`; HP LIFE recibe aquí su índice y cada ficha, conocida o dada de alta por el índice.
"""

import time
from collections.abc import Callable
from pathlib import Path

from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.hp_life import adquisicion as adquirir_hp
from plataforma_datos.cursos.fuentes.hp_life import censo_indice, descubrimiento, lectura
from plataforma_datos.cursos.tipos_json import ObjetoJson

# Firma común de la adquisición de una fuente: identidades conocidas, carpeta de originales, procedencia anterior y
# raíz de la copia. Devuelve los problemas de la emisión de su lectura, que no cambian el resultado de la adquisición.
type Adquiriente = Callable[[list[ObjetoJson] | ObjetoJson, Path, ObjetoJson, Path], tuple[str, ...] | None]


def _adquirir_barcelonactiva(
    programas: list[ObjetoJson] | ObjetoJson, original: Path, anterior: ObjetoJson, raiz: Path
) -> tuple[str, ...]:
    from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion, censo_ia
    from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot

    # La página de filtros dice la instancia del portlet y si el ámbito de IA sigue siéndolo; después, los dos censos.
    inicio = time.monotonic()
    portlet = censo_ia.descargar(original.parent)
    return adquisicion.descargar(
        programas,
        original,
        anterior,
        portlet or robot.PORTLET,
        base=raiz / comun.almacen_catalogo.RUTA / "catalogo.sqlite3",
        inicio=inicio,
    ).problemas


def _adquirir_fundae(
    programas: list[ObjetoJson] | ObjetoJson, original: Path, anterior: ObjetoJson, raiz: Path
) -> tuple[str, ...]:
    from plataforma_datos.cursos.fuentes.fundae import adquisicion, descarga

    try:
        catalogo = adquisicion.descargar(programas, original, anterior)
    finally:
        # El canal se enlaza también tras un fallo: sus intentos conservados forman parte de la procedencia.
        comun.enlazar_canal("fundae", raiz)
    # Las ediciones salen del índice recién recibido; con el índice caído no se consulta ninguna ficha.
    return (*catalogo.problemas, *descarga.descargar(original.parent).problemas)


def _adquirir_claude_academy(
    programas: list[ObjetoJson] | ObjetoJson, original: Path, anterior: ObjetoJson, _raiz: Path
) -> None:
    from plataforma_datos.cursos.fuentes.claude_academy import adquisicion

    adquisicion.descargar(programas, original, anterior)


def _adquirir_cibervoluntarios(
    programas: list[ObjetoJson] | ObjetoJson, original: Path, anterior: ObjetoJson, raiz: Path
) -> None:
    from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion, destinos

    adquisicion.descargar(programas, original, anterior, destinos.retirado_en_el_registro(raiz))


def _captura_de_indice(adquirida: adquirir_hp.AdquisicionHpLife, original: Path) -> ObjetoJson:
    rx = adquirida.recepcion
    return {
        "id": None,
        "cuerpo": comun.referencia_conservada(rx.cuerpo.ruta, original, rx.cuerpo.sha256) if rx else None,
        "recibo": comun.referencia_conservada(rx.recibo.ruta, original) if rx else None,
        "intento": comun.referencia_conservada(adquirida.intento.ruta, original),
    }


def _adquirir_hp_life(
    programas: list[ObjetoJson] | ObjetoJson, original: Path, anterior: ObjetoJson, raiz: Path
) -> tuple[str, ...]:
    """Recibe el índice público y cada ficha conocida o dada de alta por él; arrastra lo admitido sin instalar.

    Una página del índice que no responde deja el censo parcial: se conserva su intento y la consulta de las
    fichas sigue con lo conocido y lo ya visto. Al final emite la lectura del índice; si no se puede emitir, nada más
    cambia.

    Returns:
        Los problemas de la emisión de la lectura, si los hubo.
    """
    pendientes = comun.pendientes_sin_instalar("hp_life", raiz)
    recorrido = descubrimiento.recorrer(area=original / "recepciones")
    auxiliares = {
        censo_indice.clave(n): _captura_de_indice(adquirida, original)
        for n, adquirida in enumerate(recorrido.adquiridas, start=1)
    }
    auxiliares["ayuda"] = _captura_de_indice(adquirir_hp.recibir_ayuda(area=original / "recepciones"), original)
    nuevas = descubrimiento.altas(recorrido.censo, {p["id"] for p in programas})
    unidades = [(p["id"], p["url"]) for p in programas] + [(c.identidad, c.url) for c in nuevas]
    capturas = []
    for id, url in unidades:
        adquirida = adquirir_hp.recibir(url, id=id, area=original / "recepciones")
        rx = adquirida.recepcion
        capturas.append(
            {
                "id": id,
                "cuerpo": comun.referencia_conservada(rx.cuerpo.ruta, original, rx.cuerpo.sha256) if rx else None,
                "recibo": comun.referencia_conservada(rx.recibo.ruta, original) if rx else None,
                "intento": comun.referencia_conservada(adquirida.intento.ruta, original),
            }
        )
    comun.guardar_capturas_de_fuente(
        original,
        "hp_life",
        capturas,
        anterior,
        auxiliares,
        pendientes=pendientes,
        fallos_por_unidad="hp_life" in comun.FALLOS_POR_UNIDAD,
    )
    return lectura.emitir(raiz, recorrido).problemas


# Cada fuente del catálogo, con la función que recibe su conjunto; una fuente sin entrada no se descarga.
ADQUIRIENTES: dict[str, Adquiriente] = {
    "hp_life": _adquirir_hp_life,
    "cibervoluntarios": _adquirir_cibervoluntarios,
    "claude_academy": _adquirir_claude_academy,
    "fundae": _adquirir_fundae,
    "barcelonactiva": _adquirir_barcelonactiva,
}
