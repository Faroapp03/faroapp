"""Informe fechado de la actualización mensual (actualizar.py): su resumen y su escritura en Markdown y JSON.

El informe cuenta los pasos, la comparación con lo vigente (piezas_de_la_actualizacion.py) y la fecha de las fuentes
manuales. De cada paso fallido conserva el final de su salida, saneado y acotado por paso y en total, en el Markdown y
en el JSON. Python estándar.
"""

import getpass
import re
import socket
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple

from plataforma_datos.comun.entrada_salida import escribir_entero, guardar_json
from plataforma_datos.comun.textos_y_cifras import numero_es
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import (
    CARPETA_DE_INFORMES,
    IGUAL,
    Comparacion,
    FilaManual,
    LadoDelPaquete,
    texto_de_perdida,
)

if TYPE_CHECKING:
    # Solo para los tipos: actualizar.py importa este módulo, y la importación en ejecución sería circular.
    from plataforma_datos.orquestacion.actualizar import Paso

FORMATO_DEL_INFORME = "%Y-%m-%d-%H%M%S"
MAX_EXTRACTO_BYTES = 64 * 1024
AVISO_DE_RECORTE = "[Salida recortada para el informe]\n"
LINEAS_DE_UN_FALLO = 40  # líneas del final de la salida de un paso fallido que recoge el informe
MAX_DIAGNOSTICO_POR_PASO = 8 * 1024  # bytes UTF-8 del diagnóstico de un paso fallido
MAX_DIAGNOSTICOS_BYTES = 32 * 1024  # bytes UTF-8 de todos los diagnósticos con detalle de un informe
SIN_DETALLE = "[Sin detalle: los diagnósticos anteriores agotan el tope del informe]"
OCULTO = "[oculto]"
# Saneado: como el diagnóstico privado de errores (errores_de_actualizacion), de una ruta solo queda su nombre final;
# además se ocultan credenciales, correos y la identidad del equipo. Las URL conservan su anfitrión y su camino.
# Entre comillas (las trazas de Python), una ruta puede llevar espacios: se reconoce entera. Sin comillas, una carpeta
# con espacios se reconoce si la ruta sigue después con otra barra; el último nombre nunca lleva espacios.
# Todas las expresiones son lineales: cuantificadores acotados o clases disjuntas, sin retroceso catastrófico.
_RUTA_ENTRECOMILLADA = re.compile(r"([\"'])~?/[^\"'\n]*/([^\"'/\n]+)\1")
_NOMBRE_DE_RUTA = r"[^\s/'\"`:;,()<>\[\]]"
_RUTA = re.compile(
    rf"(?<![\w/:.@…-])~?(?:/{_NOMBRE_DE_RUTA}{{1,255}}(?: {_NOMBRE_DE_RUTA}{{1,255}}){{0,8}}(?=/))*/{_NOMBRE_DE_RUTA}+"
)
_URL_DE_ARCHIVO = re.compile(r"(?i)\bfile://[^\s\"'`<>]*")
# Una clave (también entre comillas, como en JSON, o dentro de un nombre como GITHUB_TOKEN) y su separador;
# _es_clave_secreta decide si el nombre la delata y solo entonces se lee su valor. Así una clave inocente no se traga
# un «token=…» que la siga. Un valor entre comillas puede llevar espacios.
_CLAVE = re.compile(r"(?<![\w.-])([\"']?)([^\W\d][\w.-]{0,63})\1\s*[:=]\s*")
_VALOR = re.compile(r"(?i)([\"'])(?:(?:bearer|basic|token)\s+)?[^\"'\n]*|(?:(?:bearer|basic|token)\s+)?[^\s&\"']+")
_PARTES_SECRETAS = frozenset(
    {"authorization", "auth", "apikey", "token", "secret", "secreto", "password", "passwd", "pwd", "contraseña"}
    | {"clave", "credential", "credentials", "privatekey", "accesskey", "secretkey"}
)
_FINALES_SECRETOS = ("token", "secret", "password", "passwd", "apikey")
# Credenciales sueltas que se reconocen por su prefijo público (GitHub, Anthropic, OpenAI, Slack, AWS, JWT).
_TOKEN_CONOCIDO = re.compile(
    r"(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{16,}|sk-[\w-]{16,}|xox[abprs]-[\w-]{8,}"
    r"|AKIA[0-9A-Z]{16}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*)"
)
_PORTADOR = re.compile(r"(?i)\bbearer\s+[^\s\"']+")
_USUARIO_EN_URL = re.compile(r"(://)[^/\s@]+@")
_PARAMETRO_SECRETO = re.compile(r"(?i)([?&](?:key|apikey|api_key|token|access_token|sig|signature|password)=)[^&\s]+")
# El dominio termina en una etiqueta alfabética: «faro@1.0.0» (paquete npm y versión) no es un correo.
_CORREO = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,63}(?![\w-])")


