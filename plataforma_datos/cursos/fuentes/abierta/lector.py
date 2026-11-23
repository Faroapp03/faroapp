"""Formación abierta: cursos gratuitos en línea elegidos a mano con un criterio público.

No es una fuente oficial ni se lee de forma automática: las condiciones de las plataformas no permiten extraer ni
reutilizar sus contenidos (nivel 3 de licencia). Equipo Faro abre la página de cada curso y redacta su ficha en
var/actualizacion/preparados/abierta/fichas.json: solo hechos (título tal cual, entidad, enlace, idioma, horas, nivel,
fechas, certificado), sin descripciones, fotos ni logos, con el resultado de cada requisito del criterio
«Formación abierta» v1.1 (docs/criterio-formacion-abierta.md) y el enlace que lo prueba.

Las etapas siguen la interfaz común: `descargar` explica de dónde salen las fichas, `preparar` registra su procedencia
(huella y fecha de comprobación) y `validar` comprueba cada ficha contra el criterio: solo las que cumplen los diez
requisitos pasan al conjunto validado, y las demás quedan en la validación con el requisito que no cumplen. Una ficha
deja de exportarse cuando llega su fin publicado; el tiempo desde su comprobación no la retira. La revisión es mensual:
`validar` avisa MARGEN_DE_AVISO días antes de que una ficha pase DIAS_DE_REVISION días sin revisar, y desde entonces,
sin cambiar lo que se muestra. FARO_HOY=AAAA-MM-DD valida con otro día para reproducir una versión. Python estándar.

Uso: python3 -m plataforma_datos.cursos.fuentes.abierta.lector {descargar,preparar,validar,todo}
"""

import os
import re
import sys
from collections.abc import Collection, Mapping
from datetime import date, timedelta
from math import isfinite
from typing import Any
from urllib.parse import urlsplit

from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    guardar_json_fechado,
    hoy_utc,
    leer_json,
    relativa,
    requerir,
    sha256,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, exigir
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "abierta"
PREPARADO = carpetas(FUENTE).preparado
FICHAS = PREPARADO / "fichas.json"
PROCEDENCIA = PREPARADO / ARCHIVO_DE_PROCEDENCIA
CRITERIO = "v1.1"
FECHA = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
INICIO_ASCII_IMPRIMIBLE = 32
NUMERO_DE_REQUISITOS = 10  # los requisitos R1…R10 del criterio «Formación abierta» v1.1
REQUISITOS = tuple(f"R{numero}" for numero in range(1, NUMERO_DE_REQUISITOS + 1))
# Lo que dice una ficha, y nada más: sin campo de descripción, la ficha no puede copiar textos de la plataforma.
CAMPOS = (
    "id",
    "titulo",
    "entidad",
    "titular",
    "enlace",
    "idioma",
    "traduccion_automatica",
    "tema",
    "area_digcomp",
    "nivel",
    "horas",
    "a_tu_ritmo",
    "inicio",
    "fin",
    "dirigido_a",
    "certificado",
    "comprobado",
    "requisitos",
)
TITULARES = ("publico", "no-publico")
TEMAS = ("digital", "ia")
IDIOMAS = ("es", "ca")
# «iniciacion»: el curso no pide requisitos y no declara un nivel de DigComp; si no, el nivel DigComp que publica.
NIVELES = ("iniciacion", "A1", "A2", "B1", "B2", "C1", "C2")
# Las cinco áreas de DigComp; no se admiten otras cifras como hechos de una ficha.
AREAS_DIGCOMP = (1, 2, 3, 4, 5)
# La revisión es mensual; a los 91 días sin revisar, `validar` avisa de que la revisión está pendiente. Es solo un
# aviso interno: no retira la ficha ni cambia sus datos.
DIAS_DE_REVISION = 90
# Cuántos días antes de que la revisión quede pendiente empieza a avisar `validar`: un mes, el ciclo de la revisión.
MARGEN_DE_AVISO = 30
# Para reproducir una versión ya publicada, el día con que se valida (AAAA-MM-DD); sin ella, hoy. El día decide qué
# fichas han llegado a su fin publicado y qué avisos de revisión salen.
VARIABLE_DEL_DIA = "FARO_HOY"
LICENCIA = (
    "Fichas redactadas por Equipo Faro, con la licencia del proyecto. Los cursos enlazados son de sus titulares y se "
    "rigen por sus condiciones (ver «plataformas» en fichas.json): Faro solo copia el título y enlaza la página "
    "pública del curso, sin parámetros de seguimiento ni de afiliación."
)
CITA = "Selección de Faro con el criterio «Formación abierta» v1.1: fichas redactadas por Faro, con enlace y fecha."


