"""Actualización por módulos: conserva versiones válidas y se detiene si no puede asegurar su coherencia.

1. Copia el producto a un área externa sin perfiles, registros ni secretos; enlaza las dependencias instaladas.
2. Módulo por módulo, en el orden del registro: descarga según la política de cada fuente (FUENTES), en serie y con
   una pausa antes de cada fuente con red, prepara y valida. Con --en-paralelo, las descargas con red se adelantan en
   una cola por servidor mientras la serie sigue igual (descargas_en_paralelo.py); --en-serie es el modo por omisión.
   Si todo el módulo queda en verde, publica sus carpetas operativas de una vez, con su propio diario
   (sustitucion.py); la primera publicación de una carpeta declarada es automática y un corte la retira entera, y solo
   pide a una persona una carpeta publicada que el módulo ya no produce o que cambia entre archivo y carpeta
   (rutas_a_publicar.py). Si falla una orden o supera su plazo, conserva su última versión buena publicada: sus
   carpetas del área vuelven a ser las publicadas, de modo que los módulos siguientes solo leen versiones publicadas.
   Si un módulo conservado lee de otro que acaba de publicar una versión nueva, o conserva un rojo previo, se valida
   otra vez con sus entradas actuales.
3. El módulo final exporta los datos y compara el paquete nuevo con el vigente. Un archivo que pierde más del 20 % de
   sus entradas o de sus cursos SOC queda en cuarentena: él y los que salen de sus mismas entradas conservan su versión
   publicada, y el resto sigue (cuarentena_del_paquete.elegir_cuarentena). Compone, coteja la web construida y comprueba
   los datos (verificar:datos; la batería completa la exige publicar el código); las ALARMAS lo paran. En verde, cambia
   datos/, web/ y el mapa CSP con un único diario recuperable y registra la cuarentena (ejecuciones/cuarentena.json),
   con un aviso por archivo que entra en ella. --aceptar-cuarentena ARCHIVO deja aceptado su cambio para la siguiente
   ejecución. Ejecutar sobre una instalación que no esté atendiendo tráfico: varios
   renombrados no son una publicación atómica ante lectores concurrentes. Un fallo conserva la versión anterior.
4. Veredicto: «verde» (todo publicado o sin cambios; código 0), «ámbar» (algún módulo conserva su última versión
   buena; código 3) o «rojo» (incoherencia o error interno de orquestación; código 1). Si el área no se puede
   devolver a lo publicado, la actualización se detiene: los módulos siguientes no leerían solo versiones publicadas.

Un cerrojo impide que dos actualizaciones corran a la vez, y cada una empieza recuperando lo publicado si un corte
anterior dejó un módulo a medias. Al final, var/actualizacion/ejecuciones/estado.json guarda el estado de cada módulo
y su próximo reintento, y avisa de cada cambio de veredicto (estado_de_la_actualizacion.py). Con --pendientes solo se
ejecutan los módulos cuyo reintento ha vencido, también tras un corte que no llegó a escribir el estado (su intento
consta en el registro de comprobaciones), y se recomponen sin descarga sus consumidores si cambian sus entradas
publicadas (y el paquete). Solo un intento remoto fallido de ese registro vuelve a descargar: un fallo local se
reintenta sin consultar la fuente. Si Biblioteca o acreditación fallan tras descargar, sus capturas se conservan aparte
como evidencia no admitida (retener_capturas) antes de devolver el área a lo publicado.
Si esa evidencia no se puede escribir, las capturas se rescatan junto a la carpeta temporal y la salida dice dónde.
--programada selecciona las consultas oficiales vencidas; --buscar-actualizaciones las solicita a demanda.
Ambas conservan el alcance y los fallos por conjunto, sin atribuir comprobación remota a una reconstrucción local.

Tras los pasos y la comparación, escribe un informe fechado (Markdown y JSON) en la carpeta de ejecuciones,
con los fallos registrados, los cambios y la fecha de las fuentes manuales: dice cuáles conviene renovar.
Los errores al preparar el área, leer la comparación o escribir el informe pueden interrumpir ese registro.
Python estándar.

Las órdenes del área heredan solo las variables de ENTORNO_HEREDADO, incluida FARO_HOY. Se añade la política de
red de npm y, en Linux, la biblioteca de Python. Las claves y los perfiles no llegan a las descargas ni a las pruebas.

Uso: python3 -m plataforma_datos.orquestacion.actualizar [--ensayo] [--pendientes] [--area DIR]
         [--conservar-area] [--pausa S] [--en-serie | --en-paralelo]
         [--sin-descargar FUENTE]...
     python3 -m plataforma_datos.orquestacion.actualizar --programada | --buscar-actualizaciones
     python3 -m plataforma_datos.orquestacion.actualizar --aceptar-cuarentena ARCHIVO...
"""

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, NamedTuple

from plataforma_datos.comun.entrada_salida import temporal_hermano
from plataforma_datos.comun.nucleo import ERRORES_CON_MOTIVO, RAIZ
from plataforma_datos.comun.red import agente_de_usuario
from plataforma_datos.cursos.fallos_almacen import codigo_en
from plataforma_datos.orquestacion import comprobaciones_remotas, errores_de_actualizacion, ordenes, sustitucion
from plataforma_datos.orquestacion.area_de_ensayo import NO_SE_COPIA as NO_SE_COPIA
from plataforma_datos.orquestacion.area_de_ensayo import comprobar_area, preparar_area
from plataforma_datos.orquestacion.area_de_ensayo import es_secreto as es_secreto
from plataforma_datos.orquestacion.cuarentena_del_paquete import (
    aceptar_desde_la_cli,
    motivo_del_paquete,
    poner_en_cuarentena,
    registrar_cuarentena,
)
from plataforma_datos.orquestacion.descargas_en_paralelo import PlanDeDescargas, Ronda, adelantar_descargas
from plataforma_datos.orquestacion.ejecucion_observada import etapa_de_fuente, recepcion_de_orden
from plataforma_datos.orquestacion.estado_de_la_actualizacion import (
    AMBAR,
    ROJO,
    VERDE,
    Intento,
    ResultadoDelModulo,
    bloquear_paquete,
    hay_rojo_que_bloquea,
    leer_estado,
    pendientes,
    registrar_estado,
)
from plataforma_datos.orquestacion.hora_limite_del_motor import MOTIVO as MOTIVO_SIN_TIEMPO
from plataforma_datos.orquestacion.hora_limite_del_motor import queda_tiempo
from plataforma_datos.orquestacion.informe_de_la_actualizacion import Resumen, escribir_informe
from plataforma_datos.orquestacion.migrar_estado_actualizacion import ampliar_al_arrancar, aviso_del_estado
from plataforma_datos.orquestacion.modulos import (
    CARPETA_DEL_PAQUETE as CARPETA_DEL_PAQUETE,
)
from plataforma_datos.orquestacion.modulos import (
    FUENTES_CON_CATALOGO,
    MODULOS,
    PAQUETE,
    Modulo,
    carpetas,
    comprobar_registro,
)
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPONER_EL_CATALOGO, ordenes_del_paquete, tope_de
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPROBACIONES as COMPROBACIONES
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COMPROBAR_LOS_DATOS as COMPROBAR_LOS_DATOS
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import COTEJO_DE_ARTEFACTOS as COTEJO_DE_ARTEFACTOS
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import ENSAMBLADO as ENSAMBLADO
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import EXPORTAR_EL_PAQUETE as EXPORTAR_EL_PAQUETE
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import PYTHON as PYTHON
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import REVALIDAR_EL_CATALOGO as REVALIDAR_EL_CATALOGO
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import RUTAS_DE_LA_ENTREGA as RUTAS_DE_LA_ENTREGA
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import Orden as Orden
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import (
    CARPETA_DE_INFORMES,
    ETAPA_DE_DESCARGA,
    FUENTES,
    Comparacion,
    comparar,
    estado_de_las_manuales,
    parametros_de_etapa,
)
from plataforma_datos.orquestacion.procesos import bibliotecas_de_python, ejecutar_con_plazo
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN, ORDEN, etapas
from plataforma_datos.orquestacion.restauracion_del_area import devolver_a_lo_publicado
from plataforma_datos.orquestacion.retiradas_explicadas import retiradas_explicadas
from plataforma_datos.orquestacion.rutas_a_publicar import rutas_a_publicar
from plataforma_datos.orquestacion.seguimiento_de_comprobaciones import (
    Seguimiento,
    plan_desde_registro,
    reintentos_remotos_vencidos,
)
from plataforma_datos.orquestacion.seleccion_por_tema import acotar_plan, exigir_seleccion_admitida, modo_del_ciclo
from plataforma_datos.orquestacion.sombra_del_ciclo import en_sombra

