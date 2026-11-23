"""Políticas de actualización por fuente, comparación, cuarentena de archivos del paquete y renovación manual.

Las políticas diaria y mensual aceptan versiones nuevas bajo sus controles.
La política de edición descarga sin aceptar cambios hasta una revisión explícita.
Las fuentes fijas comprueban sus originales por huella; las manuales conservan
su fecha de revisión; las redactadas tienen contenido editorial propio.
"""

import json
import re
from collections.abc import Iterator, Mapping
from datetime import date
from pathlib import Path
from typing import Literal, NamedTuple, TypedDict

from plataforma_datos.comun.entrada_salida import Json, hoy_utc
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS, PAQUETE, RAIZ, exigir
from plataforma_datos.contratos.fuentes import PoliticaActualizacion as Fuente
from plataforma_datos.contratos.fuentes import cargar_fuente
from plataforma_datos.cursos.fuentes.formacion.constantes import PATRON_CURSOS
from plataforma_datos.orquestacion.oferta_soc_del_paquete import comparar_oferta_soc, fecha_soc, sin_claves_repetidas

DIARIA = "diaria"
MENSUAL = "mensual"
POLITICAS_RENOVABLES = (DIARIA, MENSUAL)
ETAPA_DE_DESCARGA = "descargar"
ACEPTAR_CAMBIO = "--aceptar-cambio"  # opción de ordenes.interfaz_con_descarga
EDICION = "edición"
FIJA = "fija"
MANUAL = "manual"
REDACTADA = "redactada"
PAQUETE_RELATIVO = PAQUETE.relative_to(RAIZ)
CARPETA_DE_INFORMES = (DATOS_RELATIVOS / "ejecuciones").as_posix()
# Los informes fechados de esa carpeta (AAAA-MM-DD-HHMMSS.json, hora UTC; los anteriores a los segundos, HHMM); a su
# lado viven el estado, el diario y el cerrojo.
NOMBRE_DE_INFORME = re.compile(r"\d{4}-\d{2}-\d{2}-\d{4}(?:\d{2})?\.json")
# Un archivo del paquete que pierde más de esta parte de sus entradas o de sus cursos SOC queda en cuarentena: es más
# probable un cambio de formato en la fuente que una caída real, pero solo una persona puede decidirlo. Mientras decide,
# ese archivo conserva su versión publicada y el resto del paquete se publica; el umbral avisa, no decide. Lo que la
# regla de retirada activa retira con su evidencia no cuenta (Explicada); su aviso propio es aviso_de_la_retirada.
PERDIDA_MAXIMA = 0.20
# Entrada fijada de los análisis publicados (reglas del repositorio): no cambia sin decisión.
FIJADOS = ("formacion.json",)
# Archivos de los que salen los vectores de significado, que escribe otra herramienta (con coste): si cambian, quedan
# desfasados y hay que regenerarlos a propósito.
CON_VECTORES = ("oit.json", "formacion.json")
# Archivos del paquete que cambiaron de nombre a propósito: el antiguo deja de publicarse y su sucesor sale del mismo
# validado. «cambra.json» llevaba la tabla del estudio; desde el 22/11/2026 (commit 1eeb50e4) la web entrega solo el
# nivel de exposición, en «exposicion-cambra.json». Mientras la generación vigente sea anterior al cambio, el antiguo
# «desaparece»: no es una caída si el sucesor sale de los mismos validados.
SUCESORES = {"cambra.json": "exposicion-cambra.json"}
ORIGINALES_CATALOGOS_FORMACION = (
    "eures-esco-cosispe-es.csv",
    "soc-especialidades.json",
    "digcomp-3.0.jsonld",
    "digcomp-3.0.xlsx",
    "digcomp-copyright.txt",
)
CLAVES_DE_FECHA = re.compile(
    r'"(?:descargado|consultado|recibido|fecha|copia|verificado)[a-z_]*"\s*:\s*"(\d{4}-\d{2}-\d{2})'
)


class FilaManual(TypedDict):
    """Una fuente que renueva una persona: su fecha, su antigüedad en días y si conviene renovarla ya."""

    fuente: str
    frecuencia: str
    fecha: str | None
    dias: int | None
    renovar: bool


class LadoDelPaquete(TypedDict):
    """Un archivo del paquete en uno de los dos lados de la comparación."""

    bytes: int
    entradas: int