def _exigir_documento(documento: object) -> None:
    """Exige la raíz del documento antes de leer listas, plataformas o fechas."""
    exigir(
        isinstance(documento, dict)
        and isinstance(documento.get("fichas"), list)
        and isinstance(documento.get("plataformas"), dict),
        "fichas.json tiene que llevar «fichas» (lista) y «plataformas» (objeto)",
    )


def leer_fichas() -> dict[str, Any]:
    """Lee el documento de fichas tal como lo redactó Equipo Faro.

    Returns:
        El contenido de fichas.json.

    Raises:
        ArchivoFaltante: Si falta fichas.json.
        FormatoInesperado: Si no es JSON válido o no lleva fichas y plataformas con su forma.
    """
    documento = leer_json(requerir(FICHAS))
    _exigir_documento(documento)
    return documento


def _cumple(ficha: object, requisito: str) -> bool:
    """Indica si la ficha declara cumplido un requisito; una ficha o un requisito sin su forma no lo cumplen.

    Args:
        ficha: Una entrada de «fichas», de cualquier forma (el documento se redacta a mano).
        requisito: La clave del requisito (R1…R10).

    Returns:
        True solo si `ficha["requisitos"][requisito]["cumple"]` existe y es True.
    """
    requisitos = ficha.get("requisitos") if isinstance(ficha, dict) else None
    valor = requisitos.get(requisito) if isinstance(requisitos, dict) else None
    return isinstance(valor, dict) and valor.get("cumple") is True


def pasa(ficha: object) -> bool:
    """Indica si una ficha cumple los diez requisitos del criterio.

    Args:
        ficha: Una entrada de «fichas», de cualquier forma.

    Returns:
        True si declara cumplidos los diez requisitos; una ficha sin su forma no pasa.
    """
    return all(_cumple(ficha, requisito) for requisito in REQUISITOS)


def incumplidos(ficha: object) -> list[str]:
    """Lista los requisitos que una ficha no cumple.

    Args:
        ficha: Una entrada de «fichas», de cualquier forma.

    Returns:
        Las claves de los requisitos no cumplidos (o sin su forma), en el orden de REQUISITOS.
    """
    return [requisito for requisito in REQUISITOS if not _cumple(ficha, requisito)]


def enlace_limpio(enlace: str, anfitriones: Collection[str]) -> bool:
    """Indica si un enlace es una página https de una plataforma registrada, sin consulta ni fragmento.

    Así no lleva seguimiento ni afiliación.

    Args:
        enlace: El enlace de la ficha.
        anfitriones: Los nombres de anfitrión (host) de las plataformas registradas.

    Returns:
        True si el esquema es https, el host está registrado y no hay credenciales, puerto, consulta ni fragmento.
    """
    # urlsplit elimina ciertos espacios y controles: no reparar a escondidas una dirección redactada a mano.
    if any(caracter.isspace() or ord(caracter) < INICIO_ASCII_IMPRIMIBLE for caracter in enlace):
        return False
    try:
        partes = urlsplit(enlace)
        return (
            partes.scheme == "https"
            and partes.hostname in anfitriones
            and partes.username is None
            and partes.password is None
            and partes.port is None
            and not partes.query
            and not partes.fragment
        )
    except ValueError:
        # Una autoridad o un puerto inválidos son un enlace no limpio; su control conserva el fallo.
        return False


def _fecha(texto: str | None) -> date | None:
    """Convierte una fecha AAAA-MM-DD.

    Args:
        texto: La fecha, o None.

    Returns:
        La fecha, o None si `texto` es None o vacío.
    """
    return date.fromisoformat(texto) if texto else None