CODIGO_AMBAR = 3  # algún módulo conserva su última versión buena; 1 queda para el rojo y para el cerrojo ocupado
CODIGO_ROJO = 1
# Fuentes cuyas capturas de un ciclo fallido se conservan como evidencia no admitida, fuera de lo publicado.
FUENTES_CON_CAPTURAS_RETENIDAS = frozenset({"enlaces_lecturas", "acreditacion"})
CAPTURAS_NO_ADMITIDAS = f"{CARPETA_DE_INFORMES}/capturas-no-admitidas"
PAUSA_ANTES_DE_REINTENTAR = 60.0  # segundos antes de repetir una descarga que ha fallado
PAUSA_ENTRE_FUENTES = 2.0  # s antes de cada fuente con red: la pausa por dominio de red.py no pasa de un proceso a otro
TOPE_POR_ORDEN = 45 * 60  # segundos; la acreditación del BOE es la más lenta
# Códigos de salida de una orden que no llega a terminar, por convención: 124 si se pasa de su tiempo (timeout(1) de
# GNU coreutils) y 127 si no se puede ejecutar (el de la shell POSIX para una orden que no encuentra).
CODIGO_TIEMPO_AGOTADO = 124
CODIGO_NO_EJECUTABLE = 127
# Lo que heredan las órdenes del área del entorno de quien ejecuta: encontrar programas, su carpeta personal y su
# caché, el idioma, la zona horaria, la carpeta temporal y, si los hay, el proxy y los certificados para salir a la
# red. FARO_HOY permite reproducir la fecha de validación. No se heredan perfiles, claves ni programas de aviso.
ENTORNO_HEREDADO = (
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "PLAYWRIGHT_BROWSERS_PATH",
    "FARO_HUMO_CHROMIUM",
    "FARO_HOY",
    "FARO_TURNOS_ENTRE_PROCESOS",  # la carpeta de turnos por servidor de las descargas en paralelo
)


class Resultado(NamedTuple):
    """Salida y, cuando existe, observación estructurada del intento de descarga."""

    codigo: int
    salida: str
    evidencia: dict | None = None


Ejecutor = Callable[[Sequence[str], Path], Resultado]


class Veredicto(NamedTuple):
    """El veredicto de una actualización: su estado, que decide el código de salida, y el texto del informe."""

    estado: Literal["verde", "ámbar", "rojo"]
    texto: str


class Paso(NamedTuple):
    """Un paso de la actualización, con su resultado y su duración."""

    nombre: str
    codigo: int
    segundos: float
    salida: str

    @property
    def en_verde(self) -> bool:
        """Indica si el paso terminó bien.

        Returns:
            True si su código de salida es 0.
        """
        return self.codigo == 0


class OrdenNoAdmitida(Exception):
    """La fuente no admite la orden con que la invoca la actualización: error propio de la orquestación.

    Se detecta antes de ejecutar nada del módulo, así que no es una consulta remota ni un fallo del proveedor: no abre
    intento en el registro de comprobaciones, no se reintenta y el módulo queda en rojo como cualquier error interno.
    """


def exigir_orden_admitida(orden: Orden) -> None:
    """Comprueba la orden de una etapa contra el intérprete real de su lector, sin ejecutarla.

    Además de que el lector la admita, debe ser la orden canónica de su etapa (ejecucion_observada.etapa_de_fuente):
    una orden con otros parámetros se ejecutaría sin que el registro de comprobaciones anotara su intento.

    Raises:
        OrdenNoAdmitida: Si invoca otro módulo que el registrado para su fuente, el lector rechaza sus argumentos o no
            es exactamente la orden de su etapa.
    """
    if orden.fuente is None:
        return
    lector = dict(FUENTES_EN_ORDEN).get(orden.fuente)
    if lector is None or tuple(orden.orden[:3]) != (PYTHON, "-m", lector.__name__):
        raise OrdenNoAdmitida(f"{orden.nombre}: el módulo no es el lector registrado de la fuente")
    motivo = ordenes.motivo_de_rechazo(lector.main, orden.orden[3:])
    if motivo is not None:
        raise OrdenNoAdmitida(f"{orden.nombre}: la fuente no admite «{' '.join(orden.orden[3:])}»: {motivo}")
    if etapa_de_fuente(orden.orden) != (orden.fuente, orden.etapa):
        raise OrdenNoAdmitida(f"{orden.nombre}: «{' '.join(orden.orden[3:])}» no es la orden de su etapa")


def exigir_ordenes_del_modulo(modulo: Modulo, sin_descargar: tuple[str, ...]) -> dict[str, list[Orden]]:
    """Construye y comprueba todas las órdenes de un módulo antes de ejecutar ninguna.

    Returns:
        Las órdenes de cada fuente del módulo, en orden, todas admitidas.

    Raises:
        OrdenNoAdmitida: Si alguna orden de cualquiera de sus fuentes no es admitida.
    """
    por_fuente = {fuente: ordenes_de_la_fuente(fuente, sin_descargar) for fuente in modulo.fuentes}
    for orden in (orden for lista in por_fuente.values() for orden in lista):
        exigir_orden_admitida(orden)
    return por_fuente


class AreaNoRestaurada(sustitucion.RecuperacionIncompleta):
    """La restauración del área falló: conservarla y no ejecutar otros módulos."""


class PublicacionConcluidaConError(AreaNoRestaurada):
    """El diario acredita publicación terminada; no se inventa una reversión posterior."""


class CapturasSinRescatar(AreaNoRestaurada):
    """Las capturas no se pudieron conservar ni sacar del área: restaurarla las borraría."""


class RondaInterrumpida(Exception):
    """Resultados ya observados cuando no se puede continuar la ronda con seguridad."""

    def __init__(self, pasos: list[Paso], resultados: dict[str, ResultadoDelModulo]) -> None:
        super().__init__("Ronda interrumpida; conservar área y diagnóstico")
        self.pasos = list(pasos)
        self.resultados = dict(resultados)


class Opciones(NamedTuple):
    """Cómo se ejecuta una actualización."""

    ensayo: bool = False
    area: Path | None = None
    conservar_area: bool = False
    pausa: float = PAUSA_ENTRE_FUENTES
    sin_descargar: tuple[str, ...] = ()
    reintento: float = PAUSA_ANTES_DE_REINTENTAR
    solo: tuple[str, ...] | None = None  # selección inicial; sus publicaciones nuevas arrastran consumidores
    programada: bool = False
    a_demanda: bool = False  # con programada: lo vencido, pedido fuera del horario; el ciclo lo anota aparte
    forzar_comprobaciones: bool = False
    reintentar_pendientes: bool = False
    revisar_paquete_pendiente: bool = False
    en_paralelo: bool = False  # adelantar las descargas con red, una cola por servidor; por omisión, en serie
    fuentes_en_serie: tuple[str, ...] = ()  # con en_paralelo, las que descarga la serie como siempre


class ResultadoActualizacion(NamedTuple):
    """Resultado del intento real; no confunde cerrojo ocupado con una actualización terminada."""

    codigo: int
    comienzo: datetime | None
    informe: Path | None
    resultados: dict[str, ResultadoDelModulo]


def entorno_de_las_ordenes(entorno: Mapping[str, str]) -> dict[str, str]:
    """Filtra el entorno que heredan las órdenes del área.

    Args:
        entorno: El entorno del proceso que actualiza.

    Returns:
        Variables admitidas, política de npm y biblioteca del runtime; nunca una ruta ambiental.
    """
    filtrado = {nombre: valor for nombre, valor in entorno.items() if nombre in ENTORNO_HEREDADO}
    return {
        **filtrado,
        **bibliotecas_de_python(),
        "npm_config_user_agent": agente_de_usuario(),
        "npm_config_update_notifier": "false",
    }


