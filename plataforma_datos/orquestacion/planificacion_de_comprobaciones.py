"""Cadencia de consultas intentadas y alcance real; ningún plan acredita vigencia ni instala un programador.

Los intervalos cuentan fechas del calendario UTC, para que una cola variable no salte una consulta diaria.
Siete días es una comprobación semanal del recurso declarado, no su frecuencia de publicación. Las ediciones
conocidas pueden descargarse sin descubrir su sucesora: esa revisión permanece visible aunque la consulta no venza.
Solo Plan.fuentes concede descarga; los otros módulos de Plan.modulos se recomponen con originales conservados.

Tras un intento con éxito, la fuente espera su cadencia. Tras un intento fallido o interrumpido, el reintento llega
a los días de estado_de_la_actualizacion.espera según los fallos seguidos (1, 2, 4, 8…), nunca más tarde que la
cadencia: un servidor caído un día no deja la fuente sin consultar una semana. Cada fuente cuenta sus propios fallos,
así que el fallo de una no retrasa ni adelanta a otra. El plan solo decide cuándo consultar; no cambia datos.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import NamedTuple

from plataforma_datos.contratos.fuentes import ConjuntoComprobacion as Conjunto
from plataforma_datos.contratos.fuentes import cargar_fuente
from plataforma_datos.orquestacion.estado_de_la_actualizacion import espera
from plataforma_datos.orquestacion.modulos import MODULOS

# Cobertura explícita: las fuentes registradas, formación dividida y los dos productores externos de datos globales.
CONJUNTOS: tuple[Conjunto, ...] = (
    *cargar_fuente("esco", tema="ocupaciones").conjuntos,
    *cargar_fuente("oit", tema="ocupaciones").conjuntos,
    *cargar_fuente("clasificaciones", tema="ocupaciones").conjuntos,
    *cargar_fuente("cambra", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("hechos_informe", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("cataluna", tema="mercado").conjuntos,
    *cargar_fuente("ocupados", tema="mercado").conjuntos,
    *cargar_fuente("censo", tema="mercado").conjuntos,
    *cargar_fuente("tich", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("salarios", tema="mercado").conjuntos,
    *cargar_fuente("formacion").conjuntos,
    *cargar_fuente("consorci").conjuntos,
    *cargar_fuente("agencia").conjuntos,
    *cargar_fuente("acreditacion").conjuntos,
    *cargar_fuente("citilab").conjuntos,
    *cargar_fuente("abierta").conjuntos,
    *cargar_fuente("lecturas", tema="biblioteca").conjuntos,
    *cargar_fuente("enlaces_lecturas", tema="biblioteca").conjuntos,
    *cargar_fuente("derechos", tema="derechos").conjuntos,
    *cargar_fuente("textos", tema="ocupaciones").conjuntos,
    *cargar_fuente("idescat", tema="comun").conjuntos,
    *cargar_fuente("catalan", tema="comun").conjuntos,
    *cargar_fuente("nombres", tema="comun").conjuntos,
    *cargar_fuente("sectores", tema="mercado").conjuntos,
    *cargar_fuente("empresas", tema="mercado").conjuntos,
    *cargar_fuente("observatori", tema="mercado").conjuntos,
    *cargar_fuente("necesidades", tema="mercado").conjuntos,
    *cargar_fuente("perfiles", tema="mercado").conjuntos,
    *cargar_fuente("certificados2016").conjuntos,
    *cargar_fuente("actic").conjuntos,
    *cargar_fuente("barcelonactiva").conjuntos,
    *cargar_fuente("fundae").conjuntos,
    *cargar_fuente("memoria").conjuntos,
    *cargar_fuente("hp_life").conjuntos,
    *cargar_fuente("cibervoluntarios").conjuntos,
    *cargar_fuente("claude_academy").conjuntos,
    *cargar_fuente("territorios", tema="comun").conjuntos,
    *cargar_fuente("mundo_eurostat", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ilostat", tema="mercado").conjuntos,
    *cargar_fuente("tic_llars", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("clima_empresarial", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ue_eurostat", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("decada_digital", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("eurobarometro", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ceo_panel", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ia_nacional_isl", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ia_nacional_gbr", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ia_nacional_bra", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ia_nacional_che", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ia_nacional_isr", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("ia_nacional_kor", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("epa", tema="mercado").conjuntos,
    *cargar_fuente("eaes", tema="mercado").conjuntos,
    *cargar_fuente("ofertas", tema="mercado").conjuntos,
    *cargar_fuente("enlaces").conjuntos,
    *cargar_fuente("datos_globales", tema="derivados").conjuntos,
    *cargar_fuente("ia_nacional", tema="ia_y_trabajo").conjuntos,
    *cargar_fuente("encuestas_isco4", tema="ia_y_trabajo").conjuntos,
)

# Estos lectores consultan recursos conocidos, pero no descubren todas las nuevas ediciones o disposiciones.
ALCANCES_CON_REVISION = frozenset({"edicion-conocida", "contenido-actual-acotado", "recurso-actual-sin-edicion"})
# El visor publica contratación y desgloses del mismo corte. Si vence una parte, se consultan ambas;
# cada módulo conserva su validación y el paquete solo se admite cuando sus periodos son coherentes.
FUENTES_DEL_VISOR = frozenset({"cataluna", "observatori"})


class Plan(NamedTuple):
    """Permisos de descarga, selección de módulos y revisiones que siguen requiriendo intervención."""

    fuentes: tuple[str, ...]
    modulos: tuple[str, ...]
    revisiones: tuple[str, ...]


def _exigir_utc(instante: datetime) -> None:
    if not isinstance(instante, datetime) or instante.utcoffset() != timedelta(0):
        raise ValueError("La planificación requiere instantes conscientes en UTC")


def dias_hasta_consultar(conjunto: Conjunto, fallos_seguidos: int) -> int:
    """Días del calendario UTC entre el último intento y la próxima consulta del conjunto.

    Returns:
        La cadencia tras un éxito; tras fallos seguidos, la espera escalonada sin superar la cadencia.

    Raises:
        ValueError: Si la cuenta de fallos no es un entero no negativo.
    """
    if type(fallos_seguidos) is not int or fallos_seguidos < 0:
        raise ValueError("fallos_seguidos debe ser un entero no negativo")
    if fallos_seguidos == 0:
        return conjunto.intervalo_dias
    return min(conjunto.intervalo_dias, espera(fallos_seguidos).days)


def planificar(
    ahora: datetime,
    ultimos_intentos: Mapping[str, datetime],
    *,
    forzar: bool = False,
    recomponer: Sequence[str] = (),
    fallos_seguidos: Mapping[str, int] | None = None,
) -> Plan:
    """Selecciona por fecha UTC del último intento y por su resultado, sin inferir éxito de una reconstrucción.

    Args:
        ahora: Instante UTC de esta decisión.
        ultimos_intentos: Último intento de consulta por ID de conjunto, incluso parcial o fallido.
        forzar: Permite consultar las fuentes remotas aunque su intervalo no haya vencido.
        fallos_seguidos: Intentos remotos fallidos o interrumpidos seguidos por ID de conjunto; ausente es cero.
        recomponer: Módulos que se regeneran localmente sin conceder descarga a sus fuentes.

    Returns:
        Fuentes y módulos únicos en orden del registro, y las revisiones pendientes por conjunto.

    Raises:
        ValueError: Ante instantes inválidos o futuros, IDs desconocidos o módulos de recomposición desconocidos.
    """
    _exigir_utc(ahora)
    if type(forzar) is not bool:
        raise ValueError("forzar debe ser un booleano")
    ids = {conjunto.id for conjunto in CONJUNTOS}
    if len(ids) != len(CONJUNTOS):
        raise ValueError("Identidades de comprobación duplicadas en el planificador")
    fallos = dict(fallos_seguidos or {})
    if set(fallos) - set(ultimos_intentos):
        raise ValueError("Fallos sin intento registrado")
    for identificador, intento in ultimos_intentos.items():
        if identificador not in ids:
            raise ValueError(f"Conjunto desconocido: {identificador}")
        _exigir_utc(intento)
        if intento > ahora:
            raise ValueError(f"Intento futuro: {identificador}")
    locales = set(recomponer)
    if locales - {modulo.id for modulo in MODULOS}:
        raise ValueError("Módulo de recomposición desconocido")
    descargas = {
        conjunto.fuente
        for conjunto in CONJUNTOS
        if conjunto.operacion == "descargar"
        and (
            forzar
            or conjunto.id not in ultimos_intentos
            or (ahora.date() - ultimos_intentos[conjunto.id].date()).days
            >= dias_hasta_consultar(conjunto, fallos.get(conjunto.id, 0))
        )
    }
    if descargas & FUENTES_DEL_VISOR:
        descargas.update(FUENTES_DEL_VISOR)
    fuentes = tuple(fuente for modulo in MODULOS for fuente in modulo.fuentes if fuente in descargas)
    modulos = tuple(
        modulo.id for modulo in MODULOS if modulo.id in locales or any(f in descargas for f in modulo.fuentes)
    )
    revisiones = tuple(
        conjunto.id
        for conjunto in CONJUNTOS
        if conjunto.operacion == "revision"
        or (conjunto.operacion == "descargar" and conjunto.alcance in ALCANCES_CON_REVISION)
    )
    return Plan(fuentes, modulos, revisiones)