EstadoDelArchivo = Literal["desaparece", "nuevo", "igual", "cambia"]
DESAPARECE: EstadoDelArchivo = "desaparece"
NUEVO: EstadoDelArchivo = "nuevo"
IGUAL: EstadoDelArchivo = "igual"
CAMBIA: EstadoDelArchivo = "cambia"


class FilaDelPaquete(TypedDict):
    """Un archivo del paquete antes y después (`None` en el lado donde no está) y su estado."""

    archivo: str
    antes: LadoDelPaquete | None
    despues: LadoDelPaquete | None
    estado: EstadoDelArchivo


class FilaDeOriginales(TypedDict):
    """Una carpeta de originales con los archivos que cambian, aparecen o desaparecen."""

    carpeta: str
    cambian: list[str]
    nuevos: list[str]
    quitados: list[str]


class Perdida(TypedDict):
    """Un archivo del paquete que pierde más de PERDIDA_MAXIMA de sus entradas o de sus cursos SOC."""

    archivo: str
    medida: Literal["entradas", "cursos SOC"]
    antes: int
    despues: int


class Explicada(NamedTuple):
    """Lo que la regla de retirada activa de su fuente explica de lo que pierde un archivo del paquete.

    `unidades` son las del archivo publicado que la regla retira con su evidencia registrada y ya no están en el nuevo;
    `entradas`, las que tendría el archivo publicado sin ellas. Lo nuevo se compara con eso: lo explicado no es una
    pérdida sin explicar, y lo que falte además sí lo es.
    """

    unidades: int
    entradas: int


class EnCuarentena(TypedDict):
    """Un archivo que supera el umbral y conserva su versión publicada, con los que deben ir con él (él incluido).

    `exportado_sha256` es la huella de la versión nueva que no se publica: la que una persona puede aceptar.
    """

    archivo: str
    grupo: list[str]
    exportado_sha256: str


class Comparacion(NamedTuple):
    """Qué cambia entre lo vigente y lo nuevo y qué conserva su versión publicada.

    `alarmas` detienen la sustitución del paquete. `perdidas` son avisos del umbral: sus archivos van a `cuarentena`
    (con los que deben ir juntos) salvo los que una persona aceptó, que constan en `aceptados`.
    """

    paquete: list[FilaDelPaquete] | None
    originales: list[FilaDeOriginales]
    alarmas: list[str]
    perdidas: tuple[Perdida, ...] = ()
    cuarentena: tuple[EnCuarentena, ...] = ()
    aceptados: tuple[str, ...] = ()

    @property
    def retenidos(self) -> frozenset[str]:
        """Todos los archivos que conservan su versión publicada.

        Returns:
            La unión de los grupos en cuarentena.
        """
        return frozenset(nombre for retenido in self.cuarentena for nombre in retenido["grupo"])


