"""La lectura del índice de Claude Academy: lo que cada consulta deja dicho en el registro de lecturas.

Al terminar de recibir el índice y las fichas, la adquisición entrega aquí lo que ya recibió y se emite una lectura de
su ámbito, los cursos. Solo se registra: nada de lo que se publica cambia. La hora de la lectura es la de la captura
del índice, nunca la del reloj.

Decisiones de Claude Academy (la tabla de `lecturas/como-engancha-una-fuente-su-lectura.md`):

| Decisión | Claude Academy |
|---|---|
| Ámbito | `claude_academy:curso`: cada curso que enlaza el índice público (`claude-academy:<identificador>`) |
| Hora de la lectura | `recibido_utc` de la captura del índice, al segundo y en UTC |
| Censo incompleto | siempre: `sin_censo`. El índice es una página de enlaces que no declara ser el listado entero |
| Total declarado | `None`: el índice no dice cuántos cursos hay |
| Vigente | curso enlazado cuya ficha no declara la inscripción cerrada; sin ficha leída, vigente |
| Forma | nivel `programa`; rutas `programa.<campo>` de las fichas de los cursos enlazados |
| Vocabulario cerrado | `oferta.category` (`Free`, `Paid`) y `oferta.availability` de los datos estructurados |
| Explicar una salida | nada: no hay fin publicado ni baja declarada, y salir del índice no acredita retirada |
| Baja declarada | ninguna: Academy no publica bajas |
| Declaraciones | inscripción cerrada: la ficha del curso lo dice con una frase o un dato estructurado |

El índice no es un censo. La adquisición no lo trata como tal (`acceso_publico.extraer_indice` lo dice en su
documentación y `adquisicion` lo une a las identidades ya conocidas), y el estado de la procedencia lo repite
(`censo_completo` es siempre falso). Por eso la lectura es incompleta con `sin_censo`: sus entradas y salidas quedan
registradas, pero una ausencia del índice nunca cuenta como observación para retirar un curso.

La forma de una ficha es su estructura. Los campos que todas las fichas tienen salen siempre; los que solo algunas
traen (requisitos, destinatarios, enlace de inicio y datos de la oferta) salen si los trae alguna: así la forma cambia
cuando un campo aparece o desaparece de toda la fuente, no cuando un curso concreto cambia su texto.

Como nada explica una salida, todas llegan con `explicada_por` en `None`; la lectura es incompleta y la regla de
salud no califica sus salidas.
"""

import json
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, FormatoInesperado
from plataforma_datos.cursos import operacion_fuente as comun
from plataforma_datos.cursos.fuentes.claude_academy import acceso_publico as acceso
from plataforma_datos.cursos.fuentes.claude_academy import condiciones_publicadas as publicadas
from plataforma_datos.cursos.fuentes.claude_academy import lector
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, ValorNuevo, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

FUENTE = "claude_academy"
AMBITO = "claude_academy:curso"
PREFIJO = "claude-academy:"
CANAL_INSCRIPCION_CERRADA = "inscripcion_cerrada"
# El catálogo llama programa a cada curso de Academy; el índice no distingue otros niveles.
NIVELES = ("programa",)
# Los campos de la ficha que el lector exige a toda ficha que acepta.
CAMPOS_DE_TODA_FICHA = ("id", "url", "titulo", "titulo_documento", "contenido", "bloques", "enlaces")
# Los campos de la ficha que solo traen algunos cursos: el lector los deja en `None` si la ficha no los dice.
CAMPOS_OPCIONALES = ("requisitos", "destinatarios")
RUTA_INICIO = "programa.inicio"
CAMPO_CATEGORIA = "programa.oferta.category"
CAMPO_DISPONIBILIDAD = "programa.oferta.availability"
# Los valores que la fuente sabe interpretar en los datos estructurados de la oferta
# (`condiciones_publicadas._oferta`); cualquier otro es un valor nuevo en un vocabulario cerrado.
CATEGORIAS = frozenset({"Free", "Paid"})
DISPONIBILIDADES = frozenset({"OutOfStock", "Discontinued", "SoldOut", "InStock", "LimitedAvailability"})
MAX_VALOR = 200


