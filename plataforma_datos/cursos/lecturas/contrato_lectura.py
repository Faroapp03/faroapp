"""Contrato `lectura-fuente` versión 1: lo que trajo cada lectura del censo de una fuente.

Una lectura resume una consulta del listado de una fuente: si el censo llegó completo, cuántos cursos trajo, la huella
de sus identificadores, qué cursos entraron y salieron respecto a la lectura anterior (y qué explica cada salida) y la
huella de la forma de la captura. Su estado y sus motivos los decide una regla identificada por su versión y su huella;
este contrato no decide nada: exige que la lectura sea coherente consigo misma.

El identificador de la lectura es la huella de lo observado, es decir, de todo salvo el estado, los motivos y la regla.
Así la misma observación tiene siempre el mismo identificador y su veredicto no se puede reescribir con otro.

Una regla que calibra cuántas salidas sin explicar admite escribe además, en las lecturas completas, su `calibracion`:
el límite, de dónde salió y la historia que lo sostiene. Es parte de la decisión y no entra en el identificador; una
lectura calificada por una regla que no calibra no lleva ese campo y se lee igual.
"""

import json
import math
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime

from plataforma_datos.comun.huella_json import JsonNoCanonico, sha256_json
from plataforma_datos.cursos.clasificacion.contrato import (
    CAMPOS_REGLA,
    IDENTIFICADOR_REGLA,
    MAX_IDENTIFICADOR_REGLA,
    Regla,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

CONTRATO = "lectura-fuente"
VERSION = 1
ESTADOS = ("sana", "anomala", "incompleta", "reconstruida")
# Lo que hace anómala una lectura completa. Una ausencia en una lectura anómala no cuenta como observación.
MOTIVOS = ("forma_cambiada", "total_declarado_distinto", "valor_desconocido", "salidas_no_explicadas_en_bloque")
# Por qué un censo no llegó completo: la fuente no publica un listado entero, una consulta falló o se alcanzó el tope
# de consultas o de tiempo.
MOTIVOS_INCOMPLETA = ("sin_censo", "consulta_fallida", "limite_alcanzado")
# Lo que explica que un curso deje de estar en el censo; `None` dice que nada lo explica.
EXPLICACIONES_DE_SALIDA = ("fin_publicado", "fuente_declara_baja")
NIVELES = ("actividad", "edicion", "programa")
CAMPOS = (
    "version",
    "fuente",
    "ambito",
    "lectura_id",
    "anterior",
    "observado_utc",
    "completa",
    "motivo_incompleta",
    "recuento_bruto",
    "recuento_vigente",
    "total_declarado",
    "ids_sha256",
    "entradas",
    "salidas",
    "huella_forma",
    "estado",
    "motivos",
    "regla",
)
CAMPO_CALIBRACION = "calibracion"
# Lo que decide la regla; el resto es lo observado y forma el identificador.
CAMPOS_DE_LA_DECISION = ("estado", "motivos", "regla", CAMPO_CALIBRACION)
CAMPOS_CALIBRACION = (
    "limite",
    "origen",
    "sin_explicar",
    "suelo",
    "techo",
    "lecturas_de_historia",
    "confirmadas",
    "desmentidas",
    "exposicion_de_historia",
    "exposicion",
    "ritmo_por_curso_y_dia",
    "dispersion",
    "cota_por_curso_y_dia",
    "esperadas_con_la_cota",
)
# El límite sale del suelo fijo (poca historia), de la historia o del techo del bruto que la historia no puede pasar.
ORIGENES_DEL_LIMITE = ("suelo", "historia", "techo")
CAMPOS_DE_LA_ESTIMACION = ("ritmo_por_curso_y_dia", "dispersion", "cota_por_curso_y_dia", "esperadas_con_la_cota")
CAMPOS_SALIDA = ("id", "explicada_por")
CAMPOS_FORMA = ("campos_sha256", "niveles", "valores_nuevos")
CAMPOS_VALOR_NUEVO = ("campo", "valor")
FUENTE = re.compile(r"[a-z0-9]+(?:[_-][a-z0-9]+)*")
AMBITO = re.compile(r"[a-z0-9]+(?:[_:-][a-z0-9]+)*")
SHA256 = re.compile(r"[0-9a-f]{64}")
# La hora se escribe siempre igual, al segundo y en UTC, para que ordenar el texto sea ordenar el tiempo.
INSTANTE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
FORMATO_INSTANTE = "%Y-%m-%dT%H:%M:%SZ"
MAX_FUENTE = 64
MAX_AMBITO = 80
MAX_TEXTO = 512
MAX_IDENTIFICADORES = 50_000
MAX_VALORES_NUEVOS = 200
MAX_BYTES = 8 * 1024 * 1024
PRIMER_IMPRIMIBLE = 32
BORRAR = 127


class ErrorLectura(ValueError):
    """Una lectura de fuente que no cumple el contrato: no se guarda ni se usa como evidencia."""


def exigir(condicion: object, motivo: str) -> None:
    """Rechaza un incumplimiento con un mensaje que dice qué campo falla y por qué.

    Raises:
        ErrorLectura: Si la condición no se cumple.
    """
    if not condicion:
        raise ErrorLectura(f"{CONTRATO}: {motivo}")


def exigir_campos(valor: ValorJson, campos: tuple[str, ...], lugar: str) -> None:
    """Exige un objeto con exactamente esos campos: el contrato es cerrado y no admite campos de más ni de menos."""
    exigir(isinstance(valor, dict), f"{lugar} debe ser un objeto")
    sobran = sorted(set(valor) - set(campos))
    faltan = [campo for campo in campos if campo not in valor]
    exigir(not sobran, f"{lugar}: campo no admitido «{', '.join(sobran)}»")
    exigir(not faltan, f"{lugar}: falta el campo «{', '.join(faltan)}»")


def exigir_fuente(valor: ValorJson) -> None:
    """Exige el nombre de la carpeta de una fuente, que también nombra su carpeta de lecturas."""
    exigir(
        isinstance(valor, str) and len(valor) <= MAX_FUENTE and FUENTE.fullmatch(valor) is not None,
        "fuente no admitida",
    )


def _texto(valor: ValorJson, lugar: str) -> None:
    exigir(isinstance(valor, str) and 0 < len(valor) <= MAX_TEXTO, f"{lugar}: texto vacío o demasiado largo")
    exigir(
        all(ord(c) >= PRIMER_IMPRIMIBLE and ord(c) != BORRAR for c in valor),
        f"{lugar}: texto con caracteres de control",
    )


def _sha256(valor: ValorJson, lugar: str) -> None:
    exigir(isinstance(valor, str) and SHA256.fullmatch(valor) is not None, f"{lugar}: huella SHA-256 no válida")


def _recuento(valor: ValorJson, lugar: str) -> None:
    # `bool` es un `int` en Python; un recuento es siempre un entero de verdad.
    exigir(type(valor) is int and valor >= 0, f"{lugar}: recuento no válido")


def _instante(valor: ValorJson) -> None:
    exigir(isinstance(valor, str) and INSTANTE.fullmatch(valor) is not None, "observado_utc: hora UTC no válida")
    try:
        datetime.strptime(valor, FORMATO_INSTANTE)
    except ValueError as error:
        raise ErrorLectura(f"{CONTRATO}: observado_utc: fecha inexistente") from error


def clave_de_salida(salida: ObjetoJson) -> str:
    """El orden canónico de las salidas: por el identificador del curso.

    Returns:
        El identificador del curso que sale.
    """
    return salida["id"]


def clave_de_valor_nuevo(nuevo: ObjetoJson) -> tuple[str, str]:
    """El orden canónico de los valores nuevos: por campo y, dentro de cada campo, por valor.

    Returns:
        El par (campo, valor).
    """
    return nuevo["campo"], nuevo["valor"]


def _canonica(lista: list, lugar: str, clave: Callable[[ObjetoJson], object] | None = None) -> None:
    """Exige la lista en el orden en que la escribe la construcción y sin repetidos según su clave."""
    exigir(len(lista) <= MAX_IDENTIFICADORES, f"{lugar}: demasiados elementos")
    claves = list(lista) if clave is None else [clave(elemento) for elemento in lista]
    exigir(claves == sorted(claves), f"{lugar}: sin orden canónico")
    exigir(len(set(claves)) == len(claves), f"{lugar}: elementos repetidos")


def _entradas(entradas: ValorJson) -> None:
    exigir(isinstance(entradas, list), "entradas: lista no válida")
    for identificador in entradas:
        _texto(identificador, "entradas")
    _canonica(entradas, "entradas")


def _salidas(salidas: ValorJson) -> None:
    exigir(isinstance(salidas, list), "salidas: lista no válida")
    for salida in salidas:
        exigir_campos(salida, CAMPOS_SALIDA, "salida")
        _texto(salida["id"], "salida")
        explicacion = salida["explicada_por"]
        exigir(explicacion is None or explicacion in EXPLICACIONES_DE_SALIDA, "salida: explicación no admitida")
    _canonica(salidas, "salidas", clave_de_salida)


def _forma(forma: ValorJson) -> None:
    exigir_campos(forma, CAMPOS_FORMA, "huella_forma")
    _sha256(forma["campos_sha256"], "huella_forma.campos_sha256")
    niveles = forma["niveles"]
    exigir(
        isinstance(niveles, list) and all(isinstance(n, str) and n in NIVELES for n in niveles),
        "huella_forma: nivel no admitido",
    )
    _canonica(niveles, "huella_forma.niveles")
    nuevos = forma["valores_nuevos"]
    exigir(isinstance(nuevos, list) and len(nuevos) <= MAX_VALORES_NUEVOS, "huella_forma: valores nuevos no válidos")
    for nuevo in nuevos:
        exigir_campos(nuevo, CAMPOS_VALOR_NUEVO, "valor nuevo")
        _texto(nuevo["campo"], "valor nuevo")
        _texto(nuevo["valor"], "valor nuevo")
    _canonica(nuevos, "huella_forma.valores_nuevos", clave_de_valor_nuevo)


def _regla(regla: ValorJson) -> None:
    exigir_campos(regla, CAMPOS_REGLA, "regla")
    identificador = regla["id"]
    exigir(
        isinstance(identificador, str)
        and len(identificador) <= MAX_IDENTIFICADOR_REGLA
        and IDENTIFICADOR_REGLA.fullmatch(identificador) is not None,
        "regla: identificador no admitido",
    )
    exigir(type(regla["version"]) is int and regla["version"] >= 1, "regla: versión no admitida")
    _sha256(regla["sha256"], "regla.sha256")


def _censo(lectura: ObjetoJson) -> None:
    """Si el censo llegó completo y por qué no, y los recuentos: lo vigente es parte de lo leído."""
    completa, motivo = lectura["completa"], lectura["motivo_incompleta"]
    exigir(type(completa) is bool, "completa debe ser verdadero o falso")
    if completa:
        exigir(motivo is None, "un censo completo no lleva motivo_incompleta")
    else:
        exigir(motivo in MOTIVOS_INCOMPLETA, "un censo incompleto necesita un motivo_incompleta admitido")
    _recuento(lectura["recuento_bruto"], "recuento_bruto")
    _recuento(lectura["recuento_vigente"], "recuento_vigente")
    exigir(lectura["recuento_vigente"] <= lectura["recuento_bruto"], "recuento_vigente mayor que recuento_bruto")
    if lectura["total_declarado"] is not None:
        _recuento(lectura["total_declarado"], "total_declarado")
    _sha256(lectura["ids_sha256"], "ids_sha256")


def _movimientos(lectura: ObjetoJson) -> None:
    """Entradas y salidas respecto a la lectura anterior; la primera lista como entradas todo su censo."""
    _entradas(lectura["entradas"])
    _salidas(lectura["salidas"])
    salen = {salida["id"] for salida in lectura["salidas"]}
    exigir(salen.isdisjoint(lectura["entradas"]), "un curso no puede entrar y salir en la misma lectura")
    if lectura["anterior"] is None:
        exigir(not lectura["salidas"], "la primera lectura no tiene salidas")
        exigir(huella_de_ids(lectura["entradas"]) == lectura["ids_sha256"], "la primera lectura no lista su censo")
    else:
        _sha256(lectura["anterior"], "anterior")


def _decision(lectura: ObjetoJson) -> None:
    """Las reglas que atan el estado y los motivos a lo observado; decidirlos es de la regla, no del contrato."""
    estado, motivos = lectura["estado"], lectura["motivos"]
    exigir(estado in ESTADOS, "estado no admitido")
    exigir(
        isinstance(motivos, list) and all(isinstance(m, str) and m in MOTIVOS for m in motivos), "motivo no admitido"
    )
    _canonica(motivos, "motivos")
    if estado == "sana":
        exigir(lectura["completa"] and not motivos, "una lectura sana es completa y no lleva motivos")
    elif estado == "anomala":
        exigir(lectura["completa"] and motivos, "una lectura anómala es completa y lleva al menos un motivo")
    elif estado == "incompleta":
        exigir(not lectura["completa"], "una lectura incompleta no tiene el censo completo")
    nuevos = lectura["huella_forma"]["valores_nuevos"]
    exigir(("valor_desconocido" in motivos) == bool(nuevos), "valor_desconocido va siempre con sus valores nuevos")
    if "total_declarado_distinto" in motivos:
        declarado = lectura["total_declarado"]
        exigir(
            declarado is not None and declarado != lectura["recuento_bruto"],
            "total_declarado_distinto necesita un total declarado distinto del recuento bruto",
        )
    if "salidas_no_explicadas_en_bloque" in motivos:
        exigir(
            any(salida["explicada_por"] is None for salida in lectura["salidas"]),
            "salidas_no_explicadas_en_bloque necesita salidas sin explicación",
        )
    _regla(lectura["regla"])


def _estimacion(valor: ValorJson, lugar: str) -> None:
    exigir(type(valor) in (int, float) and math.isfinite(valor) and valor >= 0, f"{lugar}: número no válido")


def _calibracion(lectura: ObjetoJson) -> None:
    """La calibración, si la regla la escribió: completa, cerrada y coherente con sus salidas y con su motivo."""
    if CAMPO_CALIBRACION not in lectura:
        return
    calibracion = lectura[CAMPO_CALIBRACION]
    exigir(lectura["completa"], "solo una lectura de censo completo lleva calibración")
    exigir_campos(calibracion, CAMPOS_CALIBRACION, "calibracion")
    for campo in CAMPOS_CALIBRACION:
        if campo != "origen" and campo not in CAMPOS_DE_LA_ESTIMACION:
            _recuento(calibracion[campo], f"calibracion.{campo}")
    origen, limite = calibracion["origen"], calibracion["limite"]
    exigir(origen in ORIGENES_DEL_LIMITE, "calibracion: origen del límite no admitido")
    sin_explicar = sum(1 for salida in lectura["salidas"] if salida["explicada_por"] is None)
    exigir(calibracion["sin_explicar"] == sin_explicar, "calibracion: no cuenta las salidas sin explicar")
    exigir(calibracion["suelo"] <= calibracion["techo"], "calibracion: el techo queda por debajo del suelo")
    exigir(
        limite == calibracion["suelo"] if origen == "suelo" else limite <= calibracion["techo"],
        "calibracion: el límite no corresponde a su origen",
    )
    exigir(origen != "techo" or limite == calibracion["techo"], "calibracion: el límite no es el techo")
    for campo in CAMPOS_DE_LA_ESTIMACION:
        if origen == "suelo":
            exigir(calibracion[campo] is None, f"calibracion.{campo}: el suelo no estima el ritmo")
        else:
            _estimacion(calibracion[campo], f"calibracion.{campo}")
    exigir(origen == "suelo" or calibracion["dispersion"] >= 1, "calibracion: la dispersión es menor que la de Poisson")
    exigir(
        ("salidas_no_explicadas_en_bloque" in lectura["motivos"]) == (sin_explicar > limite),
        "calibracion: el motivo de salidas en bloque no corresponde al límite",
    )


def huella_de_ids(identificadores: Iterable[str]) -> str:
    """La huella del conjunto de identificadores de un censo, sin importar su orden ni sus repeticiones.

    Returns:
        El SHA-256 de la lista ordenada y sin repetidos.
    """
    return sha256_json(sorted(set(identificadores)))


def huella_de_campos(campos: Iterable[str]) -> str:
    """La huella de los campos presentes en una captura, escritos como rutas (`edicion.fecha_inicio`).

    Returns:
        El SHA-256 de la lista ordenada y sin repetidos.
    """
    return sha256_json(sorted(set(campos)))


def identificador_de(lectura: ObjetoJson) -> str:
    """El identificador de una lectura: la huella de lo observado, sin el estado, los motivos ni la regla.

    Returns:
        El SHA-256 que nombra la lectura en su almacén.

    Raises:
        ErrorLectura: Si algún dato de la lectura no es JSON.
    """
    observado = {k: v for k, v in lectura.items() if k not in ("lectura_id", *CAMPOS_DE_LA_DECISION)}
    try:
        return sha256_json(observado)
    except JsonNoCanonico as error:
        raise ErrorLectura(f"{CONTRATO}: la lectura lleva valores que no son JSON") from error


def validar_lectura(lectura: ValorJson) -> None:
    """Valida una lectura tal como se guarda: cerrada, coherente y con el identificador de lo que observó.

    Raises:
        ErrorLectura: Si la lectura incumple el contrato; el mensaje dice qué campo falla.
    """
    exigir_campos(lectura, (*CAMPOS, CAMPO_CALIBRACION) if CAMPO_CALIBRACION in lectura else CAMPOS, "lectura")
    exigir(type(lectura["version"]) is int and lectura["version"] == VERSION, "versión no admitida")
    exigir_fuente(lectura["fuente"])
    exigir(
        isinstance(lectura["ambito"], str)
        and len(lectura["ambito"]) <= MAX_AMBITO
        and AMBITO.fullmatch(lectura["ambito"]) is not None,
        "ámbito no admitido",
    )
    _instante(lectura["observado_utc"])
    _censo(lectura)
    _movimientos(lectura)
    _forma(lectura["huella_forma"])
    _decision(lectura)
    _calibracion(lectura)
    _sha256(lectura["lectura_id"], "lectura_id")
    exigir(lectura["lectura_id"] == identificador_de(lectura), "lectura_id no es la huella de lo observado")


def bytes_de(lectura: ObjetoJson) -> bytes:
    """Serializa una lectura en JSON canónico, como los recibos y la entrega de Cursos.

    Returns:
        Los bytes UTF-8 con las claves ordenadas, sin espacios y con un salto de línea final.
    """
    return (
        json.dumps(lectura, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
    ).encode()


def _pares_unicos(pares: list[tuple[str, ValorJson]]) -> ObjetoJson:
    resultado = {}
    for clave, valor in pares:
        exigir(clave not in resultado, f"clave repetida «{clave}»")
        resultado[clave] = valor
    return resultado


def _numero_no_finito(texto: str) -> None:
    raise ErrorLectura(f"{CONTRATO}: número no finito «{texto}»")


def leer_lectura(contenido: bytes) -> ObjetoJson:
    """Lee una lectura guardada: JSON estricto, en forma canónica y conforme al contrato.

    Returns:
        La lectura validada.

    Raises:
        ErrorLectura: Si los bytes no son una lectura válida en forma canónica.
    """
    exigir(len(contenido) <= MAX_BYTES, "lectura demasiado grande")
    try:
        dato = json.loads(contenido.decode("utf-8"), object_pairs_hook=_pares_unicos, parse_constant=_numero_no_finito)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ErrorLectura(f"{CONTRATO}: no es JSON en UTF-8") from error
    validar_lectura(dato)
    exigir(bytes_de(dato) == contenido, "la lectura no está en forma canónica")
    return dato


@dataclass(frozen=True, kw_only=True)
class Salida:
    """Un curso que estaba en la lectura anterior y ya no está, con lo que lo explica o `None` si nada lo explica."""

    id: str
    explicada_por: str | None

    def a_json(self) -> ObjetoJson:
        """Devuelve la salida tal como se guarda.

        Returns:
            El objeto de la salida.
        """
        return {"id": self.id, "explicada_por": self.explicada_por}


@dataclass(frozen=True, kw_only=True)
class ValorNuevo:
    """Un valor que la captura trae en un campo de vocabulario cerrado y que ese vocabulario no reconoce."""

    campo: str
    valor: str

    def a_json(self) -> ObjetoJson:
        """Devuelve el valor nuevo tal como se guarda.

        Returns:
            El objeto del valor nuevo.
        """
        return {"campo": self.campo, "valor": self.valor}


@dataclass(frozen=True, kw_only=True)
class HuellaForma:
    """La forma de la captura: la huella de sus campos, los niveles que trae y los valores que no se reconocen."""

    campos_sha256: str
    niveles: tuple[str, ...] = ()
    valores_nuevos: tuple[ValorNuevo, ...] = ()

    def a_json(self) -> ObjetoJson:
        """Devuelve la huella de la forma en orden canónico; un repetido queda y lo rechaza la validación.

        Returns:
            El objeto de la huella de la forma.
        """
        nuevos = sorted((v.a_json() for v in self.valores_nuevos), key=clave_de_valor_nuevo)
        return {"campos_sha256": self.campos_sha256, "niveles": sorted(self.niveles), "valores_nuevos": nuevos}


@dataclass(frozen=True, kw_only=True)
class Lectura:
    """Una lectura del censo de una fuente; al construirla se valida exactamente lo que se guardará."""

    fuente: str
    ambito: str
    anterior: str | None
    observado_utc: str
    completa: bool
    motivo_incompleta: str | None = None
    recuento_bruto: int
    recuento_vigente: int
    total_declarado: int | None = None
    ids_sha256: str
    entradas: tuple[str, ...] = ()
    salidas: tuple[Salida, ...] = ()
    huella_forma: HuellaForma
    estado: str
    motivos: tuple[str, ...] = ()
    regla: Regla
    calibracion: ObjetoJson | None = None

    def __post_init__(self) -> None:
        """Rechaza al construirla una lectura que no cumple el contrato."""
        validar_lectura(self.a_json())

    def a_json(self) -> ObjetoJson:
        """Devuelve la lectura tal como se guarda, con sus listas en orden canónico y su identificador calculado.

        Returns:
            El objeto de la lectura.
        """
        lectura: ObjetoJson = {
            "version": VERSION,
            "fuente": self.fuente,
            "ambito": self.ambito,
            "anterior": self.anterior,
            "observado_utc": self.observado_utc,
            "completa": self.completa,
            "motivo_incompleta": self.motivo_incompleta,
            "recuento_bruto": self.recuento_bruto,
            "recuento_vigente": self.recuento_vigente,
            "total_declarado": self.total_declarado,
            "ids_sha256": self.ids_sha256,
            "entradas": sorted(self.entradas),
            "salidas": sorted((s.a_json() for s in self.salidas), key=clave_de_salida),
            "huella_forma": self.huella_forma.a_json(),
            "estado": self.estado,
            "motivos": sorted(self.motivos),
            "regla": self.regla.a_json(),
        }
        if self.calibracion is not None:
            lectura[CAMPO_CALIBRACION] = self.calibracion
        return {"lectura_id": identificador_de(lectura), **lectura}