FUENTES: dict[str, Fuente] = {
    "esco": cargar_fuente("esco", tema="ocupaciones").actualizacion,
    "oit": cargar_fuente("oit", tema="ocupaciones").actualizacion,
    "clasificaciones": cargar_fuente("clasificaciones", tema="ocupaciones").actualizacion,
    "cambra": cargar_fuente("cambra", tema="ia_y_trabajo").actualizacion,
    "hechos_informe": cargar_fuente("hechos_informe", tema="ia_y_trabajo").actualizacion,
    "cataluna": cargar_fuente("cataluna", tema="mercado").actualizacion,
    "ocupados": cargar_fuente("ocupados", tema="mercado").actualizacion,
    "censo": cargar_fuente("censo", tema="mercado").actualizacion,
    "tich": cargar_fuente("tich", tema="ia_y_trabajo").actualizacion,
    "salarios": cargar_fuente("salarios", tema="mercado").actualizacion,
    # Solo la oferta SOC se descarga automáticamente; los catálogos conservan sus entradas manuales por edición.
    "formacion": cargar_fuente("formacion").actualizacion,
    "consorci": cargar_fuente("consorci").actualizacion,
    "agencia": cargar_fuente("agencia").actualizacion,
    "acreditacion": cargar_fuente("acreditacion").actualizacion,
    "citilab": cargar_fuente("citilab").actualizacion,
    # Sin originales: a los 90 días sin revisar (abierta.DIAS_DE_REVISION) solo avisa; no hay plazo aquí.
    "abierta": cargar_fuente("abierta").actualizacion,
    "lecturas": cargar_fuente("lecturas", tema="biblioteca").actualizacion,
    "enlaces_lecturas": cargar_fuente("enlaces_lecturas", tema="biblioteca").actualizacion,
    "derechos": cargar_fuente("derechos", tema="derechos").actualizacion,
    "textos": cargar_fuente("textos", tema="ocupaciones").actualizacion,
    "idescat": cargar_fuente("idescat", tema="comun").actualizacion,
    "catalan": cargar_fuente("catalan", tema="comun").actualizacion,
    "nombres": cargar_fuente("nombres", tema="comun").actualizacion,
    "sectores": cargar_fuente("sectores", tema="mercado").actualizacion,
    "empresas": cargar_fuente("empresas", tema="mercado").actualizacion,
    "observatori": cargar_fuente("observatori", tema="mercado").actualizacion,
    "necesidades": cargar_fuente("necesidades", tema="mercado").actualizacion,
    "perfiles": cargar_fuente("perfiles", tema="mercado").actualizacion,
    "certificados2016": cargar_fuente("certificados2016").actualizacion,
    "actic": cargar_fuente("actic").actualizacion,
    "barcelonactiva": cargar_fuente("barcelonactiva").actualizacion,
    "fundae": cargar_fuente("fundae").actualizacion,
    "memoria": cargar_fuente("memoria").actualizacion,
    "hp_life": cargar_fuente("hp_life").actualizacion,
    "cibervoluntarios": cargar_fuente("cibervoluntarios").actualizacion,
    "claude_academy": cargar_fuente("claude_academy").actualizacion,
    "territorios": cargar_fuente("territorios", tema="comun").actualizacion,
    "mundo_eurostat": cargar_fuente("mundo_eurostat", tema="ia_y_trabajo").actualizacion,
    "ilostat": cargar_fuente("ilostat", tema="mercado").actualizacion,
    "tic_llars": cargar_fuente("tic_llars", tema="ia_y_trabajo").actualizacion,
    "ue_eurostat": cargar_fuente("ue_eurostat", tema="ia_y_trabajo").actualizacion,
    "decada_digital": cargar_fuente("decada_digital", tema="ia_y_trabajo").actualizacion,
    "eurobarometro": cargar_fuente("eurobarometro", tema="ia_y_trabajo").actualizacion,
    "ceo_panel": cargar_fuente("ceo_panel", tema="ia_y_trabajo").actualizacion,
    "clima_empresarial": cargar_fuente("clima_empresarial", tema="ia_y_trabajo").actualizacion,
    "ia_nacional_isl": cargar_fuente("ia_nacional_isl", tema="ia_y_trabajo").actualizacion,
    "ia_nacional_gbr": cargar_fuente("ia_nacional_gbr", tema="ia_y_trabajo").actualizacion,
    "ia_nacional_bra": cargar_fuente("ia_nacional_bra", tema="ia_y_trabajo").actualizacion,
    "ia_nacional_che": cargar_fuente("ia_nacional_che", tema="ia_y_trabajo").actualizacion,
    "ia_nacional_isr": cargar_fuente("ia_nacional_isr", tema="ia_y_trabajo").actualizacion,
    "ia_nacional_kor": cargar_fuente("ia_nacional_kor", tema="ia_y_trabajo").actualizacion,
    "epa": cargar_fuente("epa", tema="mercado").actualizacion,
    "eaes": cargar_fuente("eaes", tema="mercado").actualizacion,
    "ofertas": cargar_fuente("ofertas", tema="mercado").actualizacion,
    "enlaces": cargar_fuente("enlaces").actualizacion,
    # Sin originales: se compone con lo validado de sus fuentes, así que cambia cuando cambia una de ellas.
    "datos_globales": cargar_fuente("datos_globales", tema="derivados").actualizacion,
}


def parametros_de_etapa(fuente: str, etapa: str) -> tuple[str, ...]:
    """Parámetros con que la actualización invoca una etapa de una fuente; el lector debe admitirlos.

    Es la única fuente de verdad del contrato: la construcción de las órdenes (actualizar.ordenes_de_la_fuente) y su
    reconocimiento estricto (ejecucion_observada.etapa_de_fuente) la consultan. Solo la descarga de una política
    renovable acepta una versión nueva, y su lector lo entiende con ordenes.interfaz_con_descarga.

    Returns:
        `(ACEPTAR_CAMBIO,)` para la descarga de una política renovable; ninguno en otro caso.
    """
    return (ACEPTAR_CAMBIO,) if etapa == ETAPA_DE_DESCARGA and FUENTES[fuente].politica in POLITICAS_RENOVABLES else ()