class Resumen(NamedTuple):
    """Lo que cuenta el informe de una actualización."""

    veredicto: str
    pasos: list["Paso"]
    comparacion: Comparacion
    manuales: list[FilaManual]
    segundos: float
    sin_descargar: tuple[str, ...] = ()


# ---------------------------------------------------------------------------------------------------------------------
# Informe fechado
# ---------------------------------------------------------------------------------------------------------------------


def _ultimas_lineas(texto: str, cuantas: int = LINEAS_DE_UN_FALLO, maximo: int = MAX_EXTRACTO_BYTES) -> str:
    """Recorta el final de una salida, que es donde una orden dice por qué falla.

    Args:
        texto: La salida.
        cuantas: Cuántas líneas se conservan.
        maximo: Cota en bytes UTF-8 del resultado, aviso incluido.

    Returns:
        Las últimas `cuantas` líneas, con cota UTF-8 de `maximo` y aviso si se recortaron bytes.
    """
    # Limitar primero caracteres evita codificar/copiar una salida arbitrariamente grande.
    final = texto[-maximo:].encode()
    recortado = len(texto) > maximo or len(final) > maximo
    capacidad = maximo - len(AVISO_DE_RECORTE.encode()) if recortado else maximo
    lineas = "\n".join(final[-capacidad:].decode(errors="ignore").rstrip().splitlines()[-cuantas:])
    return (AVISO_DE_RECORTE if recortado else "") + lineas


def _identidad_del_equipo() -> list[str]:
    """Nombres del equipo que una salida puede repetir fuera de una ruta: usuario y máquina.

    Returns:
        Los nombres de tres o más caracteres, del más largo al más corto.
    """
    nombres = set()
    for obtener in (getpass.getuser, socket.gethostname):
        try:
            nombres.add(obtener())
        except (OSError, KeyError):
            continue
    return sorted((n for n in nombres if len(n) >= 3), key=len, reverse=True)  # noqa: PLR2004


def _es_clave_secreta(nombre: str) -> bool:
    """Reconoce el nombre de una credencial por sus partes: api_key, GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, dbPassword.

    Returns:
        True si una parte, dos partes seguidas o el final de una parte nombran una credencial.
    """
    partes = [parte for parte in re.split(r"[_.-]+", nombre.lower()) if parte]
    pares = [primera + segunda for primera, segunda in zip(partes, partes[1:], strict=False)]
    return any(parte in _PARTES_SECRETAS or parte.endswith(_FINALES_SECRETOS) for parte in (*partes, *pares))


def _ocultar_credenciales(texto: str) -> str:
    """Oculta el valor de cada clave que nombra una credencial; conserva la clave, el separador y las comillas.

    Recorre el texto una sola vez: un valor ya oculto no se vuelve a examinar.

    Returns:
        El texto con esos valores sustituidos por OCULTO.
    """
    partes, posicion = [], 0
    for clave in _CLAVE.finditer(texto):
        if clave.start() < posicion or not _es_clave_secreta(clave.group(2)):
            continue
        valor = _VALOR.match(texto, clave.end())
        if valor is None:
            continue
        partes += [texto[posicion : clave.end()], valor.group(1) or "", OCULTO]
        posicion = valor.end()
    return "".join([*partes, texto[posicion:]])


def _nombre_final(ruta: str) -> str:
    """El último nombre no vacío de una ruta o de una URL de archivo.

    Returns:
        El nombre, o una cadena vacía si la ruta no tiene ninguno.
    """
    return next((nombre for nombre in reversed(ruta.split("/")) if nombre), "")


def sanear(texto: str) -> str:
    """Quita de una salida rutas del equipo, credenciales, correos y la identidad de la máquina.

    Returns:
        El texto con cada ruta reducida a «…/nombre» y lo demás sustituido por OCULTO o «[correo]».
    """
    texto = texto.replace(str(Path.home()), "~")
    texto = _USUARIO_EN_URL.sub(rf"\1{OCULTO}@", texto)
    texto = _CORREO.sub("[correo]", texto)
    texto = _URL_DE_ARCHIVO.sub(lambda url: "file://…/" + _nombre_final(url.group()[len("file://") :]), texto)
    texto = _RUTA_ENTRECOMILLADA.sub(r"\1…/\2\1", texto)
    texto = _RUTA.sub(lambda ruta: "…/" + ruta.group().rsplit("/", 1)[-1], texto)
    texto = _TOKEN_CONOCIDO.sub(OCULTO, texto)
    texto = _ocultar_credenciales(texto)
    texto = _PORTADOR.sub(f"Bearer {OCULTO}", texto)
    texto = _PARAMETRO_SECRETO.sub(rf"\1{OCULTO}", texto)
    for nombre in _identidad_del_equipo():
        texto = re.sub(rf"(?<![\w-]){re.escape(nombre)}(?![\w-])", OCULTO, texto)
    return texto