def _es_fecha_o_nada(valor: object) -> bool:
    """Indica si un valor es None o un texto AAAA-MM-DD que es una fecha real.

    Args:
        valor: El valor de un campo de fecha de la ficha.

    Returns:
        True si es None o una fecha ISO válida.
    """
    if valor is None:
        return True
    if not isinstance(valor, str) or FECHA.fullmatch(valor) is None:
        return False
    try:
        date.fromisoformat(valor)
    except ValueError:
        return False
    return True


def _es_numero(valor: object) -> bool:
    """Indica si un valor es un número de JSON (entero o decimal), no un booleano.

    Args:
        valor: El valor de un campo numérico.

    Returns:
        True si es int o float finito y no bool.
    """
    return (
        isinstance(valor, int | float)
        and not isinstance(valor, bool)
        and (not isinstance(valor, float) or isfinite(valor))
    )


def _certificado_correcto(certificado: object) -> bool:
    """Indica si el certificado de una ficha es None o tiene emisor, precio no negativo y créditos ECTS.

    Args:
        certificado: El campo «certificado» de la ficha.

    Returns:
        True si su forma es la admitida.
    """
    if certificado is None:
        return True
    return (
        isinstance(certificado, dict)
        and set(certificado) == {"emisor", "precio_eur", "ects"}
        and isinstance(certificado["emisor"], str)
        and _es_numero(certificado["precio_eur"])
        and certificado["precio_eur"] >= 0
        and (certificado["ects"] is None or _es_numero(certificado["ects"]))
    )


def _forma_correcta(ficha: object) -> bool:
    """Indica si una ficha tiene los campos exactos, con sus tipos y valores admitidos.

    Se comprueba antes de leer ningún campo: una ficha redactada con un error da un control fallido, no una traza.

    Args:
        ficha: Una entrada de «fichas», de cualquier forma.

    Returns:
        True si es un objeto con CAMPOS en su orden y cada valor tiene su tipo y está entre los admitidos.
    """
    if not isinstance(ficha, dict) or tuple(ficha) != CAMPOS:
        return False
    horas = ficha["horas"]
    return (
        isinstance(ficha["id"], str)
        and isinstance(ficha["titulo"], str)
        and isinstance(ficha["entidad"], str)
        and isinstance(ficha["enlace"], str)
        and (ficha["dirigido_a"] is None or isinstance(ficha["dirigido_a"], str))
        and (
            ficha["area_digcomp"] is None
            or (type(ficha["area_digcomp"]) is int and ficha["area_digcomp"] in AREAS_DIGCOMP)
        )
        and ficha["titular"] in TITULARES
        and ficha["tema"] in TEMAS
        and ficha["idioma"] in IDIOMAS
        and ficha["nivel"] in NIVELES
        and (horas is None or (_es_numero(horas) and horas > 0))
        and _certificado_correcto(ficha["certificado"])
        and isinstance(ficha["a_tu_ritmo"], bool)
        and isinstance(ficha["traduccion_automatica"], bool)
        and all(_es_fecha_o_nada(ficha[campo]) for campo in ("comprobado", "inicio", "fin"))
        and isinstance(ficha["requisitos"], dict)
    )


def _requisitos_con_evidencia(ficha: dict[str, Any]) -> bool:
    """Indica si cada requisito tiene su resultado, un enlace https que lo prueba y una nota.

    Args:
        ficha: Una ficha con forma correcta (`_forma_correcta`).

    Returns:
        True si están los diez requisitos, en orden, y cada uno es un objeto con «cumple» booleano y «evidencia» y
        «nota» de texto, la evidencia https y la nota no vacía.
    """
    requisitos = ficha["requisitos"]
    return tuple(requisitos) == REQUISITOS and all(
        isinstance(requisito, dict)
        and isinstance(requisito.get("cumple"), bool)
        and isinstance(requisito.get("evidencia"), str)
        and requisito["evidencia"].startswith("https://")
        and isinstance(requisito.get("nota"), str)
        and bool(requisito["nota"].strip())
        for requisito in requisitos.values()
    )