def _ejecutar_proceso(orden: Sequence[str], area: Path, entorno: Mapping[str, str]) -> Resultado:
    """Obtiene un resultado incluso en fallo/plazo; la recepción se lee antes de retirar su carpeta.

    Returns:
        Código real o de fallo técnico y salida; ninguna evidencia se inventa aquí.
    """
    tope = tope_de(orden, TOPE_POR_ORDEN)
    try:
        hecho = ejecutar_con_plazo(orden, area, tope, entorno)
    except subprocess.TimeoutExpired:
        return Resultado(CODIGO_TIEMPO_AGOTADO, f"se pasó del tope de {tope} s")
    except OSError as error:
        return Resultado(CODIGO_NO_EJECUTABLE, f"no se pudo ejecutar {orden[0]}: {error}")
    return Resultado(hecho.returncode, hecho.stdout + hecho.stderr)


def ejecutar_orden(orden: Sequence[str], area: Path) -> Resultado:
    """Ejecuta una orden en el área de ensayo, con tope de tiempo y el entorno filtrado.

    Un fallo de ejecución o un plazo agotado devuelve un código distinto de 0. La salida se lee como UTF-8; los bytes
    inválidos se sustituyen por «�», sin depender del idioma del sistema.

    Args:
        orden: El programa y sus argumentos.
        area: La carpeta donde se ejecuta.

    Returns:
        Su código y su salida conjunta. Al superar el plazo de la orden devuelve CODIGO_TIEMPO_AGOTADO.
        Si no se puede ejecutar, devuelve CODIGO_NO_EJECUTABLE.
    """
    try:
        with recepcion_de_orden(orden, entorno_de_las_ordenes(os.environ)) as recepcion:
            resultado = _ejecutar_proceso(orden, area, recepcion.entorno)
            return resultado._replace(evidencia=recepcion.leer())
    except OSError as error:
        return Resultado(CODIGO_NO_EJECUTABLE, f"no se pudo ejecutar {orden[0]}: {error}")


# ---------------------------------------------------------------------------------------------------------------------
# Pasos
# ---------------------------------------------------------------------------------------------------------------------


def ordenes_de_la_fuente(nombre: str, sin_descargar: tuple[str, ...] = ()) -> list[Orden]:
    """Construye las órdenes de las etapas de una fuente.

    Los parámetros de cada etapa son los de piezas_de_la_actualizacion.parametros_de_etapa. Una fuente de
    `sin_descargar` no se descarga esta vez: se prepara y se valida con su copia vigente. Las etapas de cada fuente
    son las de la reconstrucción (reconstruir.etapas).

    Args:
        nombre: La fuente, clave de FUENTES.
        sin_descargar: Las fuentes que esta vez no se descargan.

    Returns:
        Una orden por etapa, en orden, con su fuente y su etapa.
    """
    modulo = dict(FUENTES_EN_ORDEN)[nombre].__name__
    return [
        Orden(f"{nombre} · {etapa}", [PYTHON, "-m", modulo, etapa, *parametros_de_etapa(nombre, etapa)], nombre, etapa)
        for etapa in etapas(nombre not in sin_descargar, nombre)
    ]


def ejecutar_pasos(area: Path, ejecutor: Ejecutor, ordenes: Sequence[Orden], opciones: Opciones) -> list[Paso]:
    """Ejecuta las órdenes en serie y se detiene en la primera que falla (las siguientes dependen de ella).

    Una descarga que falla se repite una vez tras `opciones.reintento` segundos: un servidor oficial que responde «504»
    un momento no debe dejar el mes en rojo. Una versión nueva vuelve a fallar igual, y entonces sí se detiene.
    Las órdenes de las fuentes llegan ya comprobadas por módulo (exigir_ordenes_del_modulo).

    Args:
        area: El área de ensayo.
        ejecutor: Lo que ejecuta cada orden.
        ordenes: Las órdenes, en orden.
        opciones: La pausa entre fuentes de red y la del reintento, en segundos.

    Returns:
        Un paso por orden ejecutada; si una falla, es el último.
    """
    _comprobar_esperas(opciones)
    pasos = []
    for orden in ordenes:
        descarga = orden.fuente is not None and orden.etapa == ETAPA_DE_DESCARGA
        if descarga and FUENTES[orden.fuente].red:
            time.sleep(opciones.pausa)
        print(f"== {orden.nombre}", flush=True)
        inicio = time.monotonic()
        resultado = ejecutor(orden.orden, area)
        if resultado.codigo and descarga:
            print(f"   falla; se repite dentro de {opciones.reintento:.0f} s", flush=True)
            time.sleep(opciones.reintento)
            resultado = ejecutor(orden.orden, area)
        pasos.append(Paso(orden.nombre, resultado.codigo, time.monotonic() - inicio, resultado.salida))
        if resultado.codigo:
            print(f"   rojo (código {resultado.codigo})", flush=True)
            break
    return pasos


# ---------------------------------------------------------------------------------------------------------------------
# Módulos: cada uno se ejecuta, se publica o se conserva por su cuenta
# ---------------------------------------------------------------------------------------------------------------------


def diario(modulo: str) -> str:
    """Nombra el diario de la sustitución de un módulo, en var/actualizacion/ejecuciones/.

    Args:
        modulo: El identificador del módulo.

    Returns:
        El nombre del archivo del diario.
    """
    return f"diario-{modulo}.json"


def huella(raiz: Path, rutas: tuple[str, ...]) -> str:
    """Calcula la huella SHA-256 de carpetas y archivos: identifica una versión publicada.

    Args:
        raiz: La raíz desde la que se leen las rutas.
        rutas: Las rutas relativas a `raiz`; las que no existen no cuentan.

    Returns:
        El SHA-256 hexadecimal de la ruta y la huella de cada archivo.
    """
    arboles = {ruta: sustitucion.huellas_del_arbol(raiz / ruta) for ruta in rutas if (raiz / ruta).exists()}
    return hashlib.sha256(json.dumps(arboles, sort_keys=True).encode()).hexdigest()


def restaurar(raiz: Path, area: Path, rutas: tuple[str, ...], *, conservar_lecturas: bool = False) -> str:
    """Devuelve las carpetas del área a su versión publicada y lo comprueba; las que aún no se publicaron se retiran.

    Args:
        raiz: La raíz del repositorio (lo publicado).
        area: El área de ensayo.
        rutas: Las carpetas del módulo, relativas.
        conservar_lecturas: Si las lecturas nuevas de sus fuentes pasan antes a lo publicado (restauracion_del_area).

    Returns:
        El aviso de las lecturas ilegibles que no se conservaron; vacío si no hay ninguna.

    Raises:
        OSError: Si el área no queda igual que lo publicado.
    """
    aviso = devolver_a_lo_publicado(raiz, area, rutas, conservar=conservar_lecturas)
    if huella(area, rutas) != huella(raiz, rutas) or any(
        (area / ruta).exists() for ruta in rutas if not (raiz / ruta).exists()
    ):
        raise OSError(f"el área no ha vuelto a lo publicado en {', '.join(rutas)}")
    return aviso


def publicar(raiz: Path, area: Path, modulo: str, rutas: tuple[str, ...], ensayo: bool) -> ResultadoDelModulo:
    """Sustituye las rutas del módulo con recuperación conjunta; no sirve tráfico durante la sustitución.

    Args:
        raiz: La raíz del repositorio.
        area: El área de ensayo.
        modulo: El identificador del módulo, que nombra su diario.
        rutas: Sus carpetas o archivos, relativos. Una que lo publicado aún no tiene y el área sí se crea sola, salvo
            en el paquete; una que desaparece o cambia entre archivo y carpeta se publica a mano.
        ensayo: Si es un ensayo (no se publica nada).

    Returns:
        Verde, con la huella de lo publicado si se sustituyó.

    Raises:
        OSError: Si una ruta desaparece o cambia de tipo, o si la sustitución falla (ya deshecha: lo creado se retira).
    """
    presentes = rutas_a_publicar(raiz, area, rutas, crea=modulo != PAQUETE)
    nueva = huella(area, presentes)
    if nueva == huella(raiz, presentes):
        return ResultadoDelModulo(VERDE, "sin cambios")
    if ensayo:
        return ResultadoDelModulo(VERDE, "ensayo: no se publica")
    sustitucion.sustituir(raiz, area, presentes, diario(modulo))
    return ResultadoDelModulo(VERDE, "", nueva)


