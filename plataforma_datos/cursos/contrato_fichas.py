"""Semántica mínima de ediciones; no determina acceso personal ni niveles Faro.

Las funciones son puras: conservan las publicaciones recibidas y nunca leen la
red, el reloj ni archivos. Una fecha local sin zona permanece local. Los estados
publicados, las condiciones de acceso y los costes son dimensiones separadas.
La prosa solo se traduce si coincide con una declaración completa ya revisada;
otra redacción permanece desconocida y se diagnostica. No es un intérprete
general de negaciones, condiciones, precios o requisitos de acceso.
"""

import math
import re
import unicodedata
from collections.abc import Iterable
from copy import deepcopy
from datetime import date, datetime
from typing import TypedDict

from plataforma_datos.cursos.normalizar_destinatarios import ErrorDestinatario, normalizar_destinatario, sha256_json
from plataforma_datos.cursos.tipos_json import ObjetoJson, ValorJson

NUMERO_EXTREMOS = 2


class FechaNormalizada(TypedDict):
    """Valor, precisión y zona de una fecha publicada, incluidos desconocidos."""

    valor: str | None
    precision: str | None
    zona: str | None


class Diagnostico(TypedDict):
    """Campo que no se interpreta y la razón conservada para su revisión."""

    campo: str
    motivo: str


type Periodo = dict[str, str | None]
type DetalleFecha = dict[str, str | None]

MODALIDADES = {"en-linea", "presencial", "mixta"}
SINCRONIAS = {"asincrona", "sincrona", "mixta"}
ESTADOS_INSCRIPCION = {
    "disponible-publicamente",
    "apertura-futura",
    "cerrada",
    "sin-plazas",
    "senal-publica-sin-confirmar",
}
ESTADOS_EDICION = {"vigente", "futura", "archivada", "finalizada"}
COSTES = {
    "gratis_formacion",
    "gratis_parcial",
    "gratis_parcial_temporal",
    "contenido_gratuito_practicas_por_confirmar",
    "de_pago",
}
ACCESOS_TERRITORIALES = {
    "sin-restriccion-residencia-en-norma-general",
    "sin-restriccion-territorial-declarada",
    "restriccion-territorial-publicada",
}
CAMPOS_ORIGINALES = (
    "modalidad",
    "sincronia",
    "horas",
    "duracion",
    "duracion_horas",
    "horas_totales",
    "semanas",
    "tiempo_realizacion",
    "fechas_edicion",
    "fechas_aula",
    "fechas_sesiones",
    "vinculos_calendarios",
    "fechas",
    "inicio",
    "fin",
    "fechas_matricula",
    "plazo_matricula",
    "inicio_matricula",
    "fin_matricula",
    "fecha_limite_matricula",
    "coste_formacion",
    "limite_gratuidad",
    "coste_certificado",
    "coste_certificado_insignia",
    "coste_materiales",
    "licencias",
    "licencias_materiales",
    "inscripcion",
    "estado",
    "gestion_matricula",
    "territorio",
    "alcance",
    "acceso_espana",
    "colectivo",
    "edad_colectivo",
    "edad",
    "empleo",
    "como_acceder",
    "acceso",
    "alta",
    "reconocimiento",
    "certificado",
    "limite_fechas",
    "limite_requisitos",
)


class ErrorFicha(ValueError):
    """La ficha normalizada incumple la semántica mínima acordada."""


def _norm(texto: ValorJson) -> str:
    """Prepara una clave de comparación sin modificar la publicación conservada.

    Returns:
        Texto sin acentos y en minúsculas para comparar declaraciones.
    """
    return "".join(c for c in unicodedata.normalize("NFD", str(texto or "").casefold()) if not unicodedata.combining(c))


def _diagnostico(campo: str, motivo: str) -> Diagnostico:
    """Identifica el campo y motivo de una interpretación pendiente.

    Returns:
        Campo y motivo conservados para revisar la interpretación.
    """
    return {"campo": campo, "motivo": motivo}


def _normalizar_dia(texto: str) -> FechaNormalizada:
    try:
        date.fromisoformat(texto)
    except ValueError:
        return {"valor": None, "precision": None, "zona": None}
    return {"valor": texto, "precision": "dia", "zona": None}


def normalizar_fecha(publicada: ValorJson) -> FechaNormalizada:
    """Devuelve valor ISO, precisión y zona; no añade horas ni zonas ausentes.

    Returns:
        Fecha publicada con su precisión y zona, o tres valores desconocidos.
    """
    vacia = {"valor": None, "precision": None, "zona": None}
    if publicada is None or publicada == "":
        return vacia
    if not isinstance(publicada, str):
        return vacia
    texto = publicada.strip()
    texto = re.sub(r"\s*\(zona no especificada\)$", "", texto, flags=re.IGNORECASE)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", texto):
        return _normalizar_dia(texto)
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?",
        texto,
    ):
        return vacia
    try:
        fecha = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        return vacia
    zona = re.search(r"(Z|[+-]\d{2}:\d{2})$", texto)
    tiempo = texto[11:]
    precision = (
        "fraccion-segundo" if "." in tiempo else "segundo" if re.match(r"\d{2}:\d{2}:\d{2}", tiempo) else "minuto"
    )
    # isoformat valida la fecha, pero la publicación conserva sus ceros/precisión.
    return {
        "valor": texto.replace(" ", "T", 1),
        "precision": precision,
        "zona": ("UTC" if fecha.utcoffset().total_seconds() == 0 else zona.group(1)) if zona else None,
    }