def _cola(salida: str) -> str:
    """La parte final de una salida que puede llegar al informe, empezando en una línea entera.

    El saneado recorre solo esta cola, nunca una salida arbitrariamente grande, y no recibe media ruta al principio.

    Returns:
        Las últimas líneas completas que caben en el doble de MAX_DIAGNOSTICO_POR_PASO caracteres.
    """
    limite = 2 * MAX_DIAGNOSTICO_POR_PASO
    if len(salida) <= limite:
        return salida
    cola = salida[-limite:]
    salto = cola.find("\n")
    return cola[salto + 1 :] if salto >= 0 else cola


def diagnosticos(pasos: list["Paso"]) -> list[str | None]:
    """El diagnóstico de cada paso fallido, saneado y acotado; None para los pasos en verde.

    Cada uno se limita a MAX_DIAGNOSTICO_POR_PASO y los que llevan detalle, juntos, a MAX_DIAGNOSTICOS_BYTES: cuando
    el total se agota, los siguientes fallos constan con SIN_DETALLE, de modo que ninguno desaparece del informe.

    Returns:
        Una entrada por paso, en su orden.
    """
    restante = MAX_DIAGNOSTICOS_BYTES
    resultado: list[str | None] = []
    for paso in pasos:
        if paso.en_verde:
            resultado.append(None)
            continue
        texto = _ultimas_lineas(sanear(_cola(paso.salida)), maximo=MAX_DIAGNOSTICO_POR_PASO)
        tamano = len(texto.encode())
        if tamano > restante:
            texto, tamano = SIN_DETALLE, 0
        restante -= tamano
        resultado.append(texto)
    return resultado


def _tamano(lado: LadoDelPaquete | None) -> str:
    """Escribe «bytes · entradas» de un lado de la comparación.

    Args:
        lado: El lado (None si el archivo no está en él).

    Returns:
        El texto, con punto de millares; «—» si no hay lado.
    """
    return "—" if lado is None else f"{numero_es(lado['bytes'])} B · {numero_es(lado['entradas'])}"


def _seccion_pasos(pasos: list["Paso"], detalles: list[str | None]) -> list[str]:
    """Escribe la sección de los pasos: su tabla y, de cada paso fallido, el final saneado de su salida.

    Args:
        pasos: Los pasos de la actualización.
        detalles: El diagnóstico de cada paso (diagnosticos).

    Returns:
        Las líneas en Markdown.
    """
    lineas = ["## Pasos", "", "| Paso | Resultado | Segundos |", "| --- | --- | ---: |"]
    lineas += [f"| {paso.nombre} | {'verde' if paso.en_verde else 'ROJO'} | {paso.segundos:.0f} |" for paso in pasos]
    for paso, detalle in zip(pasos, detalles, strict=True):
        if detalle is not None:
            lineas += ["", f"### Lo que falló: {paso.nombre} (código {paso.codigo})", "", "```", detalle, "```"]
    return lineas


def _seccion_comparacion(comparacion: Comparacion) -> list[str]:
    """Escribe la sección de la comparación: originales y archivos del paquete que cambian, y las alarmas.

    Args:
        comparacion: La comparación.

    Returns:
        Las líneas en Markdown.
    """
    lineas = ["## Originales que cambian", ""]
    lineas += [
        f"- `{fila['carpeta']}`: {len(fila['cambian'])} cambian, {len(fila['nuevos'])} nuevos, "
        f"{len(fila['quitados'])} quitados"
        for fila in comparacion.originales
    ] or ["Ninguno."]
    if comparacion.paquete is None:
        return [*lineas, "", "## Paquete del motor", "", "No se llegó a exportar: no hay comparación."]
    lineas += ["", "## Paquete del motor", "", "| Archivo | Estado | Antes | Después |", "| --- | --- | --- | --- |"]
    lineas += [
        f"| {fila['archivo']} | {fila['estado']} | {_tamano(fila['antes'])} | {_tamano(fila['despues'])} |"
        for fila in comparacion.paquete
        if fila["estado"] != IGUAL
    ]
    iguales = sum(fila["estado"] == IGUAL for fila in comparacion.paquete)
    lineas += ["", f"{iguales} archivos sin cambios.", "", "## Alarmas", ""]
    lineas += [f"- {alarma}" for alarma in comparacion.alarmas] or ["Ninguna."]
    return lineas + _seccion_cuarentena(comparacion)