def _restaurar_o_detener(raiz: Path, area: Path, rutas: tuple[str, ...], modulo: str, *, lecturas: bool = False) -> str:
    """Usa el diario existente antes de devolver el área a lo realmente publicado; con `lecturas`, las conserva.

    Returns:
        El aviso de las lecturas ilegibles que no se conservaron; vacío si no hay ninguna.

    Raises:
        AreaNoRestaurada: Si falla recuperar la raíz o restaurar el área.
        PublicacionConcluidaConError: Si el diario acredita una publicación ya terminada.
    """
    try:
        recuperada = sustitucion.recuperar(raiz, rutas, diario(modulo))
        aviso = restaurar(raiz, area, rutas, conservar_lecturas=lecturas)
    except Exception as error:
        raise AreaNoRestaurada("No se pudo restaurar el área; conservar recuperación") from error
    if recuperada == "completada":
        raise PublicacionConcluidaConError("Diario concluido; detener para revisar el registro")
    return aviso


def _guardar_si_falta(ruta: Path, contenido: bytes) -> None:
    """Escribe un objeto direccionado por su huella; si ya existe, debe ser idéntico.

    Raises:
        OSError: Si el objeto existente no coincide o la escritura falla.
    """
    if ruta.exists():
        if ruta.read_bytes() != contenido:
            raise OSError(f"objeto de evidencia alterado: {ruta.name}")
        return
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with temporal_hermano(ruta.parent, prefijo=".retenida-") as archivo:
        archivo.write(contenido)
        archivo.flush()
        os.fsync(archivo.fileno())
    Path(archivo.name).replace(ruta)