def _extremos_publicados(publicado: ValorJson) -> tuple[ObjetoJson, list[Diagnostico]]:
    problemas = []
    extremos = {"inicio": None, "fin": None}
    if publicado is None:
        pass
    elif isinstance(publicado, list) and len(publicado) == NUMERO_EXTREMOS:
        extremos = dict(zip(("inicio", "fin"), publicado, strict=False))
    elif isinstance(publicado, dict) and set(publicado) <= {
        "inicio",
        "fin",
        "desde",
        "hasta",
    }:
        for canonico, alias in (("inicio", "desde"), ("fin", "hasta")):
            valores = [publicado[k] for k in (canonico, alias) if k in publicado and publicado[k] is not None]
            if len(valores) == NUMERO_EXTREMOS and valores[0] != valores[1]:
                problemas.append(_diagnostico(canonico, "Extremos publicados incompatibles; no se elige uno."))
            else:
                extremos[canonico] = valores[0] if valores else None
    else:
        problemas.append(_diagnostico("periodo", "Forma publicada no reconocida; se conserva sin interpretar."))
    return extremos, problemas


def normalizar_periodo(
    publicado: ValorJson, *, tipo: str | None = None
) -> tuple[Periodo, dict[str, DetalleFecha], list[Diagnostico]]:
    """Acepta listas de dos extremos o mapas inicio/fin y desde/hasta conocidos.

    Returns:
        Extremos, metadatos de precisión y diagnósticos en el orden observado.
    """
    extremos, problemas = _extremos_publicados(publicado)
    detalles = {campo: normalizar_fecha(valor) for campo, valor in extremos.items()}
    for campo, valor in extremos.items():
        if valor is not None and detalles[campo]["valor"] is None:
            problemas.append(_diagnostico(campo, "Fecha publicada no interpretable sin suposiciones."))
        elif detalles[campo]["valor"] and detalles[campo]["precision"] != "dia" and detalles[campo]["zona"] is None:
            problemas.append(
                _diagnostico(
                    campo,
                    "Hora local publicada sin zona; no representa un instante UTC.",
                )
            )
    inicio, fin = (detalles[campo]["valor"] for campo in ("inicio", "fin"))
    if inicio and fin:
        primero, ultimo = (datetime.fromisoformat(v.replace("Z", "+00:00")) for v in (inicio, fin))
        comparables = (primero.utcoffset() is None) == (ultimo.utcoffset() is None)
        misma_precision = detalles["inicio"]["precision"] == detalles["fin"]["precision"] or all(
            "T" in v for v in (inicio, fin)
        )
        invertido = False
        if comparables:
            if primero.utcoffset() is not None or misma_precision:
                # Dos offsets explícitos se comparan como instantes, sin date().
                invertido = ultimo < primero
            else:
                # Día local frente a hora local: no fijar un límite a medianoche.
                invertido = ultimo.date() < primero.date()
        if invertido:
            problemas.append(
                _diagnostico(
                    "periodo",
                    "Fechas publicadas invertidas; se conserva el original y se dejan extremos desconocidos.",
                )
            )
            detalles = {campo: normalizar_fecha(None) for campo in extremos}
        elif not comparables:
            problemas.append(_diagnostico("periodo", "Zonas no comparables; no se inventa un orden temporal."))
    periodo = {campo: detalles[campo]["valor"] for campo in extremos}
    if tipo is not None:
        periodo = {"tipo": tipo, **periodo}
    metadatos = {campo: {k: v for k, v in detalle.items() if k != "valor"} for campo, detalle in detalles.items()}
    return periodo, metadatos, problemas


def _declaracion(valor: ValorJson) -> str | None:
    """Solo facilita comparar texto completo, sin reescribir lo publicado.

    Returns:
        Declaración normalizada, o None si está negada o no confirmada.
    """
    return " ".join(_norm(valor).split()).rstrip(".") if isinstance(valor, str) else None


# Declaraciones completas revisadas en los informes acotados y valores literales.
# Un texto nuevo no se incorpora por contener una palabra coincidente.
_DECLARACIONES_MODALIDAD = {
    "online": ("en-linea", None),
    "en-linea": ("en-linea", None),
    "completamente online": ("en-linea", None),
    "presencial": ("presencial", None),
    "mixta": ("mixta", None),
    "semipresencial": ("mixta", None),
    "hibrida": ("mixta", None),
    "online y presencial": ("mixta", None),
    "online asincrono": ("en-linea", "asincrona"),
    "a distancia; asincrona con tutoria": ("en-linea", "asincrona"),
    "formacion online a ritmo propio": ("en-linea", "asincrona"),
    "online; no se explicita sincronia": ("en-linea", None),
    "100% online, flexible; no requiere examen presencial": ("en-linea", None),
    "100% online, flexible; no requiere examen presencial segun convocatoria": (
        "en-linea",
        None,
    ),
    "100% online, abierta 24 horas; autoaprendizaje con tutores": ("en-linea", None),
    "100% online, abierta 24 horas; modulos semanales, autoaprendizaje con tutores": (
        "en-linea",
        None,
    ),
    "100% online, abierta 24 horas; modulos semanales con tutorizacion y autoevaluaciones": (
        "en-linea",
        None,
    ),
    (
        "completamente online, acceso 24 horas (faq iedra); aprendizaje asincrono "
        "con autoevaluaciones y apoyo tutorial hasta 15/01/2027; no se anuncian "
        "sesiones sincronas obligatorias"
    ): (
        "en-linea",
        "asincrona",
    ),
    "online, acceso 24 horas segun faq; autoevaluacion test. sin sincronia obligatoria anunciada": (
        "en-linea",
        None,
    ),
    "completamente online; self_paced": ("en-linea", "asincrona"),
    "completamente online, self_paced (a tu ritmo, asincrono)": (
        "en-linea",
        "asincrona",
    ),
    "online, autoformacion asincrona; lectura publica comprobada sin iniciar sesion": (
        "en-linea",
        "asincrona",
    ),
    "online autoformativo; asincrono": ("en-linea", "asincrona"),
    "online; no se explicita en ficha consultada sincronia/tutorizacion": (
        "en-linea",
        None,
    ),
    "online; sincronia/tutoria no explicitada": ("en-linea", None),
    (
        "a distancia; asincrona con tutoria, ejercicios corregidos, foros y "
        "videotutorias. no constan sesiones presenciales obligatorias para esta modalidad"
    ): (
        "en-linea",
        "asincrona",
    ),
    (
        "formacion online e-learning; a ritmo propio con plazo maximo tras "
        "matricula; tutoria depende del curso, no confirmada en estas fichas"
    ): (
        "en-linea",
        "asincrona",
    ),
}
_DECLARACIONES_SINCRONIA = {
    "asincrona": "asincrona",
    "asincrono": "asincrona",
    "sincrona": "sincrona",
    "sincrono": "sincrona",
    "sincrona con horario": "sincrona",
    "en directo": "sincrona",
    "sincronia mixta": "mixta",
    "asincrona y sincrona": "mixta",
    "mixta": "mixta",
    "asincrona con calendario de apertura de modulos; no se anuncian sesiones sincronas obligatorias": "asincrona",
}
_SINCRONIA_CONDICIONAL = {
    "asincrona cuando pacingtype=self_paced",
    "asincrona cuando pacingtype=self_paced; no se verificaron actividades tras acceso autenticado",
}