def informes_fechados(raiz: Path) -> list[Path]:
    """Lista los informes JSON fechados de una actualización, del más antiguo al más reciente.

    El orden de los nombres es el de las fechas: a igual minuto, un nombre HHMM va antes que uno HHMMSS.

    Args:
        raiz: La raíz del repositorio.

    Returns:
        Las rutas de CARPETA_DE_INFORMES cuyo nombre sigue NOMBRE_DE_INFORME, ordenadas.
    """
    carpeta = raiz / CARPETA_DE_INFORMES
    return sorted(ruta for ruta in carpeta.glob("*.json") if NOMBRE_DE_INFORME.fullmatch(ruta.name))


# ---------------------------------------------------------------------------------------------------------------------
# Comparación con lo vigente
# ---------------------------------------------------------------------------------------------------------------------


def _leer_json_si_existe(ruta: Path) -> Json:
    """Lee un JSON si existe (a diferencia de `entrada_salida.leer_json`, que lo exige).

    Args:
        ruta: El archivo.

    Returns:
        Su contenido; None si no existe.
    """
    return json.loads(ruta.read_text(encoding="utf-8")) if ruta.exists() else None


def entradas(datos: Json) -> int:
    """Cuenta las entradas de un archivo del paquete: la colección más grande de sus dos primeros niveles.

    Args:
        datos: El contenido del archivo.

    Returns:
        El tamaño de esa colección; 0 si no es lista ni objeto.
    """
    if isinstance(datos, list):
        return len(datos)
    if isinstance(datos, dict):
        return max([len(datos)] + [len(valor) for valor in datos.values() if isinstance(valor, (list, dict))])
    return 0


def _lado(carpeta: Path, nombre: str, entrada: Json) -> LadoDelPaquete | None:
    """Mide un archivo en un lado de la comparación: bytes y entradas.

    Args:
        carpeta: La carpeta del paquete de ese lado.
        nombre: El archivo.
        entrada: Su entrada en el manifiesto de ese lado (None si no la tiene).

    Returns:
        Sus bytes y entradas; None si su manifiesto no lo registra.
    """
    if not entrada:
        return None
    ruta = carpeta / nombre
    return {"bytes": ruta.stat().st_size, "entradas": entradas(_leer_json_si_existe(ruta))}


def _estado(antes: Json, despues: Json) -> EstadoDelArchivo:
    """Clasifica un archivo del paquete según su huella en cada manifiesto.

    Args:
        antes: Su entrada en el manifiesto vigente (None si no está).
        despues: Su entrada en el manifiesto nuevo (None si no está).

    Returns:
        «desaparece», «nuevo», «igual» o «cambia».
    """
    if not despues:
        return DESAPARECE
    if not antes:
        return NUEVO
    return IGUAL if antes["sha256"] == despues["sha256"] else CAMBIA


def fila_del_paquete(
    nombre: str, vigente: Path, nuevo: Path, manifiestos: tuple[dict[str, Json], dict[str, Json]]
) -> FilaDelPaquete:
    """Compara un archivo del paquete: huella, bytes y entradas antes y después.

    Args:
        nombre: El archivo.
        vigente: La carpeta del paquete vigente.
        nuevo: La carpeta del paquete nuevo.
        manifiestos: El manifiesto vigente y el nuevo.

    Returns:
        La fila de la comparación.
    """
    antes, despues = (manifiesto.get(nombre) for manifiesto in manifiestos)
    return {
        "archivo": nombre,
        "antes": _lado(vigente, nombre, antes),
        "despues": _lado(nuevo, nombre, despues),
        "estado": _estado(antes, despues),
    }


def _oferta_de_formacion(
    fila: FilaDelPaquete, paquetes: tuple[Path, Path] | None
) -> tuple[bool, tuple[int, int] | None]:
    """La excepción de oferta SOC solo se estudia para formacion.json cuando cambia.

    Returns:
        Lo mismo que comparar_oferta_soc, o ninguna excepción para cualquier otro archivo.
    """
    if fila["estado"] == CAMBIA and fila["archivo"] == "formacion.json":
        return comparar_oferta_soc(paquetes)
    return False, None


