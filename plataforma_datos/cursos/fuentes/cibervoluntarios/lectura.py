"""La lectura del censo de Cibervoluntarios: lo que cada adquisición deja dicho en el registro de lecturas.

Al terminar de recibir el censo, la adquisición entrega aquí sus páginas ya leídas y se emiten dos lecturas, una por
ámbito: los materiales (la unidad del catálogo, con la forma `cibervoluntarios:material:N`) y las actividades que los
contienen. Solo se registra: nada de lo que se publica cambia. La hora de la lectura es la de la captura, nunca la del
reloj.

Decisiones de esta fuente (la tabla de `lecturas/como-engancha-una-fuente-su-lectura.md`):

| Decisión | Cibervoluntarios |
|---|---|
| Ámbitos | `cibervoluntarios:material` (cada material de cada actividad) y `cibervoluntarios:actividad` |
| Hora de la lectura | `fin_utc` de la primera página del censo |
| Censo incompleto | alguna página caída da `consulta_fallida`; sin la primera página no hay censo ni lectura |
| Total declarado | actividades: `hydra:totalItems`; materiales: `None`, porque la API no cuenta materiales |
| Vigente | material: `MaterialCiber.disponible` (sin borrar, él y su actividad «Disponible»); actividad: con alguno |
| Forma | niveles `actividad` y `programa` (el material); rutas `actividad.<campo>` y `programa.<campo>` de la captura |
| Vocabulario cerrado | `actividad.status` y `programa.status`: `lector.ESTADOS_CONOCIDOS` |
| Explicar una salida | su última baja declarada en el catálogo instalado (`erased` o estado distinto de «Disponible») |
| Baja declarada | `erased` verdadero o un `status` distinto de «Disponible», en el material o en su actividad |
| Declaraciones | `baja_declarada` por material; Cibervoluntarios no publica fin, plazas ni inscripción |

El campo de actividad `erased` no se guarda en el catálogo, así que una actividad que solo constara borrada no explica
la salida de sus materiales. Los campos `minAge` y `maxAge` de la actividad aparecen en un solo curso de cada 258: se
dejan fuera de la forma para que el día en que ese curso cambie no parezca que la API cambió.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, ErrorFuente
from plataforma_datos.cursos.fuentes.cibervoluntarios.lector import ESTADOS_CONOCIDOS, MaterialCiber
from plataforma_datos.cursos.lecturas.contrato_lectura import FORMATO_INSTANTE, ValorNuevo, huella_de_ids
from plataforma_datos.cursos.lecturas.emision import Censo, Emision, emitir_lectura
from plataforma_datos.cursos.retirada_por_evidencia import Declaracion
from plataforma_datos.cursos.tipos_json import ObjetoJson

FUENTE = "cibervoluntarios"
AMBITO_MATERIALES = "cibervoluntarios:material"
AMBITO_ACTIVIDADES = "cibervoluntarios:actividad"
PREFIJO_MATERIAL = "cibervoluntarios:material:"
PREFIJO_ACTIVIDAD = "cibervoluntarios:actividad:"
# El material es la unidad del catálogo (un «programa» de Faro); la actividad es su contenedor.
NIVELES = ("actividad", "programa")
CAMPO_ESTADO_MATERIAL = "programa.status"
CAMPO_ESTADO_ACTIVIDAD = "actividad.status"
DISPONIBLE = "Disponible"
# Campos que la API publica en un solo curso de cada 258: si ese curso cambia, la forma parecería otra.
CAMPOS_ESPORADICOS = frozenset({"actividad.minAge", "actividad.maxAge"})


class ErrorLecturaCibervoluntarios(ValueError):
    """Lo que se pide no corresponde a una lectura de Cibervoluntarios o a su carpeta de originales."""


@dataclass(frozen=True, kw_only=True)
class Pagina:
    """Una página del censo que aportó lectura: su hora, el total que declara y lo que trae."""

    fin_utc: str
    total_declarado: int
    actividades: tuple[ObjetoJson, ...]
    materiales: tuple[MaterialCiber, ...]


@dataclass(frozen=True, kw_only=True)
class Captura:
    """Lo que la adquisición sabe del censo recibido: hora, si llegó entero, el total que declara y su contenido."""

    observado_utc: str
    completa: bool
    total_declarado: int
    actividades: tuple[ObjetoJson, ...]
    materiales: tuple[MaterialCiber, ...]


@dataclass(frozen=True, kw_only=True)
class Resultado:
    """Las lecturas emitidas y lo que impidió emitirlas o compararlas con su historia (vacío si nada)."""

    emisiones: tuple[Emision, ...]
    problemas: tuple[str, ...]


def instante(texto: str) -> str:
    """Escribe el instante de un recibo como lo guarda el registro de lecturas: en UTC y al segundo.

    Returns:
        El texto `AAAA-MM-DDTHH:MM:SSZ`.

    Raises:
        ErrorLecturaCibervoluntarios: Si el instante no dice su zona.
    """
    momento = datetime.fromisoformat(texto)
    if momento.tzinfo is None:
        raise ErrorLecturaCibervoluntarios("un instante sin zona no se puede situar en UTC")
    return momento.astimezone(UTC).strftime(FORMATO_INSTANTE)


def _campos_de_material(captura: Captura) -> Iterator[str]:
    for actividad in captura.actividades:
        for material in actividad["activityCatalogMaterials"]:
            yield from ("programa." + campo for campo in material)


def _rutas_de_campos(captura: Captura) -> tuple[str, ...]:
    rutas = {"actividad." + campo for actividad in captura.actividades for campo in actividad}
    rutas.update(_campos_de_material(captura))
    return tuple(sorted(rutas - CAMPOS_ESPORADICOS))


def _estado_nuevo(campo: str, estado: object) -> ValorNuevo | None:
    if isinstance(estado, str) and estado not in ESTADOS_CONOCIDOS:
        return ValorNuevo(campo=campo, valor=estado)
    return None


def _valores_nuevos(captura: Captura) -> tuple[ValorNuevo, ...]:
    nuevos = {_estado_nuevo(CAMPO_ESTADO_ACTIVIDAD, a.get("status")) for a in captura.actividades}
    nuevos.update(_estado_nuevo(CAMPO_ESTADO_MATERIAL, m.material_publicado.get("status")) for m in captura.materiales)
    return tuple(sorted((n for n in nuevos if n is not None), key=lambda n: (n.campo, n.valor)))


def _comun(captura: Captura) -> ObjetoJson:
    """Lo que comparten las dos lecturas de una misma captura: fuente, hora, censo completo y forma.

    Returns:
        Los argumentos comunes del `Censo`.
    """
    return {
        "fuente": FUENTE,
        "observado_utc": captura.observado_utc,
        "completa": captura.completa,
        "motivo_incompleta": None if captura.completa else "consulta_fallida",
        "niveles": NIVELES,
        "rutas_de_campos": _rutas_de_campos(captura),
        "valores_nuevos": _valores_nuevos(captura),
    }


def _baja_en_el_catalogo(programa: ObjetoJson) -> bool:
    """Si lo último que el catálogo instalado sabe de un material es una baja declarada por la fuente.

    Es la misma baja que `MaterialCiber.baja_declarada`, leída de lo guardado: el `erased` del material o un estado
    que no es «Disponible» en el material o en su actividad.

    Returns:
        True si el material estaba declarado de baja la última vez que se leyó.
    """
    datos = programa.get("datos", {})
    material, actividad = datos.get("material_publicado") or {}, datos.get("actividad_publicada") or {}
    estados = (material.get("status"), actividad.get("status"))
    return material.get("erased") is True or any(isinstance(e, str) and e != DISPONIBLE for e in estados)


def explicar_material(conocidos: dict[str, ObjetoJson]) -> Callable[[str], str | None]:
    """Explica la salida de un material por la baja que la fuente ya había declarado de él.

    Returns:
        La función que la emisión aplica a cada material que sale.
    """

    def explicar(id: str) -> str | None:
        programa = conocidos.get(id)
        return "fuente_declara_baja" if programa is not None and _baja_en_el_catalogo(programa) else None

    return explicar


def explicar_actividad(conocidos: dict[str, ObjetoJson]) -> Callable[[str], str | None]:
    """Explica la salida de una actividad cuando todos sus materiales conocidos estaban declarados de baja.

    Returns:
        La función que la emisión aplica a cada actividad que sale.
    """

    def explicar(id: str) -> str | None:
        suyos = [p for p in conocidos.values() if _actividad_de(p) == id]
        return "fuente_declara_baja" if suyos and all(_baja_en_el_catalogo(p) for p in suyos) else None

    return explicar


def _actividad_de(programa: ObjetoJson) -> str | None:
    identidad = programa.get("datos", {}).get("identidad_fuente", {})
    return None if "actividad_id" not in identidad else PREFIJO_ACTIVIDAD + str(identidad["actividad_id"])


def censo_de_materiales(captura: Captura, conocidos: dict[str, ObjetoJson]) -> Censo:
    """El censo de los materiales: cada material de cada actividad recibida.

    La API no declara cuántos materiales tiene: su total declarado no consta.

    Returns:
        El censo listo para emitir.
    """
    return Censo(
        **_comun(captura),
        ambito=AMBITO_MATERIALES,
        ids=frozenset(PREFIJO_MATERIAL + str(m.id) for m in captura.materiales),
        recuento_bruto=len(captura.materiales),
        recuento_vigente=sum(m.disponible for m in captura.materiales),
        explicar_salida=explicar_material(conocidos),
    )


def censo_de_actividades(captura: Captura, conocidos: dict[str, ObjetoJson]) -> Censo:
    """El censo de las actividades: cada actividad recibida, con el total que declara la API.

    Returns:
        El censo listo para emitir.
    """
    con_material_vigente = {m.actividad_id for m in captura.materiales if m.disponible}
    return Censo(
        **_comun(captura),
        ambito=AMBITO_ACTIVIDADES,
        ids=frozenset(PREFIJO_ACTIVIDAD + str(a["id"]) for a in captura.actividades),
        recuento_bruto=len(captura.actividades),
        recuento_vigente=len(con_material_vigente),
        total_declarado=captura.total_declarado,
        explicar_salida=explicar_actividad(conocidos),
    )


def raiz_de(original: Path) -> Path:
    """La instalación a la que pertenece la carpeta de originales de la fuente.

    Returns:
        La raíz bajo la que viven `var/actualizacion/originales` y el registro de lecturas.

    Raises:
        ErrorLecturaCibervoluntarios: Si la carpeta no es la de originales de Cibervoluntarios de una instalación.
    """
    niveles = len(DATOS_RELATIVOS.parts) + 1
    raiz = original.parents[niveles] if len(original.parents) > niveles else None
    if raiz is None or raiz / DATOS_RELATIVOS / "originales" / FUENTE != original:
        raise ErrorLecturaCibervoluntarios(f"{original} no es la carpeta de originales de Cibervoluntarios")
    return raiz


def _captura(original: Path, capturas: list[ObjetoJson], leer: Callable[[Path, ObjetoJson], Pagina | None]) -> Captura:
    """Reúne lo leído de las páginas recibidas; una página caída deja el censo incompleto.

    Returns:
        La captura del censo, con la hora de su primera página.

    Raises:
        ErrorLecturaCibervoluntarios: Si la primera página no aportó censo.
    """
    paginas = [leer(original, cap) for cap in capturas]
    primera = paginas[0] if paginas else None
    if primera is None:
        raise ErrorLecturaCibervoluntarios("sin la primera página no hay censo que registrar")
    leidas = [p for p in paginas if p is not None]
    return Captura(
        observado_utc=instante(primera.fin_utc),
        completa=len(leidas) == len(paginas),
        total_declarado=primera.total_declarado,
        actividades=tuple(a for p in leidas for a in p.actividades),
        materiales=tuple(m for p in leidas for m in p.materiales),
    )


def emitir(
    original: Path,
    capturas: list[ObjetoJson],
    programas: list[ObjetoJson],
    *,
    leer: Callable[[Path, ObjetoJson], Pagina | None],
) -> Resultado:
    """Emite las lecturas de materiales y de actividades de un censo recién recibido.

    `leer` devuelve lo que aportó cada página recibida, o None si cayó. El registro es telemetría: si algo impide
    emitir una lectura, se dice en el resultado y la adquisición sigue como habría seguido. Solo se recogen los
    errores de los datos y del disco; un defecto del código no se esconde.

    Returns:
        Las lecturas emitidas y los problemas, si los hubo.
    """
    try:
        raiz = raiz_de(original)
        captura = _captura(original, capturas, leer)
        conocidos = {p["id"]: p for p in programas}
        censos = (censo_de_materiales(captura, conocidos), censo_de_actividades(captura, conocidos))
    except (ErrorFuente, OSError, ValueError) as error:
        return Resultado(emisiones=(), problemas=(f"la lectura de Cibervoluntarios no se pudo preparar ({error})",))
    emisiones, problemas = [], []
    for censo in censos:
        try:
            emision = emitir_lectura(raiz, censo)
        except (OSError, ValueError) as error:
            problemas.append(f"la lectura de {censo.ambito} no se pudo emitir ({error})")
            continue
        emisiones.append(emision)
        problemas.extend(emision.problemas)
    return Resultado(emisiones=tuple(emisiones), problemas=tuple(problemas))


def _declaracion_de_baja(lectura_id: str, material: MaterialCiber) -> Declaracion | None:
    """La baja que la fuente declara de un material, con la huella del campo literal que la dice.

    Returns:
        La declaración, o None si el material no está declarado de baja.
    """
    baja = material.baja_declarada
    if baja is None:
        return None
    _motivo, literal, campo, objeto = baja
    literal_publicado = {"objeto": objeto, "campo": campo, "valor": literal}
    return Declaracion(lectura_id=lectura_id, canal="baja_declarada", sha256=sha256_json(literal_publicado))


def declaraciones(lectura: ObjetoJson, materiales: tuple[MaterialCiber, ...]) -> dict[str, tuple[Declaracion, ...]]:
    """Las bajas que la fuente declara de cada material de una lectura, para la regla de retirada.

    Los materiales tienen que ser los de la captura de esa lectura: sus identificadores deben dar la huella de
    identificadores de la lectura.

    Returns:
        Las declaraciones por identificador de material; un material sin baja declarada no aparece.

    Raises:
        ErrorLecturaCibervoluntarios: Si la lectura no es de los materiales de Cibervoluntarios o no es la de esos
            materiales.
    """
    if lectura["fuente"] != FUENTE or lectura["ambito"] != AMBITO_MATERIALES:
        raise ErrorLecturaCibervoluntarios(
            "las declaraciones salen de una lectura de los materiales de Cibervoluntarios"
        )
    ids = [PREFIJO_MATERIAL + str(m.id) for m in materiales]
    if huella_de_ids(ids) != lectura["ids_sha256"]:
        raise ErrorLecturaCibervoluntarios("los materiales no son los de la captura de esta lectura")
    todas = {id: _declaracion_de_baja(lectura["lectura_id"], m) for id, m in zip(ids, materiales, strict=True)}
    return {id: (declarada,) for id, declarada in todas.items() if declarada is not None}