def normalizar_modalidad(
    modalidad: ValorJson, sincronia: ValorJson = None, *, pacing_type: ValorJson = None
) -> tuple[str | None, str | None, list[Diagnostico]]:
    """Solo declaraciones completas revisadas o pacingType explícito; no prosa libre.

    Returns:
        Modalidad, sincronía y diagnósticos de las señales publicadas.
    """
    problemas = []
    conocida = _DECLARACIONES_MODALIDAD.get(_declaracion(modalidad))
    modalidad_normalizada, sincronizacion_modalidad = conocida or (None, None)
    if modalidad not in (None, "") and conocida is None:
        problemas.append(
            _diagnostico(
                "modalidad",
                "Declaración de modalidad no reconocida o no confirmada; no se infiere de palabras sueltas.",
            )
        )
    declaraciones = [sincronizacion_modalidad] if sincronizacion_modalidad else []
    literal = _declaracion(sincronia)
    declarada = _DECLARACIONES_SINCRONIA.get(literal)
    incierta = False
    if declarada:
        declaraciones.append(declarada)
    elif sincronia not in (None, ""):
        if literal in _SINCRONIA_CONDICIONAL and pacing_type == "self_paced":
            declaraciones.append("asincrona")
        else:
            incierta = True
            problemas.append(
                _diagnostico(
                    "sincronia",
                    "Declaración desconocida, negada, condicional o no confirmada; se conserva sin afirmar sincronía.",
                )
            )
    if pacing_type == "self_paced":
        declaraciones.append("asincrona")
    valores = set(declaraciones)
    if len(valores) > 1:
        problemas.append(
            _diagnostico(
                "sincronia",
                "Declaraciones de sincronía incompatibles; no se elige una.",
            )
        )
    normalizada = next(iter(valores)) if len(valores) == 1 and not incierta else None
    return modalidad_normalizada, normalizada, problemas


def normalizar_horas(fuente: ObjetoJson) -> tuple[int | float | None, str | None, list[Diagnostico]]:
    """No suma estimaciones semanales, meses, créditos o duraciones de unidades.

    Returns:
        Total explícito, método de lectura y diagnósticos; nunca una estimación.
    """
    candidatos = []
    problemas = []
    for campo in ("horas", "duracion_horas", "horas_totales", "duracion"):
        valor = fuente.get(campo)
        numero = None
        origen = campo
        if type(valor) in (int, float) and campo != "duracion" and math.isfinite(valor) and valor >= 0:
            numero = valor
        elif isinstance(valor, str):
            m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(horas?|h)\s*", valor, flags=re.IGNORECASE)
            if m:
                numero = float(m.group(1).replace(",", "."))
        elif isinstance(valor, dict) and campo == "horas":
            catalogo = valor.get("catalogo_upvx_horas")
            if type(catalogo) in (int, float) and math.isfinite(catalogo) and catalogo >= 0:
                numero = catalogo
                origen = "horas.catalogo_upvx_horas"
        if numero is not None:
            candidatos.append((origen, numero))
        elif valor is not None:
            problemas.append(
                _diagnostico(
                    campo,
                    "No se publica un total numérico inequívoco en horas; se conserva el valor original.",
                )
            )
    if len({numero for _, numero in candidatos}) > 1:
        problemas.append(_diagnostico("horas_publicadas", "Totales publicados discrepantes; no se elige uno."))
        return None, None, problemas
    return (candidatos[0][1], "publicado:" + candidatos[0][0], problemas) if candidatos else (None, None, problemas)


_COSTES_PUBLICADOS = {
    "0 €": "gratis_formacion",
    "0 € como oyente": "gratis_formacion",
    "0 € oyente": "gratis_formacion",
    "0 € segun faq": "gratis_formacion",
    "0 € segun inicio y faq": "gratis_formacion",
    "0 € segun portal abiertaugr": "gratis_formacion",
    "0 €: convocatoria especial gratuita": "gratis_formacion",
    "0 €: saps declara toda formacion online gratuita": "gratis_formacion",
    "gratuito": "gratis_formacion",
    "gratuita": "gratis_formacion",
    "formacion gratuita": "gratis_formacion",
    "0 € para contenido/aprendizaje": "contenido_gratuito_practicas_por_confirmar",
    "0 € para contenido/aprendizaje, confirmado por faq microsoft learn": "contenido_gratuito_practicas_por_confirmar",
    "audit 0 usd, contenido seleccionado": "gratis_parcial",
    (
        "audit 0 usd, acceso temporal a contenido seleccionado; evaluaciones "
        "calificadas y caracteristicas adicionales exigen modalidad verificada. no "
        "afirmar curso completo gratuito"
    ): ("gratis_parcial_temporal"),
}
_LIMITES_AUDIT_TEMPORAL = {
    "acceso temporal",
    "acceso temporal a contenido seleccionado",
    (
        "audit ofrece contenido seleccionado y acceso temporal; evaluacion "
        "calificada/certificado no incluidos. no equivale a formacion completa gratuita"
    ),
}