def renombrados(manifiestos: tuple[dict[str, Json], dict[str, Json]]) -> frozenset[str]:
    """Los archivos que desaparecen porque su sucesor declarado (SUCESORES) sale de los mismos validados.

    Args:
        manifiestos: El manifiesto vigente y el nuevo.

    Returns:
        Los nombres antiguos cuyo sucesor está en el manifiesto nuevo con los mismos orígenes.
    """
    vigente, nuevo = manifiestos

    def origenes(entrada: Json) -> frozenset[str]:
        return frozenset(entrada.get("origenes") or {}) if isinstance(entrada, dict) else frozenset()

    return frozenset(
        antiguo
        for antiguo, sucesor in SUCESORES.items()
        if antiguo in vigente
        and antiguo not in nuevo
        and sucesor in nuevo
        and origenes(vigente[antiguo])
        and origenes(vigente[antiguo]) == origenes(nuevo[sucesor])
    )


def alarmas_del_paquete(
    filas: list[FilaDelPaquete],
    *,
    paquetes: tuple[Path, Path] | None = None,
    renombrados: frozenset[str] = frozenset(),
) -> Iterator[str]:
    """Recorre las alarmas que detienen la sustitución (criterios del README, «Actualización por módulos»).

    Args:
        filas: Las filas de la comparación del paquete.
        paquetes: Carpetas comparadas; sin ellas no se concede la excepción de oferta SOC.
        renombrados: Los que desaparecen porque su sucesor sale de los mismos validados (no son una caída).

    Yields:
        Una alarma por archivo que desaparece o por entrada fijada o con vectores que cambia.
    """
    for fila in filas:
        nombre, estado = fila["archivo"], fila["estado"]
        if estado == DESAPARECE and nombre not in renombrados:
            yield f"{nombre} desaparece del paquete"
        solo_oferta, _ = _oferta_de_formacion(fila, paquetes)
        if estado == CAMBIA and nombre in FIJADOS and not solo_oferta:
            yield f"{nombre} cambia y es una entrada fijada de los análisis publicados"
        if estado == CAMBIA and nombre in CON_VECTORES and not solo_oferta:
            yield f"{nombre} cambia: los vectores de significado quedarían desfasados (regenerarlos a propósito)"


def perdidas_del_paquete(
    filas: list[FilaDelPaquete],
    *,
    paquetes: tuple[Path, Path] | None = None,
    explicadas: Mapping[str, Explicada] | None = None,
) -> Iterator[Perdida]:
    """Recorre los archivos que pierden, sin explicar, más de PERDIDA_MAXIMA de sus cursos SOC o de sus entradas.

    Lo que la regla de retirada activa retira con su evidencia está explicado: lo nuevo se compara con lo publicado
    sin esas unidades. Las cifras de la pérdida son siempre las reales de cada lado.

    Args:
        filas: Las filas de la comparación del paquete.
        paquetes: Carpetas comparadas; sin ellas no se cuentan los cursos SOC.
        explicadas: Por archivo, lo que explica la regla activa de su fuente; sin ella, nada está explicado.

    Yields:
        Una pérdida por medida que supera el umbral, con sus cifras de antes y después.
    """
    for fila in filas:
        nombre = fila["archivo"]
        explicada = (explicadas or {}).get(nombre)
        _, cursos = _oferta_de_formacion(fila, paquetes)
        if cursos:
            # La lista de cursos SOC es la misma de la que la regla del SOC retira sus unidades.
            esperados = cursos[0] - (explicada.unidades if explicada else 0)
            if cursos[1] < (1 - PERDIDA_MAXIMA) * esperados:
                yield {"archivo": nombre, "medida": "cursos SOC", "antes": cursos[0], "despues": cursos[1]}
        # Un archivo que cambia está en los dos manifiestos: tiene los dos lados.
        if fila["estado"] == CAMBIA and fila["antes"] and fila["despues"]:
            antes, despues = fila["antes"]["entradas"], fila["despues"]["entradas"]
            if despues < (1 - PERDIDA_MAXIMA) * (explicada.entradas if explicada else antes):
                yield {"archivo": nombre, "medida": "entradas", "antes": antes, "despues": despues}