def _vigente(ficha: dict[str, Any], hoy: date) -> bool:
    """Indica si una ficha tiene fechas coherentes: comprobación no futura, ya iniciada y sin terminar al comprobarla.

    Args:
        ficha: Una ficha con forma correcta (`_forma_correcta`): sus fechas son None o AAAA-MM-DD.
        hoy: El día de la validación.

    Returns:
        True si la comprobación no es futura, el curso ya podía empezarse al comprobarlo y no había terminado. La
        antigüedad no cuenta: un recurso continuo puede llevar años publicado y seguir siendo válido, y la revisión
        pendiente solo se avisa. Solo lo excluye un fin publicado o un cierre comprobado.
    """
    comprobado, inicio, fin = (_fecha(ficha[campo]) for campo in ("comprobado", "inicio", "fin"))
    return (
        comprobado is not None
        and comprobado <= hoy
        and inicio is not None
        and inicio <= comprobado
        and (fin is None or fin >= comprobado)
    )


def _terminada(ficha: dict[str, Any], hoy: date) -> bool:
    """Indica si el curso ha llegado a su fin publicado el día de la validación.

    Args:
        ficha: Una ficha con forma correcta (`_forma_correcta`).
        hoy: El día de la validación.

    Returns:
        True si publica un fin anterior a `hoy`; sin fin publicado, nunca termina por el paso del tiempo.
    """
    fin = _fecha(ficha["fin"])
    return fin is not None and fin < hoy


def _textos(valores: object) -> list[str]:
    """Reúne los textos de un objeto de JSON (sus valores de tipo texto).

    Args:
        valores: Un objeto de JSON, o cualquier otro valor.

    Returns:
        Los valores de texto si es un objeto; vacía si no lo es.
    """
    return [valor for valor in valores.values() if isinstance(valor, str)] if isinstance(valores, dict) else []


def _sin_la_palabra_oficial(documento: dict[str, Any]) -> bool:
    """Indica si ninguna nota de Faro llama «oficial» o «acreditado» a lo que no lo es.

    Args:
        documento: El documento de fichas, con «fichas» (lista) y «plataformas» (objeto).

    Returns:
        True si ninguna nota de requisito ni texto de plataforma contiene esas palabras.
    """
    requisitos = [
        requisito
        for ficha in documento["fichas"]
        if isinstance(ficha, dict) and isinstance(ficha.get("requisitos"), dict)
        for requisito in ficha["requisitos"].values()
    ]
    notas = [requisito["nota"] for requisito in requisitos if isinstance(requisito, dict) and "nota" in requisito]
    notas = [nota for nota in notas if isinstance(nota, str)]
    notas += [texto for plataforma in documento["plataformas"].values() for texto in _textos(plataforma)]
    return not any(palabra in nota.lower() for nota in notas for palabra in ("oficial", "acreditad"))


def _admitidas(documento: dict[str, Any], hoy: date | None = None) -> list[dict[str, Any]]:
    """Selecciona las fichas con forma correcta que cumplen los diez requisitos y no han terminado.

    Args:
        documento: El documento de fichas, con «fichas» (lista).
        hoy: El día de la validación; con él se excluyen las fichas que han llegado a su fin publicado.

    Returns:
        Las fichas admitidas, en el orden del documento.
    """
    return [
        ficha
        for ficha in documento["fichas"]
        if _forma_correcta(ficha) and pasa(ficha) and (hoy is None or not _terminada(ficha, hoy))
    ]


def revision_pendiente(documento: dict[str, Any], hoy: date) -> date | None:
    """Calcula el primer día en que alguna ficha admitida lleva más de DIAS_DE_REVISION días sin revisar.

    Solo alimenta avisos (el de `validar` y el del panel): no retira fichas ni cambia lo que se muestra. Cuenta las
    mismas fichas que se publican `hoy`: una que ha llegado a su fin publicado ya no tiene nada que revisar.

    Args:
        documento: El documento de fichas.
        hoy: El día de la observación.

    Returns:
        Ese día; None si ninguna ficha admitida y sin terminar tiene fecha de comprobación.
    """
    comprobadas = [_fecha(ficha["comprobado"]) for ficha in _admitidas(documento, hoy)]
    primera = min((dia for dia in comprobadas if dia is not None), default=None)
    return None if primera is None else primera + timedelta(days=DIAS_DE_REVISION + 1)