def normalizar_coste(publicado: ValorJson, limite: ValorJson = None) -> str | None:
    """No interpretar prosa libre ni deducir gratuidad completa de una parte.

    Returns:
        Clase sustentada por la declaración, o None si es ambigua.
    """
    limite_literal = _declaracion(limite)
    if limite not in (None, "") and limite_literal not in _LIMITES_AUDIT_TEMPORAL:
        return None
    temporal = limite_literal in _LIMITES_AUDIT_TEMPORAL
    if isinstance(publicado, list):
        audit = any(
            isinstance(p, dict)
            and p.get("type") == "audit"
            and type(p.get("price")) in (int, float)
            and p["price"] == 0
            for p in publicado
        )
        return ("gratis_parcial_temporal" if temporal else "gratis_parcial") if audit else None
    if type(publicado) in (int, float) and math.isfinite(publicado):
        if publicado == 0:
            return "gratis_parcial_temporal" if temporal else "gratis_formacion"
        return "de_pago" if publicado > 0 and not temporal else None
    resultado = _COSTES_PUBLICADOS.get(_declaracion(publicado))
    if temporal and resultado is not None:
        return "gratis_parcial_temporal"
    return resultado


# Declaraciones completas revisadas de la investigación histórica. No son patrones de palabras ni reglas de acceso.
_DECLARACIONES_INSCRIPCION = {
    _declaracion(literal): estado
    for estado, literales in (
        (
            "disponible-publicamente",
            (
                "Botón INSCRIBIRSE y matrícula vigente hasta 31/12/2026 en ficha al 22/10/2026. "
                "Registro SAPS obligatorio; no se verificó admisión efectiva.",
            ),
        ),
        (
            "cerrada",
            (
                "Inscripciones cerradas",
                "Matrícula cerrada",
                "No inscribible",
                "Próximamente. NO inscribible a fecha de verificación.",
            ),
        ),
        (
            "senal-publica-sin-confirmar",
            (
                "Botón Inscribirme visible; matrícula efectiva no realizada.",
                "Vigente, ficha pública con Enroll in this course; oferta 15/09/2026–15/01/2027. "
                "Matrícula autenticada no ejecutada.",
                "Vigente, Enroll público; público objetivo restringido.",
                "Listado público indica plazas e Inscribirme al 22/10/2026; disponibilidad orientativa del instante, "
                "no reserva ni garantía de plaza",
                "Botón Inscribirme visible al 22/10/2026; matrícula efectiva no realizada. "
                "FAQ admite máximo 3 cursos simultáneos.",
            ),
        ),
    )
    for literal in literales
}
# Una afirmación completa con fecha, nunca una subcadena dentro de una negación o de otra condición.
_MATRICULA_VIGENTE = re.compile(r"matricula vigente hasta (?:el )?(\d{1,2})/(\d{1,2})(?:/(\d{4}))?")
# Solo comprueba si día/mes sin año son posibles: no atribuye este año a la fuente ni produce una fecha.
_ANIO_BISIESTO_DE_COMPROBACION = 2000


def _inscripcion_publicada(literal: str | None) -> str | None:
    if literal in _DECLARACIONES_INSCRIPCION:
        return _DECLARACIONES_INSCRIPCION[literal]
    fecha = _MATRICULA_VIGENTE.fullmatch(literal or "")
    if fecha is None:
        return None
    dia, mes, anio = fecha.groups()
    try:
        date(int(anio) if anio else _ANIO_BISIESTO_DE_COMPROBACION, int(mes), int(dia))
    except ValueError:
        return None
    return "disponible-publicamente"


def _inscripcion_de_la_edicion(fuente: ObjetoJson, run: ObjetoJson) -> str | None:
    # El run identificado tiene un alcance distinto de las condiciones generales del programa.
    if type(run.get("isEnrollable")) is bool:
        return "disponible-publicamente" if run["isEnrollable"] else "cerrada"
    literal = _declaracion(fuente.get("inscripcion"))
    inscripcion = _inscripcion_publicada(literal)
    if literal and inscripcion is None:
        return None
    estado = _declaracion(fuente.get("estado"))
    declarada = "disponible-publicamente" if estado == "actual_matricula_abierta" else _inscripcion_publicada(estado)
    if inscripcion is not None and declarada is not None and inscripcion != declarada:
        return None
    return inscripcion or declarada


def normalizar_estados(fuente: ObjetoJson, run: ObjetoJson) -> tuple[str | None, str | None]:
    """Conserva el estado de edición y exige una declaración completa de inscripción.

    Returns:
        Estado de edición e inscripción, sin confirmar plaza personal.
    """
    estado = _norm(fuente.get("estado"))
    edicion = {"Current": "vigente", "Upcoming": "futura", "Archived": "archivada"}.get(run.get("availability"))
    if edicion is None:
        if estado in ("actual", "actual_matricula_abierta") or estado.startswith("vigente"):
            edicion = "vigente"
        elif estado == "archivado":
            edicion = "archivada"
        elif estado in ("futuro", "futura") or estado.startswith("proximamente"):
            edicion = "futura"
    return edicion, _inscripcion_de_la_edicion(fuente, run)