def texto_de_perdida(perdida: Perdida) -> str:
    """Describe una pérdida para el informe y los avisos.

    Returns:
        Una frase con el archivo, la medida y sus cifras de antes y después.
    """
    return (
        f"{perdida['archivo']} pierde más del {PERDIDA_MAXIMA * 100:.0f} % de sus {perdida['medida']} "
        f"({perdida['antes']} → {perdida['despues']})"
    )


def huellas_de_originales(procedencia: Json) -> dict[str, str]:
    """Reúne la huella de cada original que registra una procedencia, esté donde esté dentro de ella.

    La recursión está limitada por la pila de Python y puede fallar antes que `json.loads` en entradas muy profundas.
    Las procedencias de la cadena tienen dos o tres niveles; si se repite un nombre de archivo, prevalece el último.

    Args:
        procedencia: El contenido de un procedencia.json, o una parte de él.

    Returns:
        {archivo: sha256} de cada objeto con «archivo» y «sha256».
    """
    if isinstance(procedencia, list):
        return {clave: valor for elemento in procedencia for clave, valor in huellas_de_originales(elemento).items()}
    if not isinstance(procedencia, dict):
        return {}
    propias = {procedencia["archivo"]: procedencia["sha256"]} if {"archivo", "sha256"} <= procedencia.keys() else {}
    for valor in procedencia.values():
        propias.update(huellas_de_originales(valor))
    return propias


def comparar_originales(raiz: Path, area: Path) -> list[FilaDeOriginales]:
    """Compara, por carpeta de originales, qué archivos cambian, aparecen o desaparecen.

    Args:
        raiz: La raíz del repositorio (lo vigente).
        area: El área de ensayo (lo nuevo).

    Returns:
        Una fila por carpeta con algún cambio, en orden de nombre.
    """
    filas: list[FilaDeOriginales] = []
    rutas = {
        ruta.relative_to(base)
        for base in (raiz, area)
        for ruta in (base / DATOS_RELATIVOS / "originales").glob("*/procedencia.json")
    }
    for relativa in sorted(rutas):
        ruta_de_procedencia = area / relativa
        antes = huellas_de_originales(_leer_json_si_existe(raiz / relativa))
        despues = huellas_de_originales(_leer_json_si_existe(ruta_de_procedencia))
        cambian = sorted(archivo for archivo in despues if archivo in antes and antes[archivo] != despues[archivo])
        nuevos = sorted(set(despues) - set(antes))
        quitados = sorted(set(antes) - set(despues))
        if cambian or nuevos or quitados:
            filas.append(
                {"carpeta": ruta_de_procedencia.parent.name, "cambian": cambian, "nuevos": nuevos, "quitados": quitados}
            )
    return filas


def comparar(
    raiz: Path, area: Path, exportado: bool = True, explicadas: Mapping[str, Explicada] | None = None
) -> Comparacion:
    """Compara los originales del área con los vigentes y, si se llegó a exportar, también el paquete.

    Args:
        raiz: La raíz del repositorio (lo vigente).
        area: El área de ensayo (lo nuevo).
        exportado: Si el paquete nuevo llegó a exportarse.
        explicadas: Lo que la regla de retirada activa explica de cada archivo (retiradas_explicadas).

    Returns:
        Las filas del paquete (None sin exportar), las de los originales y las alarmas.
    """
    originales = comparar_originales(raiz, area)
    if not exportado:
        return Comparacion(None, originales, [])
    vigente, nuevo = raiz / PAQUETE_RELATIVO, area / PAQUETE_RELATIVO
    manifiestos = (
        _leer_json_si_existe(vigente / "manifiesto.json") or {},
        _leer_json_si_existe(nuevo / "manifiesto.json") or {},
    )
    for manifiesto in manifiestos:
        exigir(isinstance(manifiesto, dict), "el manifiesto del paquete debe ser un objeto")
        exigir(
            all(re.fullmatch(r"[a-z0-9-]+\.json", nombre) for nombre in manifiesto),
            "el manifiesto solo puede declarar nombres simples de archivos JSON del paquete",
        )
    nombres = list(manifiestos[0]) + [nombre for nombre in manifiestos[1] if nombre not in manifiestos[0]]
    filas = [fila_del_paquete(nombre, vigente, nuevo, manifiestos) for nombre in nombres]
    return Comparacion(
        filas,
        originales,
        list(alarmas_del_paquete(filas, paquetes=(vigente, nuevo), renombrados=renombrados(manifiestos))),
        tuple(perdidas_del_paquete(filas, paquetes=(vigente, nuevo), explicadas=explicadas)),
    )