def aviso_de_revision(documento: dict[str, Any], hoy: date) -> str | None:
    """Redacta el aviso de revisión pendiente, desde MARGEN_DE_AVISO días antes.

    Args:
        documento: El documento de fichas.
        hoy: El día de la validación.

    Returns:
        El aviso; None si aún queda margen o no hay ninguna ficha admitida y sin terminar con fecha de comprobación.
    """
    pendiente = revision_pendiente(documento, hoy)
    if pendiente is None:
        return None
    faltan = (pendiente - hoy).days
    fecha = pendiente.strftime("%d/%m/%Y")
    if faltan <= 0:
        return (
            f"La revisión de las fichas de formación abierta está pendiente desde el {fecha}: revisarlas. "
            "Siguen mostrándose con su fecha de comprobación."
        )
    if faltan <= MARGEN_DE_AVISO:
        return f"La revisión de las fichas de formación abierta vence el {fecha} (faltan {faltan} días): revisarlas."
    return None


def dia_de_la_validacion(entorno: Mapping[str, str]) -> date:
    """Elige el día con que se valida: VARIABLE_DEL_DIA (AAAA-MM-DD) para reproducir una versión, o hoy en UTC.

    Args:
        entorno: Las variables de entorno.

    Returns:
        El día de VARIABLE_DEL_DIA si está definida; si no, hoy en UTC.

    Raises:
        FormatoInesperado: Si VARIABLE_DEL_DIA está definida y no es una fecha real AAAA-MM-DD.
    """
    valor = entorno.get(VARIABLE_DEL_DIA)
    if valor is None:
        return hoy_utc()
    exigir(_es_fecha_o_nada(valor), f"{VARIABLE_DEL_DIA} tiene que ser una fecha real AAAA-MM-DD")
    return date.fromisoformat(valor)


def controles_de_las_fichas(documento: dict[str, Any], hoy: date) -> Controles:
    """Aplica los controles del documento de fichas el día `hoy`.

    La forma de cada ficha se comprueba antes de leerla: los demás controles solo miran las fichas con forma correcta,
    y una ficha mal redactada deja fallido el control de forma en lugar de detener la validación.

    Args:
        documento: El documento de fichas.
        hoy: El día de la validación.

    Returns:
        Los controles, cumplidos o no.

    Raises:
        FormatoInesperado: Si el documento no tiene «fichas» (lista) ni «plataformas» (objeto).
    """
    _exigir_documento(documento)
    controles = Controles()
    fichas = documento["fichas"]
    bien_formadas = [ficha for ficha in fichas if _forma_correcta(ficha)]
    anfitriones = set(documento["plataformas"])
    controles.comprobar(documento.get("criterio") == CRITERIO, f"las fichas se aplican con el criterio {CRITERIO}")
    identificadores = {ficha["id"] for ficha in bien_formadas}
    controles.comprobar(len(identificadores) == len(fichas), "ningún identificador repetido")
    controles.comprobar(len(bien_formadas) == len(fichas), "cada ficha tiene solo sus campos y valores admitidos")
    controles.comprobar(
        all(_requisitos_con_evidencia(ficha) for ficha in bien_formadas), "cada requisito, con resultado y evidencia"
    )
    controles.comprobar(
        all(enlace_limpio(ficha["enlace"], anfitriones) for ficha in bien_formadas),
        "enlaces https limpios y registrados",
    )
    controles.comprobar(_sin_la_palabra_oficial(documento), "ninguna nota llama oficial o acreditado a un curso")
    admitidas = _admitidas(documento, hoy)
    controles.comprobar(bool(admitidas), "al menos una ficha cumple los diez requisitos")
    controles.comprobar(
        all(_vigente(ficha, hoy) for ficha in admitidas),
        "cada ficha admitida, con comprobación no futura, ya iniciada y sin terminar al comprobarla",
    )
    return controles