_TERRITORIOS_PUBLICADOS = {
    ("nacional y sin restriccion de nacionalidad/residencia segun art.3 del reglamento"): (
        "sin-restriccion-residencia-en-norma-general"
    ),
    ("nacional y sin restriccion de residencia segun art.3 del reglamento"): (
        "sin-restriccion-residencia-en-norma-general"
    ),
    "exclusivamente residencia o lugar de trabajo en region de murcia": "restriccion-territorial-publicada",
    (
        "exclusivamente residencia o lugar de trabajo en region de murcia, segun "
        "faq oficial publica dinamica. no oferta nacional sin restricciones"
    ): ("restriccion-territorial-publicada"),
    ("faq: cursos abiertos a ciudadanos de castilla y leon; excluir de acceso nacional sin restricciones"): (
        "restriccion-territorial-publicada"
    ),
    "upvx declara acceso desde cualquier lugar; no limite por ccaa observado": "sin-restriccion-territorial-declarada",
    ("upvx declara acceso desde cualquier lugar y para cualquiera con internet; no limitacion por ccaa"): (
        "sin-restriccion-territorial-declarada"
    ),
    (
        "portal declara abierta a toda ciudadania, acceso desde cualquier lugar y "
        "sin restricciones. no exige residencia valenciana en fichas consultadas; "
        "acceso nacional razonablemente sustentado, registro no completado"
    ): ("sin-restriccion-territorial-declarada"),
}


def normalizar_territorio(publicado: ValorJson) -> str | None:
    """Solo afirmaciones territoriales completas revisadas; nunca otras restricciones.

    Returns:
        Alcance publicado interpretable, o None sin evidencia suficiente.
    """
    return _TERRITORIOS_PUBLICADOS.get(_declaracion(publicado))


def _primero(fuente: ObjetoJson, campos: Iterable[str]) -> ValorJson:
    """Elige el primer alias publicado no nulo, respetando el orden del contrato.

    Returns:
        Primer campo presente, incluido su valor None explícito.
    """
    return next((fuente[c] for c in campos if c in fuente and fuente[c] is not None), None)


def _matricula_edicion(
    fuente: ObjetoJson, run: ObjetoJson
) -> tuple[Periodo, dict[str, DetalleFecha], list[Diagnostico]]:
    problemas = []
    matricula_original = _primero(fuente, ("fechas_matricula", "plazo_matricula"))
    if matricula_original is None:
        matricula_original = {
            "inicio": fuente.get("inicio_matricula"),
            "fin": fuente.get("fin_matricula"),
        }
    if run:
        generales = normalizar_periodo(matricula_original)[0]
        propias = {
            "inicio": run.get("enrollmentStart"),
            "fin": run.get("enrollmentEnd"),
        }
        if any(
            generales[c] is not None and propias[c] is not None and generales[c] != propias[c]
            for c in ("inicio", "fin")
        ):
            problemas.append(
                _diagnostico(
                    "fechas_matricula",
                    (
                        "La matrícula general difiere de esta edición; se conserva el dato de "
                        "edición identificado y ambas publicaciones originales."
                    ),
                )
            )
        matricula_original = {
            "inicio": run.get("enrollmentStart"),
            "fin": run.get("enrollmentEnd"),
        }
    matricula, detalles_matricula, diagnosticos = normalizar_periodo(matricula_original)
    problemas.extend({**d, "campo": "fechas_matricula." + d["campo"]} for d in diagnosticos)
    return matricula, detalles_matricula, problemas


TIPOS_CALENDARIOS = {
    "fechas_edicion": "periodo-formativo",
    "fechas_aula": "ventana-acceso",
    "fechas_sesiones": "sesiones",
}


def _campo_calendario(fuente: ObjetoJson) -> str:
    return next((c for c in (*TIPOS_CALENDARIOS, "fechas") if fuente.get(c) is not None), "inicio/fin")


def _alcance_calendario(publicado: ValorJson) -> str:
    if not isinstance(publicado, dict) or "alcance" not in publicado:
        return "edicion"
    return publicado["alcance"] if publicado["alcance"] in ("edicion", "material-auxiliar") else "desconocido"


def _extremos_calendario(publicado: ValorJson) -> ValorJson:
    return {k: v for k, v in publicado.items() if k != "alcance"} if isinstance(publicado, dict) else publicado


def _vinculo_calendario(publicacion: ObjetoJson, campo: str) -> ObjetoJson | None:
    vinculos = publicacion.get("vinculos_calendarios", {})
    if not isinstance(vinculos, dict):
        raise ErrorFicha("vinculos_calendarios debe ser un objeto de relaciones acreditadas")
    vinculo = vinculos.get(campo)
    if vinculo is None:
        return None
    if not isinstance(vinculo, dict) or set(vinculo) != {"tipo", "valor", "edicion", "evidencia"}:
        raise ErrorFicha("Vínculo de calendario incompleto")
    if (
        vinculo["tipo"] not in ("id", "url", "relacion-estructurada")
        or not isinstance(vinculo["valor"], str)
        or not vinculo["valor"].strip()
    ):
        raise ErrorFicha("Tipo o valor de vínculo de calendario inválido")
    destino = vinculo["edicion"]
    if (
        not isinstance(destino, dict)
        or set(destino) != {"id", "url"}
        or not any(destino.values())
        or any(v is not None and (not isinstance(v, str) or not v.strip()) for v in destino.values())
    ):
        raise ErrorFicha("Vínculo sin edición destino identificada")
    if vinculo["tipo"] == "url" and vinculo["valor"] != destino["url"]:
        raise ErrorFicha("La URL del vínculo no coincide con la edición destino")
    evidencia = vinculo["evidencia"]
    if not isinstance(evidencia, dict) or set(evidencia) != {"url", "capturado_utc", "sha256", "localizador"}:
        raise ErrorFicha("Vínculo sin captura localizada")
    if (
        any(not isinstance(evidencia[c], str) or not evidencia[c].strip() for c in ("url", "capturado_utc", "sha256"))
        or re.fullmatch(r"[0-9a-f]{64}", evidencia["sha256"]) is None
    ):
        raise ErrorFicha("Referencia de captura del vínculo inválida")
    localizador = evidencia["localizador"]
    if (
        not isinstance(localizador, dict)
        or set(localizador) != {"tipo", "valor"}
        or localizador["tipo"] not in ("campo", "selector", "pagina", "seccion")
        or not isinstance(localizador["valor"], str)
        or not localizador["valor"].strip()
    ):
        raise ErrorFicha("Localizador del vínculo inválido")
    return deepcopy(vinculo)