def _seccion_cuarentena(comparacion: Comparacion) -> list[str]:
    """Escribe qué archivos conservan su versión publicada por superar el umbral y qué cambio aceptado entra.

    Returns:
        Las líneas en Markdown.
    """
    filas = []
    for retenido in comparacion.cuarentena:
        perdidas = [texto_de_perdida(p) for p in comparacion.perdidas if p["archivo"] == retenido["archivo"]]
        filas.append(
            f"- {'; '.join(perdidas)}. Conservan su versión publicada: {', '.join(retenido['grupo'])}. "
            f"Para publicar el cambio: `--aceptar-cuarentena {retenido['archivo']}`."
        )
    filas += [f"- Cambio aceptado: {nombre}." for nombre in comparacion.aceptados]
    return ["", "## Cuarentena", "", *(filas or ["Ninguna."])]


def _seccion_manuales(manuales: list[FilaManual]) -> list[str]:
    """Escribe la sección de las fuentes manuales: su fecha y si conviene renovarla.

    Args:
        manuales: Las filas de `estado_de_las_manuales`.

    Returns:
        Las líneas en Markdown.
    """
    lineas = ["## Fuentes que renueva una persona", "", "| Fuente | Fecha del dato | Días | Frecuencia | Renovar |"]
    lineas.append("| --- | --- | ---: | --- | --- |")
    for fila in manuales:
        renovar = "sí" if fila["renovar"] else "no"
        lineas.append(
            f"| {fila['fuente']} | {fila['fecha'] or '—'} | {fila['dias'] if fila['dias'] is not None else '—'} "
            f"| {fila['frecuencia']} | {renovar} |"
        )
    return lineas


def _escribir_entero(ruta: Path, texto: str) -> None:
    """Escribe un archivo de texto entero o nada con el escritor común (`escribir_entero`).

    Args:
        ruta: El archivo.
        texto: Su contenido, en UTF-8 con fin de línea LF.
    """
    escribir_entero(ruta, [texto])


def escribir_informe(raiz: Path, resumen: Resumen, momento: datetime | None = None) -> Path:
    """Escribe ejecuciones/AAAA-MM-DD-HHMMSS.md y su .json (hora UTC), cada uno entero o nada.

    Nunca sobrescribe otro informe: si ya hay uno de ese segundo, el nuevo toma el siguiente segundo libre, de modo
    que el orden de los nombres sigue siendo el de las actualizaciones. El contenido conserva el instante real.

    Args:
        raiz: La raíz del repositorio.
        resumen: Lo que cuenta el informe.
        momento: El instante del informe, en UTC; None, ahora.

    Returns:
        La ruta del Markdown.
    """
    momento = momento or datetime.now(UTC)
    carpeta = raiz / CARPETA_DE_INFORMES
    carpeta.mkdir(parents=True, exist_ok=True)
    momento_del_nombre = momento
    base = carpeta / momento_del_nombre.strftime(FORMATO_DEL_INFORME)
    while base.with_suffix(".md").exists() or base.with_suffix(".json").exists():
        momento_del_nombre += timedelta(seconds=1)
        base = carpeta / momento_del_nombre.strftime(FORMATO_DEL_INFORME)
    lineas = [f"# Actualización de los datos · {momento:%Y-%m-%d %H:%M} UTC · {resumen.veredicto}", ""]
    lineas += [
        f"Duración: {resumen.segundos / 60:.1f} min. Pasos en verde: {sum(paso.en_verde for paso in resumen.pasos)}.",
        "",
    ]
    if resumen.sin_descargar:
        lineas += [
            f"Sin descargar esta vez, a propósito (con su copia vigente): {', '.join(resumen.sin_descargar)}.",
            "",
        ]
    detalles = diagnosticos(resumen.pasos)
    for seccion in (
        _seccion_pasos(resumen.pasos, detalles),
        _seccion_comparacion(resumen.comparacion),
        _seccion_manuales(resumen.manuales),
    ):
        lineas += [*seccion, ""]
    _escribir_entero(base.with_suffix(".md"), "\n".join(lineas))
    datos = {
        "veredicto": resumen.veredicto,
        "utc": momento.isoformat(timespec="seconds"),
        "segundos": round(resumen.segundos),
        "pasos": [
            {"nombre": paso.nombre, "codigo": paso.codigo, "segundos": round(paso.segundos, 1)}
            | ({} if detalle is None else {"diagnostico": detalle})
            for paso, detalle in zip(resumen.pasos, detalles, strict=True)
        ],
        "sin_descargar": list(resumen.sin_descargar),
        "comparacion": resumen.comparacion._asdict(),
        "manuales": resumen.manuales,
    }
    guardar_json(base.with_suffix(".json"), datos)
    return base.with_suffix(".md")