def conjunto(documento: dict[str, Any], hoy: date | None = None) -> dict[str, Any]:
    """Construye lo que exporta el paquete: las fichas que pasan, sin sus requisitos, con la cita y la revisión.

    Args:
        documento: El documento de fichas, ya admitido (al menos una ficha pasa).
        hoy: El día de la validación; excluye las fichas que han llegado a su fin publicado.

    Returns:
        La cita, el criterio, la fecha de la revisión más reciente y las fichas admitidas sin «requisitos».
    """
    admitidas = _admitidas(documento, hoy)
    return {
        "fuente": CITA,
        "criterio": CRITERIO,
        "revision": max(ficha["comprobado"] for ficha in admitidas),
        "fichas": [{campo: valor for campo, valor in ficha.items() if campo != "requisitos"} for ficha in admitidas],
    }


def descargar() -> None:
    """Las fichas no se descargan: se redactan a mano tras abrir cada página. Comprueba que existen."""
    print(f"{FUENTE}: las fichas no se leen con código; Equipo Faro las redacta a mano en {relativa(FICHAS)}.")
    print("Las condiciones de cada plataforma, su robots.txt y la fecha en que se consultaron van en «plataformas».")
    requerir(FICHAS)


def preparar() -> None:
    """Registra la procedencia de las fichas: su huella, cuántas son y cuándo se comprobaron."""
    documento = leer_fichas()
    exigir(
        bool(documento["fichas"])
        and all(_forma_correcta(ficha) and isinstance(ficha["comprobado"], str) for ficha in documento["fichas"]),
        "fichas.json requiere al menos una ficha, todas con su forma y fecha de comprobación AAAA-MM-DD",
    )
    comprobadas = sorted({ficha["comprobado"] for ficha in documento["fichas"]})
    procedencia = {
        "fuente": "Faro · formación abierta: fichas redactadas a mano con el criterio «Formación abierta»",
        "nivel": "selección de Faro",
        "licencia": LICENCIA,
        "cita": CITA,
        "archivos": [
            {
                "archivo": FICHAS.name,
                "origen": "Redacción manual tras abrir la página pública de cada curso, sin lectura automática.",
                "registros": len(documento["fichas"]),
                "comprobadas": comprobadas,
                "sha256": sha256(FICHAS),
            }
        ],
    }
    guardar_json_fechado(PROCEDENCIA, procedencia, campos_fecha=())
    print(f"{len(documento['fichas'])} fichas comprobadas entre el {comprobadas[0]} y el {comprobadas[-1]}")


def validar(hoy: date | None = None) -> None:
    """Comprueba las fichas con el criterio y guarda la validación y, si se admite, el conjunto del paquete."""
    procedencia = leer_json(requerir(PROCEDENCIA))
    exigir(procedencia["archivos"][0]["sha256"] == sha256(FICHAS), "las fichas han cambiado: ejecutar preparar")
    documento = leer_fichas()
    dia = hoy or dia_de_la_validacion(os.environ)
    aviso = aviso_de_revision(documento, dia)
    if aviso:
        print(aviso, file=sys.stderr)
    controles = controles_de_las_fichas(documento, dia)
    fichas = documento["fichas"]
    informe = {
        "estado": "Admitido" if controles.admitido else "Con errores",
        "comprobado_utc": ahora_utc(),
        "criterio": CRITERIO,
        "cobertura": {
            "fichas": len(fichas),
            "pasan": [ficha["id"] for ficha in _admitidas(documento, dia)],
            "terminadas": [ficha["id"] for ficha in _admitidas(documento) if _terminada(ficha, dia)],
            "no_pasan": [
                {"id": ficha.get("id") if isinstance(ficha, dict) else None, "incumple": incumplidos(ficha)}
                for ficha in fichas
                if not (_forma_correcta(ficha) and pasa(ficha))
            ],
        },
        "limites": "Fichas de nivel 3 de licencia: hechos y enlace, redactados a mano; la revisión es mensual y, a los "
        f"{DIAS_DE_REVISION} días sin revisar, solo se avisa: la ficha sigue mostrándose con su fecha de comprobación "
        "hasta su fin publicado. Faro no comprueba plazas ni inscripciones.",
        "controles": controles.lista,
    }
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto(documento, dia))


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        El código de salida de la orden.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