def vinculo_matricula(datos: ObjetoJson) -> ObjetoJson | None:
    """Conserva el soporte de matrícula de esta edición, sin heredar el de otra.

    Returns:
        Vínculo declarado para el campo publicado o None si no se aportó.
    """
    original = datos["publicacion_original"]
    run = original.get("run")
    if isinstance(run, dict) and run:
        return _vinculo_calendario(run, "enrollmentStart/enrollmentEnd")
    campo = next(
        (c for c in ("fechas_matricula", "plazo_matricula") if original.get(c) is not None),
        "inicio_matricula/fin_matricula",
    )
    return _vinculo_calendario(original, campo)


def _calendarios_publicacion(
    publicacion: ObjetoJson, tipo_principal: str | None
) -> tuple[list[ObjetoJson], list[Diagnostico]]:
    run = publicacion.get("run")
    propios = run if isinstance(run, dict) and run else publicacion
    principal = "run" if propios is run else _campo_calendario(propios)
    prefijo = "run." if propios is run else ""
    if principal == "run":
        valor = {"inicio": propios.get("start"), "fin": propios.get("end")}
    elif principal == "inicio/fin":
        valor = {"inicio": propios.get("inicio"), "fin": propios.get("fin")}
    else:
        valor = propios[principal]
    entradas = [(principal, valor, tipo_principal)]
    entradas.extend(
        (prefijo + campo, propios[campo], tipo)
        for campo, tipo in TIPOS_CALENDARIOS.items()
        if campo != principal and propios.get(campo) is not None
    )
    if principal != "fechas" and propios.get("fechas") is not None:
        entradas.append((prefijo + "fechas", propios["fechas"], None))
    calendarios = []
    problemas = []
    for indice, (campo, publicado, tipo) in enumerate(entradas):
        alcance = _alcance_calendario(publicado)
        periodo, detalle, diagnosticos = normalizar_periodo(_extremos_calendario(publicado), tipo=tipo)
        calendarios.append(
            {
                "campo": campo,
                "alcance": alcance,
                "vinculo_edicion": _vinculo_calendario(propios, campo.removeprefix(prefijo) if prefijo else campo),
                "periodo": {"tipo": tipo, **periodo},
                "detalle": detalle,
            }
        )
        if alcance == "desconocido":
            problemas.append(
                _diagnostico(
                    "calendarios_publicados." + campo,
                    "Alcance de calendario no reconocido; no se supone pertenencia a la edición.",
                )
            )
        if indice:
            problemas.extend({**d, "campo": "calendarios_publicados." + campo + "." + d["campo"]} for d in diagnosticos)
            if tipo is None:
                problemas.append(
                    _diagnostico(
                        "calendarios_publicados." + campo,
                        "Calendario sin significado declarado; no se supone qué restringe.",
                    )
                )
    problemas.extend(_conflictos_calendarios(calendarios))
    return calendarios, problemas


def _fechas_discrepan(primera: str | None, segunda: str | None) -> bool:
    if primera is None or segunda is None or ("T" in primera) != ("T" in segunda):
        return False
    a, b = (datetime.fromisoformat(v.replace("Z", "+00:00")) for v in (primera, segunda))
    return a != b if (a.utcoffset() is None) == (b.utcoffset() is None) else False


def _conflictos_calendarios(calendarios: list[ObjetoJson]) -> list[Diagnostico]:
    for indice, calendario in enumerate(calendarios):
        periodo = calendario["periodo"]
        if calendario["alcance"] != "edicion" or periodo["tipo"] not in ("periodo-formativo", "ventana-acceso"):
            continue
        for otro in calendarios[indice + 1 :]:
            alternativo = otro["periodo"]
            if (
                otro["alcance"] == "edicion"
                and periodo["tipo"] == alternativo["tipo"]
                and any(_fechas_discrepan(periodo[c], alternativo[c]) for c in ("inicio", "fin"))
            ):
                return [
                    _diagnostico(
                        "calendarios_publicados",
                        "Calendarios publicados incompatibles del mismo tipo; se conservan todos y no se elige uno.",
                    )
                ]
    return []


def calendarios_edicion(datos: ObjetoJson) -> list[ObjetoJson]:
    """Devuelve todos los calendarios de esta edición sin convertir sesiones en plazos.

    El inventario es una extensión aditiva de ficha v1. Su primera entrada es
    exactamente la vista fechas_publicadas; las otras conservan cada publicación
    tipada y su precisión. Matrícula sigue siendo una dimensión separada. Un run
    identificado no hereda calendarios de la ficha general. El alcance edicion
    solo declara el alcance interpretado; no acredita pertenencia por defecto.
    vinculo_edicion conserva el soporte explícito o None; el evaluador debe
    cotejarlo con la identidad y la captura. material-auxiliar queda fuera de los límites de cursado.
    Un alcance desconocido no acredita ninguna de esas pertenencias. El validador rechaza
    inventarios omitidos, alterados o incoherentes antes de evaluar vigencia.

    Returns:
        Copia del inventario o adaptación del único calendario de una ficha v1.
    """
    if "calendarios_publicados" in datos:
        return deepcopy(datos["calendarios_publicados"])
    original = datos["publicacion_original"]
    run = original.get("run")
    campo = "run" if isinstance(run, dict) and run else _campo_calendario(original)
    return [
        {
            "campo": campo,
            "alcance": "edicion",
            "vinculo_edicion": None,
            "periodo": deepcopy(datos["fechas_publicadas"]),
            "detalle": deepcopy(datos["fechas_publicadas_detalle"]),
        }
    ]