class ErrorLecturaAcademy(ValueError):
    """Lo que se pide no corresponde a una lectura de Academy o a su carpeta de originales."""


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """Las lecturas emitidas y lo que impidió emitirlas o compararlas con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


@dataclass(frozen=True, kw_only=True)
class FichaLeida:
    """Una ficha recibida: lo que el lector extrae, lo que dice de su inscripción y sus datos de oferta."""

    ficha: lector.FichaAcademy
    condiciones: publicadas.CondicionesAcademy
    oferta: tuple[tuple[str, str], ...]


@dataclass(frozen=True, kw_only=True)
class Captura:
    """Lo que la adquisición sabe del índice recibido: hora, cursos que enlaza y fichas leídas de esos cursos."""

    observado_utc: str
    listados: tuple[str, ...]
    fichas: Mapping[str, FichaLeida]


class _DatosEstructurados(HTMLParser):
    """Reúne el texto de cada script `application/ld+json` de una página."""

    def __init__(self) -> None:
        super().__init__()
        self.activo = False
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.activo = tag == "script" and dict(attrs).get("type") == "application/ld+json"
        if self.activo:
            self.scripts.append("")

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.activo = False

    def handle_data(self, data: str) -> None:
        if self.activo:
            self.scripts[-1] += data


def _ofertas(dato: ValorJson) -> Iterator[ObjetoJson]:
    if isinstance(dato, list):
        for elemento in dato:
            yield from _ofertas(elemento)
    elif isinstance(dato, dict):
        ofertas = dato.get("offers")
        for oferta in ofertas if isinstance(ofertas, list) else [ofertas]:
            if isinstance(oferta, dict):
                yield oferta
        for valor in dato.values():
            yield from _ofertas(valor)


def _literal(valor: ValorJson) -> str:
    texto = valor if isinstance(valor, str) else json.dumps(valor, ensure_ascii=False, sort_keys=True)
    return texto[:MAX_VALOR]


def _datos_de_oferta(cuerpo: bytes) -> tuple[tuple[str, str], ...]:
    """Los valores de `category` y `availability` que una ficha trae en sus datos estructurados.

    Un dato estructurado que no es JSON no aporta valores: la ficha ya lo trata como un precio incierto.

    Returns:
        Pares (campo, valor) sin repetir y ordenados.
    """
    pagina = _DatosEstructurados()
    pagina.feed(cuerpo.decode("utf-8"))
    pagina.close()
    valores = set()
    for texto in pagina.scripts:
        try:
            dato = json.loads(texto)
        except ValueError:
            continue
        for oferta in _ofertas(dato):
            if "category" in oferta:
                valores.add((CAMPO_CATEGORIA, _literal(oferta["category"])))
            if "availability" in oferta:
                valores.add((CAMPO_DISPONIBILIDAD, _literal(str(oferta["availability"]).rsplit("/", 1)[-1])))
    return tuple(sorted(valores))


def _identificador(url: str) -> str:
    return PREFIJO + urlsplit(url).path.rsplit("/", 1)[1]


def _instante(recibido_utc: str) -> str:
    """Escribe la hora de una recepción como la guarda el registro de lecturas: en UTC y al segundo.

    Returns:
        El texto `AAAA-MM-DDTHH:MM:SSZ`.
    """
    return datetime.fromisoformat(recibido_utc).astimezone(UTC).strftime(FORMATO_INSTANTE)


def _ficha_leida(original: Path, captura: ObjetoJson) -> FichaLeida | None:
    """Lee una ficha ya recibida; una consulta sin respuesta válida no es una ficha.

    Returns:
        La ficha leída, o None si la captura no es una respuesta completa con HTTP 200.
    """
    if captura["cuerpo"] is None:
        return None
    cuerpo, meta = comun.pagina_academy(original, captura)
    if meta["http"] != lector.HTTP_CORRECTO or meta["completo"] is not True:
        return None
    ficha = lector.extraer_ficha(cuerpo, meta, url_esperada=meta["url_solicitada"])
    return FichaLeida(ficha=ficha, condiciones=publicadas.examinar(cuerpo, ficha), oferta=_datos_de_oferta(cuerpo))


def leer_captura(original: Path, indice: ObjetoJson, capturas: list[ObjetoJson]) -> Captura:
    """Lo que dejó el ciclo: el índice y las fichas de los cursos que enlaza, leídos de los bytes conservados.

    Returns:
        La captura del índice con las fichas de sus cursos.
    """
    publicado = acceso.extraer_indice(*comun.pagina_academy(original, indice))
    listados = tuple(sorted(_identificador(url) for url in publicado.urls))
    fichas = {}
    for captura in capturas:
        leida = _ficha_leida(original, captura)
        if leida is not None and PREFIJO + leida.ficha.id in listados:
            fichas[PREFIJO + leida.ficha.id] = leida
    return Captura(observado_utc=_instante(publicado.capturado_utc), listados=listados, fichas=fichas)


def _cerrada(leida: FichaLeida | None) -> bool:
    return leida is not None and leida.condiciones.inscripcion == "cerrada"


def _rutas_de_campos(captura: Captura) -> tuple[str, ...]:
    """Los campos de toda ficha y, de los que solo traen algunas, los que trae alguna.

    Returns:
        Las rutas `programa.<campo>`, ordenadas.
    """
    leidas = list(captura.fichas.values())
    rutas = {"programa." + campo for campo in CAMPOS_DE_TODA_FICHA}
    for campo in CAMPOS_OPCIONALES:
        if any(getattr(leida.ficha, campo) is not None for leida in leidas):
            rutas.add("programa." + campo)
    if any(acceso.enlace_inicio(leida.ficha) is not None for leida in leidas):
        rutas.add(RUTA_INICIO)
    rutas.update(campo for leida in leidas for campo, _ in leida.oferta)
    return tuple(sorted(rutas))


def _valores_nuevos(captura: Captura) -> tuple[ValorNuevo, ...]:
    conocidos = {CAMPO_CATEGORIA: CATEGORIAS, CAMPO_DISPONIBILIDAD: DISPONIBILIDADES}
    pares = {par for leida in captura.fichas.values() for par in leida.oferta}
    return tuple(
        ValorNuevo(campo=campo, valor=valor) for campo, valor in sorted(pares) if valor not in conocidos[campo]
    )


def sin_explicacion(_id: str) -> None:
    """La salida de un curso del índice: nada la explica, porque Academy no publica fin ni baja.

    Returns:
        Siempre `None`.
    """
    return


def censo_del_indice(captura: Captura) -> Censo:
    """El censo de los cursos que enlaza el índice: incompleto por definición, porque el índice no es un censo.

    Returns:
        El censo listo para emitir.
    """
    return Censo(
        fuente=FUENTE,
        ambito=AMBITO,
        observado_utc=captura.observado_utc,
        completa=False,
        motivo_incompleta="sin_censo",
        ids=frozenset(captura.listados),
        recuento_bruto=len(captura.listados),
        recuento_vigente=sum(not _cerrada(captura.fichas.get(id)) for id in captura.listados),
        total_declarado=None,
        niveles=NIVELES,
        rutas_de_campos=_rutas_de_campos(captura),
        valores_nuevos=_valores_nuevos(captura),
        explicar_salida=sin_explicacion,
    )


def raiz_de(original: Path) -> Path:
    """La instalación a la que pertenece la carpeta de originales de Academy.

    Returns:
        La raíz bajo la que viven `var/actualizacion/originales` y el registro de lecturas.

    Raises:
        ErrorLecturaAcademy: Si la carpeta no es la de originales de Academy de una instalación.
    """
    niveles = len(DATOS_RELATIVOS.parts) + 1
    raiz = original.parents[niveles] if len(original.parents) > niveles else None
    if raiz is None or raiz / DATOS_RELATIVOS / "originales" / FUENTE != original:
        raise ErrorLecturaAcademy(f"{original} no es la carpeta de originales de Academy de una instalación")
    return raiz


def emitir(original: Path, auxiliares: ObjetoJson, capturas: list[ObjetoJson]) -> Resultado:
    """Emite la lectura de los cursos de un índice recién recibido, en la instalación de `original`.

    El registro es telemetría: si algo impide emitir la lectura, se dice en el resultado y la adquisición sigue como
    habría seguido. Solo se recogen los errores de los datos y del disco; un defecto del código no se esconde.

    Returns:
        La lectura emitida y los problemas, si los hubo.
    """
    try:
        raiz = raiz_de(original)
        censo = censo_del_indice(leer_captura(original, auxiliares["indice"], capturas))
        emision = emitir_lectura(raiz, censo)
    except (OSError, ValueError, FormatoInesperado) as error:
        return Resultado(emisiones=(), problemas=(f"la lectura de {AMBITO} no se pudo emitir ({error})",))
    return Resultado(emisiones=(emision,), problemas=emision.problemas)


def declaraciones(lectura: ObjetoJson, captura: Captura) -> dict[str, tuple[Declaracion, ...]]:
    """Lo que la fuente afirma de cada curso de una lectura para la regla de retirada: su inscripción cerrada.

    La captura tiene que ser la de esa lectura: los cursos que enlaza deben dar la huella de identificadores de la
    lectura. La huella de cada declaración es la de las frases o datos literales de la ficha que dicen «cerrada».

    Returns:
        Las declaraciones por identificador de curso; un curso sin nada declarado no aparece.

    Raises:
        ErrorLecturaAcademy: Si la lectura no es de los cursos de Academy o no es la de esa captura.
    """
    if lectura["fuente"] != FUENTE or lectura["ambito"] != AMBITO:
        raise ErrorLecturaAcademy("las declaraciones salen de una lectura de los cursos de Academy")
    if huella_de_ids(captura.listados) != lectura["ids_sha256"]:
        raise ErrorLecturaAcademy("la captura no es la de esta lectura")
    declaradas = {}
    for id, leida in captura.fichas.items():
        if _cerrada(leida):
            literales = [
                d["literal"]
                for d in leida.condiciones.declaraciones
                if d["campo"] == "inscripcion" and d["interpretacion"] == "cerrada"
            ]
            declaradas[id] = (
                Declaracion(
                    lectura_id=lectura["lectura_id"], canal=CANAL_INSCRIPCION_CERRADA, sha256=sha256_json(literales)
                ),
            )
    return declaradas