def retener_capturas(raiz: Path, area: Path, fuente: str, originales: str, motivo: str) -> Path | None:
    """Conserva las capturas de un ciclo no admitido antes de devolver el área a lo publicado.

    Guarda cada archivo nuevo o cambiado de los originales del área por su huella (sin duplicar entre ciclos) y un
    manifiesto con la ruta original, el motivo y «admitido: false». Nada de esto entra en lo publicado ni cuenta
    como confirmación, y ningún proceso lo vuelve a leer: es evidencia conservada para auditar el intento. Incorporar
    algo de ella exige revisarla y hacerlo a mano.

    Returns:
        El manifiesto, o None si el ciclo no dejó archivos distintos de lo publicado.

    Raises:
        OSError: Si no se puede leer el área o escribir la evidencia; el llamador lo anota en el motivo.
    """
    origen, vigente = area / originales, raiz / originales
    archivos = []
    for ruta in sorted(origen.rglob("*")) if origen.is_dir() else ():
        if ruta.is_symlink() or not ruta.is_file():
            continue
        relativa = ruta.relative_to(origen)
        contenido = ruta.read_bytes()
        publicado = vigente / relativa
        if publicado.is_file() and not publicado.is_symlink() and publicado.read_bytes() == contenido:
            continue
        huella_archivo = hashlib.sha256(contenido).hexdigest()
        _guardar_si_falta(raiz / CAPTURAS_NO_ADMITIDAS / fuente / "objetos" / huella_archivo, contenido)
        archivos.append({"ruta": relativa.as_posix(), "sha256": huella_archivo, "bytes": len(contenido)})
    if not archivos:
        return None
    manifiesto = {
        "fuente": fuente,
        "retenido_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "admitido": False,
        "motivo": motivo,
        "archivos": archivos,
    }
    contenido = (json.dumps(manifiesto, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
    ruta = raiz / CAPTURAS_NO_ADMITIDAS / fuente / "intentos" / f"{hashlib.sha256(contenido).hexdigest()}.json"
    _guardar_si_falta(ruta, contenido)
    return ruta


def _carpeta_propia(area: Path, opciones: Opciones) -> Path:
    """La carpeta que la actualización crea y borra al terminar: la temporal del área propia o el área indicada.

    Returns:
        La carpeta que borra la limpieza final.
    """
    return area.parent if opciones.area is None else area


def _rescatar_capturas(area: Path, fuente: str, originales: str, opciones: Opciones) -> Path:
    """Saca del área los originales de una fuente cuya evidencia no se pudo escribir, para que restaurar no la borre.

    El rescate queda junto a la carpeta propia, fuera de lo que se restaura y de lo que borra la limpieza final, y en
    el mismo disco que el área: moverlo es un renombrado que no necesita espacio libre.

    Returns:
        La carpeta del rescate, con los originales del área en «originales».

    Raises:
        CapturasSinRescatar: Si tampoco se pueden mover; el área conserva entonces la única copia.
    """
    try:
        destino = Path(tempfile.mkdtemp(prefix=f"faro-capturas-{fuente}-", dir=_carpeta_propia(area, opciones).parent))
        shutil.move(area / originales, destino / "originales")
    except OSError as error:
        raise CapturasSinRescatar(f"No se pudieron conservar ni rescatar las capturas de {fuente}") from error
    return destino


def _conservar_evidencia(raiz: Path, area: Path, modulo: Modulo, opciones: Opciones, motivo: str) -> str:
    """Retiene las capturas de las fuentes descargadas en este ciclo y añade su manifiesto al motivo.

    Si la evidencia no se puede escribir, rescata las capturas fuera del área y anuncia dónde quedan.

    Returns:
        El motivo, con la ruta privada del manifiesto o del rescate si se retuvo algo.

    Raises:
        CapturasSinRescatar: Si no se pueden conservar ni rescatar; el área no debe restaurarse.
    """
    for indice, fuente in enumerate(modulo.fuentes):
        if fuente not in FUENTES_CON_CAPTURAS_RETENIDAS or fuente in opciones.sin_descargar:
            continue
        originales = carpetas(modulo)[3 * indice]
        try:
            manifiesto = retener_capturas(raiz, area, fuente, originales, motivo)
        except OSError as error:
            # Un fallo al escribir la evidencia no oculta el del ciclo ni impide conservar lo publicado.
            rescate = _rescatar_capturas(area, fuente, originales, opciones)
            print(f"No se pudieron conservar las capturas no admitidas de {fuente}; quedan rescatadas en {rescate}.")
            motivo += (
                f"; no se pudieron conservar las capturas no admitidas: {type(error).__name__}; rescatadas en {rescate}"
            )
            continue
        if manifiesto is not None:
            motivo += f"; capturas no admitidas conservadas: {manifiesto.relative_to(raiz).as_posix()}"
    return motivo


def ejecutar_modulo(
    raiz: Path, area: Path, modulo: Modulo, ejecutor: Ejecutor, opciones: Opciones
) -> tuple[list[Paso], ResultadoDelModulo]:
    """Ejecuta un módulo y lo publica; si algo falla, lo deja con su versión publicada (también en el área).

    Args:
        raiz: La raíz del repositorio.
        area: El área de ensayo.
        modulo: El módulo.
        ejecutor: Lo que ejecuta cada orden.
        opciones: Cómo se ejecuta la actualización.

    Returns:
        Sus pasos y su resultado: verde si publica o no cambia; ámbar ante fallos esperables.
        Un error interno se propaga tras restaurar; el bucle lo registra en rojo como fallo local.

    Raises:
        RecuperacionIncompleta: Si lo vigente necesita recuperar un respaldo antes de continuar.
        CapturasSinRescatar: Si las capturas no se pueden poner a salvo; el área queda sin restaurar.
        OSError: Si el área no vuelve a lo publicado tras un fallo.
    """
    pasos: list[Paso] = []
    rutas = carpetas(modulo)
    try:
        # Todas las órdenes del módulo se comprueban antes de la primera: un rechazo no deja una descarga a medias.
        por_fuente = exigir_ordenes_del_modulo(modulo, opciones.sin_descargar)
        for fuente, ordenes in por_fuente.items():
            if fuente in FUENTES_CON_CATALOGO and ordenes[0].etapa == ETAPA_DE_DESCARGA:
                # Una consulta fallida sigue siendo historia: conserva originales, no cambia el negocio admitido.
                recibidos = ejecutar_pasos(area, ejecutor, ordenes[:1], opciones)
                pasos += recibidos
                publicar(raiz, area, modulo.id, (rutas[0],), opciones.ensayo)
                if not recibidos[-1].en_verde:
                    motivo = f"{recibidos[-1].nombre} en rojo (código {recibidos[-1].codigo})"
                    break
                ordenes = ordenes[1:]
            hechos = ejecutar_pasos(area, ejecutor, ordenes, opciones)
            pasos += hechos
            if len(hechos) < len(ordenes) or not hechos[-1].en_verde:
                motivo = f"{hechos[-1].nombre} en rojo (código {hechos[-1].codigo})"
                break
        else:
            return pasos, publicar(raiz, area, modulo.id, rutas, opciones.ensayo)
    except sustitucion.RecuperacionIncompleta:
        raise
    except ERRORES_CON_MOTIVO as error:
        motivo = f"{type(error).__name__}: {error}"
    except Exception:
        _restaurar_o_detener(raiz, area, rutas, modulo.id)
        raise
    try:
        motivo = _conservar_evidencia(raiz, area, modulo, opciones, motivo)
    except CapturasSinRescatar:
        raise  # sin restaurar: el área guarda la única copia de las capturas y la ronda se detiene conservándola
    except BaseException:
        _restaurar_o_detener(raiz, area, rutas, modulo.id)
        raise
    motivo += _restaurar_o_detener(raiz, area, rutas, modulo.id, lecturas=not opciones.ensayo)
    return pasos, ResultadoDelModulo(AMBAR, motivo)


def revalidar(area: Path, modulo: Modulo, ejecutor: Ejecutor, rutas: tuple[str, ...], raiz: Path) -> bool:
    """Valida otra vez la versión publicada de un módulo con las entradas que acaban de cambiar; deja el área igual.

    Args:
        area: El área de ensayo.
        modulo: El módulo conservado.
        ejecutor: Lo que ejecuta cada orden.
        rutas: Sus carpetas, relativas.
        raiz: La raíz del repositorio.

    Returns:
        True si todas sus fuentes validan; False ante un código no válido o un error esperable.
        Los errores internos se propagan después de la restauración.
    """
    try:
        validas = all(
            ejecutor([PYTHON, "-m", dict(FUENTES_EN_ORDEN)[fuente].__name__, "validar"], area).codigo == 0
            for fuente in modulo.fuentes
        )
    except ERRORES_CON_MOTIVO:
        validas = False
    finally:
        _restaurar_o_detener(raiz, area, rutas, modulo.id)
    return validas


def _entradas_incompatibles(modulo: Modulo, incompatibles: set[str]) -> list[str]:
    """Propaga el bloqueo a través de omitidos sin registrar intentos.

    Returns:
        Entradas directas bloqueadas, por orden del registro.
    """
    entradas = [entrada for entrada in modulo.entradas if entrada in incompatibles]
    if entradas:
        incompatibles.add(modulo.id)
    return entradas


def _recordar_resultado(incompatibles: set[str], nombre: str, resultado: ResultadoDelModulo) -> None:
    """Una reparación acreditada sustituye el rojo previo dentro de esta ronda."""
    if resultado.veredicto == ROJO:
        incompatibles.add(nombre)
    else:
        incompatibles.discard(nombre)


def _diagnosticar_error(
    raiz: Path, area: Path, modulo: Modulo, error: Exception
) -> tuple[Paso, ResultadoDelModulo, bool]:
    """Prepara el rojo local y su evidencia; continuar exige restauración y registro.

    Returns:
        Paso fallido, resultado local y permiso de continuar módulos independientes.
    """
    segura = not isinstance(error, sustitucion.RecuperacionIncompleta)
    if not segura:
        print(f"Recuperación incompleta: {error}; se conserva el área {area}.")
    diagnostico = errores_de_actualizacion.registrar(raiz, modulo.id, error, area_restaurada=segura)
    motivo = f"error interno de orquestación: {type(error).__name__}"
    salida = json.dumps(diagnostico.documento, ensure_ascii=False)
    if isinstance(error, OrdenNoAdmitida):
        # Su texto lo compone la orquestación (rótulo, argumentos propios y error del intérprete), sin rutas ni entorno;
        # el de otros errores internos no se conserva.
        motivo += f" ({error})"
        salida = f"{error}\n{salida}"
    if diagnostico.ruta is not None:
        motivo += f"; diagnóstico privado: {diagnostico.ruta.relative_to(raiz)}"
    else:
        motivo += "; no se pudo guardar el diagnóstico privado"
    paso = Paso(f"Error de orquestación · {modulo.id}", CODIGO_ROJO, 0, salida)
    return paso, ResultadoDelModulo(ROJO, motivo), segura and diagnostico.ruta is not None


def ejecutar_modulos(
    raiz: Path, area: Path, ejecutor: Ejecutor, opciones: Opciones, seguimiento: Seguimiento | None = None
) -> tuple[list[Paso], dict[str, ResultadoDelModulo]]:
    """Recorre los módulos en serie; con `opciones.en_paralelo`, sus descargas con red llegan ya adelantadas.

    Returns:
        Los pasos de todos los módulos y el resultado de cada uno (_ejecutar_modulos).
    """
    plan = PlanDeDescargas(MODULOS, exigir_ordenes_del_modulo)
    with adelantar_descargas(plan, area, ejecutor, opciones) as ronda:
        return _ejecutar_modulos(raiz, area, ronda, ronda.opciones, seguimiento)


def _ejecutar_modulos(
    raiz: Path, area: Path, ronda: Ronda, opciones: Opciones, seguimiento: Seguimiento | None
) -> tuple[list[Paso], dict[str, ResultadoDelModulo]]:
    """Ejecuta la selección y recompone consumidores de entradas publicadas nuevas, en orden del registro.

    Los consumidores omitidos preparan y validan sus originales conservados, sin descargar. Solo una publicación
    real propaga el cambio: un ensayo no publica y conserva la selección inicial. Las entradas rojas bloquean
    sus descendientes sin ejecutarlos; los módulos independientes continúan. Los omitidos conservan su estado.
    Los errores internos conservan una traza privada y nunca se atribuyen a la fuente.
    Solo se continúa si el área se restauró y se pudo guardar el diagnóstico.

    Args:
        raiz: La raíz del repositorio.
        area: El área de ensayo.
        ronda: Lo que ejecuta cada orden y el aviso de cada módulo al que se llega (descargas_en_paralelo).
        opciones: Cómo se ejecuta la actualización (`solo`: la selección inicial, None para todos).
        seguimiento: Registro de consultas, cerrado solo después de admitir o conservar cada módulo.

    Returns:
        Los pasos de todos los módulos y el resultado de cada uno.

    Raises:
        RondaInterrumpida: Si la restauración o el diagnóstico no permiten continuar con seguridad.
    """
    ejecutor = ronda.ejecutar
    previos = leer_estado(raiz)
    incompatibles = {modulo.id for modulo in MODULOS if previos.get(modulo.id, {}).get("veredicto") == ROJO}
    pasos: list[Paso] = []
    resultados: dict[str, ResultadoDelModulo] = {}
    for modulo in MODULOS:
        ronda.llega(modulo.id, incompatibles)  # los anteriores ya están resueltos: sus descargas dependientes, también
        nuevas = [entrada for entrada in modulo.entradas if resultados.get(entrada, ResultadoDelModulo("")).publicado]
        entradas_rojas = _entradas_incompatibles(modulo, incompatibles)
        opciones_modulo = opciones
        if opciones.solo is not None and modulo.id not in opciones.solo:
            if not nuevas:
                continue
            opciones_modulo = opciones._replace(sin_descargar=(*opciones.sin_descargar, *modulo.fuentes))
        if entradas_rojas:
            resultados[modulo.id] = ResultadoDelModulo(
                ROJO, f"no se ejecuta: entradas sin compatibilidad acreditada: {entradas_rojas}"
            )
            continue
        if not queda_tiempo(raiz, modulo.id):
            # Lo ya hecho queda registrado; lo que falta no empieza, y el paquete tampoco (`ejecutar_paquete`).
            break
        try:
            hechos, resultado = ejecutar_modulo(raiz, area, modulo, ejecutor, opciones_modulo)
            if (
                resultado.veredicto == AMBAR
                and (nuevas or previos.get(modulo.id, {}).get("veredicto") == ROJO)
                and not revalidar(area, modulo, ejecutor, carpetas(modulo), raiz)
            ):
                entradas = nuevas or list(modulo.entradas)
                resultado = ResultadoDelModulo(
                    ROJO, f"{resultado.motivo}; su versión publicada no valida con {entradas}"
                )
        except Exception as error:
            paso, resultado, continuar = _diagnosticar_error(raiz, area, modulo, error)
            pasos.append(paso)
            resultados[modulo.id] = resultado
            _recordar_resultado(incompatibles, modulo.id, resultado)
            if not continuar:
                raise RondaInterrumpida(pasos, resultados) from error
            continue
        pasos += hechos
        resultados[modulo.id] = resultado
        _recordar_resultado(incompatibles, modulo.id, resultado)
        if seguimiento is not None:
            seguimiento.terminar_modulo(modulo, resultado)
    return pasos, resultados


def _ejecutar_ronda(
    raiz: Path, area: Path, ejecutor: Ejecutor, opciones: Opciones, seguimiento: Seguimiento | None
) -> tuple[list[Paso], dict[str, ResultadoDelModulo], bool]:
    try:
        pasos, resultados = ejecutar_modulos(raiz, area, ejecutor, opciones, seguimiento)
        return pasos, resultados, False
    except RondaInterrumpida as error:
        return error.pasos, error.resultados, True


def ejecutar_paquete(
    raiz: Path, area: Path, ejecutor: Ejecutor, opciones: Opciones
) -> tuple[list[Paso], Comparacion, ResultadoDelModulo]:
    """Exporta, aplica la cuarentena, ensambla y comprueba la entrega; solo entonces sustituye datos, web y mapa CSP.

    La cuarentena se aplica justo después de exportar: la composición, el ensamblado, las pruebas y el cotejo de la web
    trabajan ya con el paquete que se publicaría, así que acreditan su coherencia o lo dejan en ámbar. Si antes de la
    hora límite del motor no cabe el paquete (`hora_limite_del_motor`), no empieza y queda en ámbar con su motivo.

    Args:
        raiz: La raíz del repositorio.
        area: El área de ensayo.
        ejecutor: Lo que ejecuta cada orden.
        opciones: Cómo se ejecuta la actualización.

    Returns:
        Sus pasos, la comparación del paquete nuevo con el vigente (con su cuarentena) y su resultado.

    Raises:
        RecuperacionIncompleta: Si el paquete requiere revisión del diario y su respaldo.
    """
    if not queda_tiempo(raiz, PAQUETE):
        return [], Comparacion(None, [], []), ResultadoDelModulo(AMBAR, MOTIVO_SIN_TIEMPO)
    ordenes = list(ordenes_del_paquete(os.environ))
    pasos = ejecutar_pasos(area, ejecutor, ordenes[:1], opciones)
    exportado = bool(pasos) and pasos[0].en_verde
    try:
        # Lo que la regla de retirada activa quitó con su evidencia no es una pérdida sin explicar.
        comparacion = comparar(raiz, area, exportado, retiradas_explicadas(raiz, area) if exportado else None)
    except Exception as error:
        if not exportado:
            # La comparación no debe borrar los respaldos que pudo dejar el subproceso fallido.
            raise sustitucion.RecuperacionIncompleta(
                f"la exportación y su diagnóstico fallaron; conservar el área {area}: {error}"
            ) from error
        raise
    if exportado:
        comparacion = poner_en_cuarentena(raiz, area, comparacion)
        pasos += ejecutar_pasos(area, ejecutor, ordenes[1:], opciones)
    if len(pasos) < len(ordenes) or not pasos[-1].en_verde:
        motivo = f"{pasos[-1].nombre} en rojo (código {pasos[-1].codigo})"
        # El código del almacén de Cursos llega al panel como valor cerrado (estado_panel); el resto, al informe.
        fallo = codigo_en(pasos[-1].salida) if pasos[-1].nombre == COMPONER_EL_CATALOGO.nombre else None
        return pasos, comparacion, ResultadoDelModulo(AMBAR, motivo if fallo is None else f"{motivo}: {fallo}")
    if comparacion.alarmas:
        return pasos, comparacion, ResultadoDelModulo(AMBAR, "; ".join(comparacion.alarmas))
    try:
        resultado = publicar(raiz, area, PAQUETE, RUTAS_DE_LA_ENTREGA, opciones.ensayo)
    except sustitucion.RecuperacionIncompleta:
        raise
    except OSError as error:
        return pasos, comparacion, ResultadoDelModulo(AMBAR, f"no se pudo sustituir: {error}")
    return pasos, comparacion, motivo_del_paquete(resultado, comparacion)


# ---------------------------------------------------------------------------------------------------------------------
# Orquestación
# ---------------------------------------------------------------------------------------------------------------------


def decidir(
    resultados: dict[str, ResultadoDelModulo], ensayo: bool, conservados_de_apoyo: Sequence[str] = ()
) -> Veredicto:
    """Decide el veredicto: rojo si un módulo quedó en rojo; ámbar si alguno conserva su versión; si no, verde.

    El rojo de un módulo de apoyo no bloquea: cuenta como una versión conservada.

    Args:
        resultados: El resultado de cada módulo ejecutado.
        ensayo: Si es un ensayo (el texto lo dice).
        conservados_de_apoyo: Módulos de apoyo en rojo desde un ciclo anterior que este no ejecutó.

    Returns:
        El estado y su texto para el informe (con los módulos conservados, o «(ensayo)»).
    """
    if hay_rojo_que_bloquea(resultados):
        return Veredicto(ROJO, ROJO)
    # Pasado el rojo que bloquea, el que quede es de un módulo de apoyo: conserva su versión anterior.
    conservados = [modulo for modulo, resultado in resultados.items() if resultado.veredicto in (AMBAR, ROJO)]
    conservados += conservados_de_apoyo
    if conservados:
        return Veredicto(AMBAR, f"{AMBAR} (conservan su última versión buena: {', '.join(conservados)})")
    return Veredicto(VERDE, f"{VERDE} (ensayo)" if ensayo else VERDE)


CODIGO_DE_SALIDA = {VERDE: 0, AMBAR: CODIGO_AMBAR, ROJO: CODIGO_ROJO}


def recuperar_todo(raiz: Path) -> list[str]:
    """Deja entero lo publicado de cada módulo y del paquete si un corte anterior lo dejó a medias.

    Args:
        raiz: La raíz del repositorio.

    Returns:
        Los módulos cuya sustitución cortada se ha resuelto.
    """
    hechas = []
    for modulo, rutas in [*((modulo.id, carpetas(modulo)) for modulo in MODULOS), (PAQUETE, RUTAS_DE_LA_ENTREGA)]:
        if sustitucion.recuperar(raiz, rutas, diario(modulo)):
            hechas.append(modulo)
    return hechas


def actualizar(raiz: Path, opciones: Opciones, ejecutor: Ejecutor = ejecutar_orden) -> int:
    """Ejecuta la actualización completa, con su cerrojo.

    Si otra actualización tiene el cerrojo, no se hace nada (ni área, ni informe, ni estado).

    Args:
        raiz: La raíz del repositorio.
        opciones: Cómo se ejecuta.
        ejecutor: Lo que ejecuta cada orden.

    Returns:
        0 en verde, CODIGO_AMBAR en ámbar y CODIGO_ROJO en rojo o con el cerrojo ocupado.
    """
    return actualizar_con_resultado(raiz, opciones, ejecutor).codigo


def actualizar_con_resultado(
    raiz: Path,
    opciones: Opciones,
    ejecutor: Ejecutor = ejecutar_orden,
    *,
    comprobar_entrada: Callable[[Path, datetime], object] | None = None,
) -> ResultadoActualizacion:
    """Ejecuta el mismo motor y conserva su resultado estructurado, bajo el mismo cerrojo.

    Args:
        raiz: Raíz operativa, fuera del árbol que sirve tráfico.
        opciones: Opciones de la actualización.
        ejecutor: Ejecutor de las órdenes fijadas por el motor.
        comprobar_entrada: Comprobación interna del llamador, tras recuperar y bajo el mismo cerrojo.

    Returns:
        Código y resultado del intento; sin comienzo/informe si no pudo completarse.
    """
    raiz = raiz.resolve()
    _comprobar_opciones(opciones)
    if opciones.area is not None:
        comprobar_area(raiz, opciones.area)
    fallos = comprobar_registro()
    if fallos:
        print("No se actualiza: registro incoherente: " + "; ".join(fallos))
        return ResultadoActualizacion(CODIGO_ROJO, None, None, {})
    try:
        with sustitucion.cerrojo(raiz):
            comienzo = datetime.now(UTC)
            recuperados = recuperar_todo(raiz)
            if recuperados:
                print(f"Sustituciones cortadas, ya resueltas: {', '.join(recuperados)}. Lo publicado está entero.")
            if not opciones.ensayo and ampliar_al_arrancar(raiz):
                print("Estado ampliado con los módulos nuevos del registro; el anterior queda en su respaldo.")
            # Un estado que no se puede leer tal cual detiene el ciclo con una línea que dice qué orden lo resuelve.
            if aviso := aviso_del_estado(raiz, ensayo=opciones.ensayo):
                print(aviso)
                return ResultadoActualizacion(CODIGO_ROJO, None, None, {})
            if comprobar_entrada is not None:
                comprobar_entrada(raiz, comienzo)
            seleccion = _opciones_programadas(raiz, opciones, comienzo)
            if seleccion is None:
                return ResultadoActualizacion(0, None, None, {})
            seguimiento = None
            if not seleccion.ensayo:
                comprobaciones_remotas.migrar_registro(raiz)
                ciclo = comprobaciones_remotas.iniciar_ciclo(raiz, comienzo, modo_del_ciclo(seleccion))
                seguimiento = Seguimiento(raiz, ciclo, ejecutor, lambda: datetime.now(UTC))
                ejecutor = seguimiento.ejecutar
            with en_sombra(raiz, ensayo=seleccion.ensayo):
                return _actualizar(raiz, seleccion, ejecutor, comienzo, seguimiento)
    except (sustitucion.ActualizacionEnCurso, sustitucion.RecuperacionIncompleta) as error:
        print(f"No se actualiza: {error}.")
        return ResultadoActualizacion(CODIGO_ROJO, None, None, {})


def _cerrar_seguimiento(seguimiento: Seguimiento | None, raiz: Path, resultados: dict[str, ResultadoDelModulo]) -> None:
    if seguimiento is not None:
        preparado = resultados.get(PAQUETE, ResultadoDelModulo(ROJO)).veredicto == VERDE
        comprobaciones_remotas.cerrar_ciclo(
            raiz,
            seguimiento.ciclo,
            datetime.now(UTC),
            resultado="preparado" if preparado else "fallo",
            paquete_preparado=preparado,
        )


def _actualizar(
    raiz: Path, opciones: Opciones, ejecutor: Ejecutor, comienzo: datetime, seguimiento: Seguimiento | None
) -> ResultadoActualizacion:
    """Ejecuta la actualización, ya con el cerrojo y lo publicado recuperado antes de seleccionar.

    El área propia se borra al terminar, salvo `conservar_area` o una recuperación incompleta que exige revisión.

    Args:
        raiz: La raíz del repositorio.
        opciones: Cómo se ejecuta.
        ejecutor: Lo que ejecuta cada orden.
        comienzo: Instante real anterior a la recuperación y a cualquier efecto sobre datos.
        seguimiento: Ciclo registrado, o None si es un ensayo.

    Returns:
        Código, comienzo, informe y resultados de este mismo intento.

    Raises:
        FileExistsError: Si otro proceso reservó el destino; se conserva.
        RecuperacionIncompleta: Si el diario y el área necesitan revisión.
    """
    inicio = time.monotonic()
    area = opciones.area or Path(tempfile.mkdtemp(prefix="faro-actualizacion-")) / "repositorio"
    comprobar_area(raiz, area)
    conservar = opciones.conservar_area
    try:
        # Sobre lo publicado y antes de copiar el área: así lo leen igual las fuentes, el área y el seguimiento. Si no
        # supera la auditoría, el paso queda en rojo en el informe y las fuentes de cursos fallan con su motivo.
        revalidacion = ejecutar_pasos(raiz, ejecutor, [REVALIDAR_EL_CATALOGO], opciones)
        preparar_area(raiz, area)
        pasos, resultados, interrumpida = _ejecutar_ronda(raiz, area, ejecutor, opciones, seguimiento)
        pasos = [*revalidacion, *pasos]
        conservar = conservar or interrumpida
        de_apoyo_en_rojo = bloquear_paquete(raiz, resultados, interrumpida)
        comparacion = Comparacion(None, [], [])
        if not hay_rojo_que_bloquea(resultados):
            pasos_del_paquete, comparacion, resultados[PAQUETE] = ejecutar_paquete(raiz, area, ejecutor, opciones)
            pasos += pasos_del_paquete
            if pasos_del_paquete and pasos_del_paquete[0].codigo:
                # El subproceso puede haber conservado un respaldo tras una recuperación incompleta.
                conservar = True
                print(f"La exportación falló: se conserva el área {area} para revisar sus datos y respaldos.")
        veredicto = decidir(resultados, opciones.ensayo, de_apoyo_en_rojo)
        manuales = estado_de_las_manuales(raiz)
        resumen = Resumen(
            veredicto.texto, pasos, comparacion, manuales, time.monotonic() - inicio, opciones.sin_descargar
        )
        informe = escribir_informe(raiz, resumen)
        if not opciones.ensayo and resultados.get(PAQUETE, ResultadoDelModulo(ROJO)).veredicto == VERDE:
            registrar_cuarentena(raiz, comparacion, comienzo)
        registrar_estado(
            raiz, resultados, Intento(comienzo, veredicto.texto, informe), recompuestos=_recompuestos(opciones)
        )
        _cerrar_seguimiento(seguimiento, raiz, resultados)
    except sustitucion.RecuperacionIncompleta:
        conservar = True
        print(f"Recuperación incompleta: se conserva el área {area} y su respaldo para revisión.")
        raise
    except BaseException as error:
        # Una interrupción conserva recuperación; un destino reservado por otro nunca es área propia.
        conservar = conservar or not isinstance(error, Exception) or isinstance(error, FileExistsError)
        raise
    finally:
        if not conservar:
            _borrar_carpeta_propia(_carpeta_propia(area, opciones))
    print(f"\nActualización en {veredicto.texto}. Informe: {informe.relative_to(raiz)}")
    return ResultadoActualizacion(CODIGO_DE_SALIDA[veredicto.estado], comienzo, informe, resultados)


def _borrar_carpeta_propia(carpeta: Path) -> None:
    """Borra los temporales de la actualización; si algo queda, lo anuncia sin cambiar el resultado.

    Un resto no afecta a lo publicado ni al veredicto, pero ocupa disco: quien ejecuta debe saber qué borrar.
    """
    shutil.rmtree(carpeta, ignore_errors=True)
    if carpeta.exists():
        print(f"No se pudo borrar el área temporal {carpeta}; bórrala a mano.")


def _recompuestos(opciones: Opciones) -> frozenset[str]:
    """Módulos que esta actualización ejecuta sin descargar ninguna de sus fuentes.

    Returns:
        Los consumidores arrastrados fuera de la selección y los módulos con todas sus fuentes sin descarga.
    """
    return frozenset(
        modulo.id
        for modulo in MODULOS
        if (opciones.solo is not None and modulo.id not in opciones.solo)
        or set(modulo.fuentes) <= set(opciones.sin_descargar)
    )


def _opciones_programadas(raiz: Path, opciones: Opciones, ahora: datetime) -> Opciones | None:
    """Calcula la selección bajo el cerrojo; una comprobación sin trabajo no renueva fechas.

    Returns:
        Opciones con permisos de descarga delimitados, o None si no hay trabajo automático.
    """
    if opciones.reintentar_pendientes:
        return _opciones_de_pendientes(raiz, opciones, ahora)
    if not opciones.programada and not opciones.forzar_comprobaciones:
        return opciones
    plan = acotar_plan(raiz, plan_desde_registro(raiz, ahora, forzar=opciones.forzar_comprobaciones), opciones.solo)
    if plan.revisiones:
        print("Conjuntos con revisión pendiente: " + ", ".join(plan.revisiones))
    if not plan.modulos:
        if opciones.revisar_paquete_pendiente:
            # El día de hoy puede cambiar la admisión. El paquete pasa otra vez por todas sus comprobaciones.
            return opciones._replace(solo=(PAQUETE,), sin_descargar=tuple(FUENTES))
        print("No hay consultas automáticas vencidas ni reconstrucción pendiente; no acredita vigencia global.")
        return None
    locales = tuple(fuente for fuente in FUENTES if fuente not in plan.fuentes)
    return opciones._replace(solo=plan.modulos, sin_descargar=tuple(dict.fromkeys((*opciones.sin_descargar, *locales))))


def _opciones_de_pendientes(raiz: Path, opciones: Opciones, ahora: datetime) -> Opciones | None:
    """Reintenta los módulos vencidos sin adelantar ninguna consulta remota.

    Solo el registro de comprobaciones (reintentos_remotos_vencidos) concede una descarga con red: allí constan los
    intentos remotos fallidos, también los cortados, que no llegan a escribir estado.json. Un módulo vencido solo en
    estado.json falló en local (una orden no admitida, una recomposición): se reintenta sin descargar sus fuentes con
    red, que vuelven con su cadencia.

    Returns:
        Opciones con la selección y sus fuentes sin descarga, o None si ningún reintento ha vencido.
    """
    remotos = set(reintentos_remotos_vencidos(raiz, ahora))
    locales = set(pendientes(raiz, ahora)) - remotos
    solo = tuple(modulo for modulo in (*(m.id for m in MODULOS), PAQUETE) if modulo in remotos | locales)
    if not solo:
        print("Ningún módulo tiene un reintento vencido.")
        return None
    sin_consulta = tuple(
        fuente for modulo in MODULOS if modulo.id in locales for fuente in modulo.fuentes if FUENTES[fuente].red
    )
    return opciones._replace(solo=solo, sin_descargar=tuple(dict.fromkeys((*opciones.sin_descargar, *sin_consulta))))


def _comprobar_esperas(opciones: Opciones) -> None:
    """Las pausas deben ser duraciones finitas y no negativas, también al usar la API Python.

    Raises:
        ValueError: Si una duración no es finita o es negativa.
    """
    for nombre, valor in (("pausa", opciones.pausa), ("reintento", opciones.reintento)):
        if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor) or valor < 0:
            raise ValueError(f"{nombre} debe ser un número finito no negativo")


def _comprobar_opciones(opciones: Opciones) -> None:
    """Valida la entrada antes de resolver la selección interna del plan.

    Raises:
        ValueError: Si la configuración externa combina modos o una segunda selección.
    """
    _comprobar_esperas(opciones)
    if type(opciones.revisar_paquete_pendiente) is not bool or (
        opciones.revisar_paquete_pendiente and not opciones.programada
    ):
        raise ValueError("la revisión de un paquete pendiente requiere la comprobación programada")
    if type(opciones.reintentar_pendientes) is not bool:
        raise ValueError("el modo de reintento debe ser booleano")
    if opciones.reintentar_pendientes and (
        opciones.programada or opciones.forzar_comprobaciones or opciones.solo is not None
    ):
        raise ValueError("el reintento de pendientes no admite otra selección")
    if type(opciones.programada) is not bool or type(opciones.forzar_comprobaciones) is not bool:
        raise ValueError("los modos de comprobación deben ser booleanos")
    if opciones.programada and opciones.forzar_comprobaciones:
        raise ValueError("la comprobación programada y la forzada son modos distintos")
    exigir_seleccion_admitida(opciones)


def _pausa_de_la_cli(texto: str) -> float:
    """Convierte la pausa y permite a argparse mostrar un error de uso sin comenzar la actualización.

    Returns:
        Segundos finitos no negativos.

    Raises:
        ArgumentTypeError: Si el argumento no representa una duración válida.
    """
    try:
        valor = float(texto)
        _comprobar_esperas(Opciones(pausa=valor))
    except ValueError as error:
        raise argparse.ArgumentTypeError("la pausa debe ser un número finito no negativo") from error
    return valor


def main(argv: list[str] | None = None) -> int:
    """Ejecuta la interfaz de línea de órdenes.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        El código de salida de la actualización; 0 si con --pendientes no hay ningún módulo vencido.
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("--ensayo", action="store_true", help="hacerlo todo menos sustituir lo vigente")
    seleccion = analizador.add_mutually_exclusive_group()
    seleccion.add_argument("--pendientes", action="store_true", help="solo los módulos cuyo reintento ha vencido")
    seleccion.add_argument("--programada", action="store_true", help="consultas oficiales cuya cadencia ha vencido")
    seleccion.add_argument(
        "--buscar-actualizaciones",
        action="store_true",
        help="comprobar las fuentes automáticas sin esperar su cadencia",
    )
    analizador.add_argument("--area", type=Path, help="carpeta (que no exista) para el área de ensayo")
    analizador.add_argument("--conservar-area", action="store_true", help="no borrar el área al terminar")
    modo = analizador.add_mutually_exclusive_group()
    # Las dos opciones comparten destino y argparse toma el valor por omisión de la primera: por eso va explícito.
    modo.add_argument("--en-serie", dest="en_paralelo", action="store_false", default=False, help="por omisión")
    modo.add_argument("--en-paralelo", action="store_true", help="adelantar las descargas, una cola por servidor")
    analizador.add_argument(
        "--pausa", type=_pausa_de_la_cli, default=PAUSA_ENTRE_FUENTES, help="segundos entre fuentes"
    )
    analizador.add_argument(
        "--sin-descargar",
        action="append",
        default=[],
        choices=ORDEN,
        metavar="FUENTE",
        help="no descargar esta fuente esta vez (se usa su copia vigente); se puede repetir",
    )
    seleccion.add_argument(
        "--aceptar-cuarentena",
        action="append",
        default=[],
        metavar="ARCHIVO",
        help=(
            "aceptar que un archivo en cuarentena baje hasta las cifras vistas: una ejecución posterior lo publica si "
            "su versión publicada es la misma, no trae menos entradas ni otra pérdida; no actualiza ahora"
        ),
    )
    argumentos = analizador.parse_args(argv)
    if argumentos.aceptar_cuarentena:
        if argumentos.ensayo or argumentos.area or argumentos.conservar_area or argumentos.sin_descargar:
            analizador.error("--aceptar-cuarentena no actualiza: no admite otras opciones")
        return aceptar_desde_la_cli(RAIZ, argumentos.aceptar_cuarentena)
    opciones = Opciones(
        ensayo=argumentos.ensayo,
        area=argumentos.area,
        conservar_area=argumentos.conservar_area,
        pausa=argumentos.pausa,
        sin_descargar=tuple(argumentos.sin_descargar),
        reintentar_pendientes=argumentos.pendientes,
        programada=argumentos.programada,
        forzar_comprobaciones=argumentos.buscar_actualizaciones,
        en_paralelo=argumentos.en_paralelo,
    )
    return actualizar(RAIZ, opciones)


if __name__ == "__main__":
    sys.exit(main())
