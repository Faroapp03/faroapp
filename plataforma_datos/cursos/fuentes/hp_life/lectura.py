"""La lectura del índice de HP LIFE: lo que cada consulta deja dicho en el registro de lecturas.

Al terminar de recorrer el índice público, la adquisición entrega aquí el recorrido y se emite una lectura de su
ámbito, los cursos. Solo se registra: nada de lo que se publica cambia. La hora de la lectura es la de la captura,
nunca la del reloj.

Decisiones de HP LIFE (la tabla de `lecturas/como-engancha-una-fuente-su-lectura.md`):

| Decisión | HP LIFE |
|---|---|
| Ámbito | `hp_life:curso`: cada curso del índice, de cualquier idioma (`hp-life:<id>:<idioma>`) |
| Hora de la lectura | `recibido_utc` de la primera página legible, la misma que sostiene el censo, al segundo |
| Censo incompleto | `indice.censo` no completo: `consulta_fallida`; sin página legible, no hay lectura |
| Total declarado | `totalCourses` de la primera página: el índice lo declara en cada página |
| Vigente | todo curso listado: el índice no publica fin ni estado y solo el censo completo retira |
| Forma | nivel `programa`; rutas `programa.<campo>` de los cursos de todas las páginas leídas |
| Vocabulario cerrado | `programa.type`: `SelfPaced`, el único tipo que la fuente sabe interpretar como apertura |
| Explicar una salida | nada: el índice no publica fin ni baja, y la ausencia del listado es la propia salida |
| Baja declarada | ninguna: la baja la concluye Faro del censo completo y la ficha solo la corrobora |
| Declaraciones | ninguna: el índice no declara fin publicado, cierre ni plazas (las fichas reales tampoco) |

Como nada explica una salida, todas llegan con `explicada_por` en `None`: la regla de salud admite tres sin explicar
(el mínimo de cursos, que en una fuente de decenas de cursos supera al porcentaje) y marca como anómala la lectura que
pierde más de golpe.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC
from html.parser import HTMLParser
from pathlib import Path

from plataforma_datos.cursos.fuentes.hp_life import descubrimiento
from plataforma_datos.cursos.fuentes.hp_life.recepciones import fecha_utc, leer_recepcion
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, ValorNuevo
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTE = "hp_life"
AMBITO = "hp_life:curso"
# El prefijo de sus unidades en el catálogo de cursos servido (`indice.Curso.id`).
PREFIJO = "hp-life:"
# El catálogo llama programa a cada curso de HP LIFE; el índice no distingue otros niveles.
NIVELES = ("programa",)
CAMPO_TIPO = "programa.type"
# La fuente solo interpreta como apertura un curso `SelfPaced` (`observaciones_vigencia._apertura_interpretada`);
# cualquier otro tipo es un valor nuevo en un vocabulario cerrado.
TIPOS_CONOCIDOS = frozenset({"SelfPaced"})


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """Las lecturas emitidas y lo que impidió emitirlas o compararlas con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


class _ScriptSiguiente(HTMLParser):
    """Reúne el texto del único script `__NEXT_DATA__` de una página."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.activo = False
        self.partes: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.activo = tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__"

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.activo = False

    def handle_data(self, data: str) -> None:
        if self.activo:
            self.partes.append(data)


def _cursos_de_la_pagina(cuerpo: bytes) -> list[ObjetoJson]:
    """Los cursos tal como los lista una página del índice, con todos sus campos.

    Returns:
        Los objetos de `initialCourses`; la página ya la validó `indice.extraer_indice`.
    """
    lector = _ScriptSiguiente()
    lector.feed(cuerpo.decode("utf-8"))
    return json.loads("".join(lector.partes))["props"]["pageProps"]["initialCourses"]


def _cursos_leidos(recorrido: descubrimiento.RecorridoIndice) -> list[ObjetoJson]:
    """Los cursos de las páginas legibles del recorrido, leídos de los bytes conservados.

    Returns:
        Los cursos de todas las páginas, en el orden del índice.
    """
    cursos: list[ObjetoJson] = []
    for adquirida in recorrido.adquiridas[: len(recorrido.paginas)]:
        recepcion = leer_recepcion(
            adquirida.recepcion.cuerpo.ruta.read_bytes(), adquirida.recepcion.recibo.ruta.read_bytes()
        )
        cursos.extend(_cursos_de_la_pagina(recepcion.cuerpo))
    return cursos


def _instante(recibido_utc: str) -> str:
    """Escribe la hora de una recepción como la guarda el registro de lecturas: en UTC y al segundo.

    Returns:
        El texto `AAAA-MM-DDTHH:MM:SSZ`.
    """
    return fecha_utc(recibido_utc).astimezone(UTC).strftime(FORMATO_INSTANTE)


def _rutas_de_campos(cursos: Sequence[ObjetoJson]) -> tuple[str, ...]:
    return tuple(sorted({"programa." + campo for curso in cursos for campo in curso}))


def _valores_nuevos(cursos: Sequence[ObjetoJson]) -> tuple[ValorNuevo, ...]:
    tipos = {curso.get("type") for curso in cursos}
    nuevos = sorted(t for t in tipos if isinstance(t, str) and t not in TIPOS_CONOCIDOS)
    return tuple(ValorNuevo(campo=CAMPO_TIPO, valor=tipo) for tipo in nuevos)


def sin_explicacion(_id: str) -> None:
    """La salida de un curso del índice: nada la explica, porque el índice no publica fin ni baja.

    Returns:
        Siempre `None`.
    """
    return


def censo_del_indice(recorrido: descubrimiento.RecorridoIndice) -> Censo | None:
    """El censo de los cursos que lista el índice, con la forma de las páginas que se pudieron leer.

    Returns:
        El censo listo para emitir, o None si ninguna página fue legible (no hay censo que registrar).
    """
    if not recorrido.paginas:
        return None
    primera = recorrido.paginas[0]
    cursos = _cursos_leidos(recorrido)
    completo = recorrido.censo.completo
    # El índice lista cursos, no estados: un curso listado es un curso vigente.
    listados = sum(len(pagina.cursos) for pagina in recorrido.paginas)
    return Censo(
        fuente=FUENTE,
        ambito=AMBITO,
        observado_utc=_instante(primera.captura.recibido_utc),
        completa=completo,
        motivo_incompleta=None if completo else "consulta_fallida",
        ids=frozenset(curso.identidad for curso in recorrido.censo.cursos),
        recuento_bruto=listados,
        recuento_vigente=listados,
        total_declarado=primera.total,
        niveles=NIVELES,
        rutas_de_campos=_rutas_de_campos(cursos),
        valores_nuevos=_valores_nuevos(cursos),
        explicar_salida=sin_explicacion,
    )


def emitir(raiz: Path, recorrido: descubrimiento.RecorridoIndice) -> Resultado:
    """Emite la lectura de los cursos de un índice recién recorrido, en la instalación de `raiz`.

    El registro es telemetría: si algo impide emitir la lectura, se dice en el resultado y la adquisición sigue como
    habría seguido. Solo se recogen los errores de los datos y del disco; un defecto del código no se esconde.

    Returns:
        La lectura emitida y los problemas, si los hubo.
    """
    try:
        censo = censo_del_indice(recorrido)
        if censo is None:
            return Resultado(emisiones=(), problemas=("el índice de HP LIFE no dio ninguna página legible",))
        emision = emitir_lectura(raiz, censo)
    except (OSError, ValueError) as error:
        return Resultado(emisiones=(), problemas=(f"la lectura de {AMBITO} no se pudo emitir ({error})",))
    return Resultado(emisiones=(emision,), problemas=emision.problemas)