def _validar_calendarios(datos: ObjetoJson) -> None:
    esperados, diagnosticos = _calendarios_publicacion(
        datos["publicacion_original"], datos["fechas_publicadas"]["tipo"]
    )
    vinculo_matricula(datos)
    inventario = datos.get("calendarios_publicados")
    if (
        inventario is None
        and len(esperados) == 1
        and esperados[0]["alcance"] == "edicion"
        and esperados[0]["vinculo_edicion"] is None
    ):
        return
    if not isinstance(inventario, list) or inventario != esperados or not inventario:
        raise ErrorFicha("Calendarios omitidos o alterados; renormalizar la publicación completa de esta edición")
    primero = inventario[0]
    if primero["periodo"] != datos["fechas_publicadas"] or primero["detalle"] != datos["fechas_publicadas_detalle"]:
        raise ErrorFicha("La vista v1 y el inventario de calendarios no coinciden")
    if any(d not in datos["diagnosticos_normalizacion"] for d in diagnosticos):
        raise ErrorFicha("No se conservan los diagnósticos de los calendarios publicados")


def normalizar_datos_edicion(
    fuente: ObjetoJson,
    run: ObjetoJson | None = None,
    *,
    tipo_fechas: str | None = None,
    vocabulario_destinatarios: ObjetoJson | None = None,
    aliases_destinatarios: ObjetoJson | None = None,
) -> ObjetoJson:
    """Normaliza dimensiones conocidas sin modificar el registro fuente recibido.

    Vocabulario y aliases de destinatarios son una opción conjunta explícita. Si
    se omiten, la salida anterior se conserva; si se aportan, se añade destinatario
    validado en modo estricto, sin inferir requisitos ni admisión personal.

    Returns:
        Ficha normalizada que conserva publicaciones y diagnósticos.
    """
    run = {} if run is None else run
    problemas = []
    campo_fechas = _campo_calendario(fuente)
    publicado = fuente.get(campo_fechas)
    if tipo_fechas is None:
        tipo_fechas = TIPOS_CALENDARIOS.get(campo_fechas)
    if publicado is None:
        publicado = {"inicio": fuente.get("inicio"), "fin": fuente.get("fin")}
    if run:
        generales = normalizar_periodo(publicado)[0]
        propias = {"inicio": run.get("start"), "fin": run.get("end")}
        if any(
            generales[c] is not None and propias[c] is not None and generales[c] != propias[c]
            for c in ("inicio", "fin")
        ):
            problemas.append(
                _diagnostico(
                    "fechas_publicadas",
                    (
                        "La ficha general difiere de esta edición; se usan las fechas de la edición "
                        "identificada y se conservan ambas publicaciones."
                    ),
                )
            )
        publicado = propias
        tipo_fechas = "ventana-acceso" if run.get("pacingType") == "self_paced" else tipo_fechas
    fechas, detalles_fechas, diagnosticos = normalizar_periodo(_extremos_calendario(publicado), tipo=tipo_fechas)
    fechas = {"tipo": tipo_fechas, **fechas}
    problemas.extend({**d, "campo": "fechas_publicadas." + d["campo"]} for d in diagnosticos)
    matricula, detalles_matricula, diagnosticos = _matricula_edicion(fuente, run)
    problemas.extend(diagnosticos)
    modalidad, sincronia, diagnosticos = normalizar_modalidad(
        fuente.get("modalidad"),
        fuente.get("sincronia"),
        pacing_type=run.get("pacingType"),
    )
    problemas.extend(diagnosticos)
    horas, metodo_horas, diagnosticos = normalizar_horas(fuente)
    problemas.extend(diagnosticos)
    estado_edicion, estado_inscripcion = normalizar_estados(fuente, run)
    originales = {campo: deepcopy(fuente[campo]) for campo in CAMPOS_ORIGINALES if campo in fuente}
    if run:
        originales["run"] = deepcopy(run)
    resultado = {
        "schema_ficha_version": 1,
        "modalidad": modalidad,
        "sincronia": sincronia,
        "horas_publicadas": horas,
        "metodo_horas": metodo_horas,
        "dedicacion_publicada": deepcopy(fuente.get("horas"))
        if isinstance(fuente.get("horas"), dict)
        else deepcopy(fuente.get("duracion")),
        "fechas_publicadas": fechas,
        "fechas_publicadas_detalle": detalles_fechas,
        "fechas_matricula": matricula,
        "fechas_matricula_detalle": detalles_matricula,
        "coste_formacion_tipo": normalizar_coste(
            fuente.get("coste_formacion"),
            fuente.get("limite_gratuidad"),
        ),
        "estado_edicion": estado_edicion,
        "estado_inscripcion": estado_inscripcion,
        "acceso_territorial": normalizar_territorio(_primero(fuente, ("territorio", "alcance", "acceso_espana"))),
        "plaza_confirmada_persona": None,
        "admisibilidad_persona": None,
        "publicacion_original": originales,
        "diagnosticos_normalizacion": problemas,
    }
    calendarios, diagnosticos = _calendarios_publicacion(originales, tipo_fechas)
    if len(calendarios) > 1 or any(c["alcance"] != "edicion" or c["vinculo_edicion"] is not None for c in calendarios):
        resultado["calendarios_publicados"] = calendarios
        problemas.extend(diagnosticos)
    dimensiones = {
        "modalidad": fuente.get("modalidad"),
        "sincronia": _primero(fuente, ("sincronia", "modalidad")),
        "coste_formacion_tipo": fuente.get("coste_formacion"),
        "estado_inscripcion": _primero(fuente, ("inscripcion", "estado", "gestion_matricula")),
        "acceso_territorial": _primero(fuente, ("territorio", "alcance", "acceso_espana")),
    }
    for campo, publicado in dimensiones.items():
        if publicado is not None and resultado[campo] is None and not any(d["campo"] == campo for d in problemas):
            problemas.append(
                _diagnostico(
                    campo,
                    "La publicación no permite una clasificación inequívoca; se conserva como desconocida.",
                )
            )
    _extender_destinatario(resultado, fuente, vocabulario_destinatarios, aliases_destinatarios)
    validar_datos_edicion(
        resultado,
        vocabulario_destinatarios=vocabulario_destinatarios,
        aliases_destinatarios=aliases_destinatarios,
    )
    return resultado