# ---------------------------------------------------------------------------------------------------------------------
# Fuentes manuales
# ---------------------------------------------------------------------------------------------------------------------


def fecha_del_dato(raiz: Path, carpeta: str) -> date | None:
    """Busca la fecha más reciente de obtención que registra la procedencia de una carpeta de originales.

    Args:
        raiz: La raíz del repositorio.
        carpeta: La carpeta, dentro de var/actualizacion/originales/.

    Returns:
        Esa fecha; None si no hay procedencia o no registra ninguna fecha.
    """
    ruta = raiz / DATOS_RELATIVOS / "originales" / carpeta / "procedencia.json"
    fechas = CLAVES_DE_FECHA.findall(ruta.read_text(encoding="utf-8")) if ruta.exists() else []
    return date.fromisoformat(max(fechas)) if fechas else None


def fecha_de_la_fuente(raiz: Path, nombre: str) -> date | None:
    """Obtención del original o revisión editorial, sin usar la fecha de validación.

    Returns:
        Fecha declarada por su productor, o None cuando no consta en la copia observada.
    """
    if nombre == "hechos_informe":
        from plataforma_datos.ia_y_trabajo.fuentes.hechos_informe.lector import fecha_revision

        return fecha_revision(raiz)
    originales = FUENTES[nombre].originales
    return fecha_del_dato(raiz, originales) if originales else None


def _fecha_catalogos_formacion(raiz: Path) -> date | None:
    """Conserva la antigüedad del componente manual, sin rejuvenecerlo con la oferta SOC.

    Returns:
        La fecha más antigua de los cinco originales de catálogo y el SEPE, o None si falta evidencia conocida.
    """
    originales = raiz / DATOS_RELATIVOS / "originales"
    try:
        documentos = [
            json.loads(
                (originales / nombre / "procedencia.json").read_text(encoding="utf-8"),
                object_pairs_hook=sin_claves_repetidas,
            )
            for nombre in ("formacion", "sepe")
        ]
    except (OSError, ValueError, RecursionError):
        return None
    formacion, sepe = documentos
    if not isinstance(formacion, dict) or not isinstance(sepe, dict) or not isinstance(formacion.get("archivos"), list):
        return None
    fechas = {}
    for entrada in formacion["archivos"]:
        if not isinstance(entrada, dict) or not isinstance(entrada.get("archivo"), str):
            return None
        archivo = entrada["archivo"]
        if re.fullmatch(PATRON_CURSOS, archivo):
            continue
        if archivo not in ORIGINALES_CATALOGOS_FORMACION or archivo in fechas:
            return None
        fechas[archivo] = entrada.get("descargado")
    valores = [*fechas.values(), sepe.get("descargado")]
    if set(fechas) != set(ORIGINALES_CATALOGOS_FORMACION) or not all(fecha_soc(valor) for valor in valores):
        return None
    return min(date.fromisoformat(valor) for valor in valores)


def estado_de_las_manuales(raiz: Path, hoy: date | None = None) -> list[FilaManual]:
    """Describe la fecha y la antigüedad de cada fuente que renueva una persona, y si conviene renovarla ya.

    Args:
        raiz: La raíz del repositorio.
        hoy: El día con que se cuenta la antigüedad; None, hoy en UTC.

    Returns:
        Una fila por fuente manual o redactada y por los catálogos manuales de formación, en el orden de FUENTES.
    """
    dia = hoy or hoy_utc()
    filas: list[FilaManual] = []
    for nombre, fuente in FUENTES.items():
        catalogos_formacion = nombre == "formacion"
        if fuente.politica not in (MANUAL, REDACTADA) and not catalogos_formacion:
            continue
        fecha = _fecha_catalogos_formacion(raiz) if catalogos_formacion else fecha_de_la_fuente(raiz, nombre)
        dias = (dia - fecha).days if fecha else None
        renovar = bool(fuente.renovar_dias and dias is not None and dias > fuente.renovar_dias)
        filas.append(
            {
                "fuente": nombre,
                "frecuencia": (
                    "catálogos EURES, SEPE, SOC y DigComp: revisión manual por edición; excluye oferta SOC diaria"
                    if catalogos_formacion
                    else fuente.frecuencia
                ),
                "fecha": fecha.isoformat() if fecha else None,
                "dias": dias,
                "renovar": renovar,
            }
        )
    return filas