def _extender_destinatario(
    resultado: ObjetoJson, fuente: ObjetoJson, vocabulario: ObjetoJson | None, aliases: ObjetoJson | None
) -> None:
    if vocabulario is None and aliases is None:
        return
    if vocabulario is None or aliases is None:
        raise ErrorFicha("Destinatarios exige vocabulario y aliases explícitos conjuntamente")
    try:
        resultado["destinatario"] = normalizar_destinatario(
            fuente.get("destinatario"), vocabulario, aliases, estricto=True
        )
    except ErrorDestinatario as error:
        raise ErrorFicha(str(error)) from error


def _comprobar_destinatario_recibido(
    datos: ObjetoJson, vocabulario: ObjetoJson | None, aliases: ObjetoJson | None
) -> None:
    if "destinatario" not in datos:
        return
    if vocabulario is None or aliases is None:
        raise ErrorFicha("Validar destinatario exige vocabulario y aliases explícitos conjuntamente")
    try:
        calculado = normalizar_destinatario(datos["destinatario"], vocabulario, aliases, estricto=True)
        if sha256_json(calculado) != sha256_json(datos["destinatario"]):
            raise ErrorDestinatario("El destinatario recibido no conserva su normalización")
    except ErrorDestinatario as error:
        raise ErrorFicha(str(error)) from error


def validar_datos_edicion(
    datos: ValorJson,
    *,
    vocabulario_destinatarios: ObjetoJson | None = None,
    aliases_destinatarios: ObjetoJson | None = None,
) -> None:
    """Valida forma y vocabularios; no certifica verdad o admisión personal."""

    def exigir(condicion: object, mensaje: str) -> None:
        if not condicion:
            raise ErrorFicha(mensaje)

    exigir(isinstance(datos, dict), "datos de edición debe ser objeto")
    exigir(
        type(datos.get("schema_ficha_version")) is int and datos["schema_ficha_version"] == 1,
        "schema_ficha_version debe ser 1",
    )
    for campo, valores in (
        ("modalidad", MODALIDADES),
        ("sincronia", SINCRONIAS),
        ("coste_formacion_tipo", COSTES),
        ("estado_inscripcion", ESTADOS_INSCRIPCION),
        ("estado_edicion", ESTADOS_EDICION),
        ("acceso_territorial", ACCESOS_TERRITORIALES),
    ):
        exigir(
            campo in datos and (datos[campo] is None or isinstance(datos[campo], str) and datos[campo] in valores),
            f"{campo}: valor semántico no admitido",
        )
    horas = datos.get("horas_publicadas")
    exigir(
        "horas_publicadas" in datos
        and (horas is None or type(horas) in (int, float) and math.isfinite(horas) and horas >= 0),
        "horas_publicadas debe ser número finito no negativo o null",
    )
    for campo, claves in (
        ("fechas_publicadas", {"tipo", "inicio", "fin"}),
        ("fechas_matricula", {"inicio", "fin"}),
    ):
        periodo = datos.get(campo)
        exigir(
            isinstance(periodo, dict) and set(periodo) == claves,
            f"{campo}: forma no admitida",
        )
        if campo == "fechas_publicadas":
            exigir(
                periodo["tipo"] in (None, "periodo-formativo", "ventana-acceso", "sesiones"),
                "Tipo de fechas publicado no admitido",
            )
        for extremo in ("inicio", "fin"):
            valor = periodo[extremo]
            exigir(
                valor is None or isinstance(valor, str) and normalizar_fecha(valor)["valor"] == valor,
                f"{campo}.{extremo}: fecha normalizada inválida",
            )
    for campo in ("fechas_publicadas", "fechas_matricula"):
        periodo = datos[campo]
        extremos = {k: periodo[k] for k in ("inicio", "fin")}
        coherente, detalle, _ = normalizar_periodo(extremos)
        exigir(coherente == extremos, f"{campo}: intervalo invertido")
        exigir(
            datos.get(campo + "_detalle") == detalle,
            f"{campo}: precisión o zona incoherente",
        )
    for campo in ("plaza_confirmada_persona", "admisibilidad_persona"):
        exigir(
            campo in datos and datos[campo] is None,
            f"{campo}: esta investigación no acredita admisión personal",
        )
    exigir(
        isinstance(datos.get("publicacion_original"), dict),
        "Falta publicación original",
    )
    exigir(
        isinstance(datos.get("diagnosticos_normalizacion"), list),
        "Falta lista de diagnósticos",
    )

    _validar_calendarios(datos)
    _comprobar_destinatario_recibido(datos, vocabulario_destinatarios, aliases_destinatarios)


def validar_lote_fichas(
    lote: ObjetoJson,
    *,
    vocabulario_destinatarios: ObjetoJson | None = None,
    aliases_destinatarios: ObjetoJson | None = None,
) -> None:
    """Comprueba fichas y etiquetas propuestas sin certificar niveles o acceso.

    Raises:
        ErrorFicha: Una ficha o etiqueta afirma datos no admitidos por el contrato.
    """
    for programa in lote["programas"]:
        datos = programa["datos"]
        _comprobar_destinatario_recibido(datos, vocabulario_destinatarios, aliases_destinatarios)
        if datos.get("nivel_faro") is not None or datos.get("capacidades_revisadas") is not None:
            raise ErrorFicha("No se asignan niveles Faro ni capacidades sin revisión pedagógica")
        if any(e["estado"] != "propuesta" for e in programa["etiquetas"]):
            raise ErrorFicha("Las etiquetas temáticas de este normalizador solo son propuestas")
    for edicion in lote["ediciones"]:
        validar_datos_edicion(
            edicion["datos"],
            vocabulario_destinatarios=vocabulario_destinatarios,
            aliases_destinatarios=aliases_destinatarios,
        )
