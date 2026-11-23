"""Archivos de la cadena de datos: rutas de cada fuente, JSON y JSONL, huellas, fechas, procedencia y validación."""

import hashlib
import json
import os
import re
import secrets
from collections.abc import Callable, Iterable
from datetime import UTC, date, datetime
from io import BufferedWriter, TextIOWrapper
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    ORIGINALES,
    PREPARADOS,
    RAIZ,
    VALIDADOS,
    ArchivoFaltante,
    Carpetas,
    Controles,
    FormatoInesperado,
    HuellaIncorrecta,
)

# Un valor JSON tal como lo devuelve `json.loads`: objeto, lista, texto, número, booleano o nulo.
type Json = dict[str, Json] | list[Json] | str | int | float | bool | None

# Nombre de los temporales: 8 caracteres de este alfabeto, como `tempfile`, porque las recuperaciones tras un corte
# (recepciones, creación del catálogo y `retirar_temporales`) reconocen sus temporales por ese formato. Con 37⁸
# nombres, un intento más ya sería una rareza; el tope solo evita un bucle sin fin.
_LETRAS_DE_TEMPORAL = "abcdefghijklmnopqrstuvwxyz0123456789_"
_LARGO_DEL_AZAR = 8
_INTENTOS_DE_TEMPORAL = 100

# ---------------------------------------------------------------------------------------------------------------------
# Piezas internas
# ---------------------------------------------------------------------------------------------------------------------


def _sin_campos(contenido: dict[str, Any], campos: tuple[str, ...]) -> dict[str, Any]:
    """Copia de `contenido` sin los campos indicados: lo que se compara para saber si ha cambiado.

    Returns:
        Una copia superficial de `contenido` sin esos campos.
    """
    return {clave: valor for clave, valor in contenido.items() if clave not in campos}


def _con_fechas_previas(previo: dict[str, Any], nuevo: dict[str, Any], campos: tuple[str, ...]) -> dict[str, Any]:
    """`nuevo` con las fechas de `previo` si, sin contar esas fechas, los dos contenidos son iguales; si no, `nuevo`.

    Devuelve una copia: no cambia lo que recibe. Las claves conservan el orden de `nuevo`.

    Returns:
        `nuevo`, con las fechas de `previo` si el resto coincide.
    """
    if _sin_campos(previo, campos) != _sin_campos(nuevo, campos):
        return nuevo
    return {**nuevo, **{campo: previo[campo] for campo in campos if campo in previo and campo in nuevo}}


# ---------------------------------------------------------------------------------------------------------------------
# Rutas y archivos
# ---------------------------------------------------------------------------------------------------------------------


def carpetas(fuente: str) -> Carpetas:
    """Devuelve las carpetas de originales, preparados y validados de una fuente.

    Returns:
        Las rutas `originales/<fuente>`, `preparados/<fuente>` y `validados/<fuente>` bajo `var/actualizacion/`.
    """
    return Carpetas(ORIGINALES / fuente, PREPARADOS / fuente, VALIDADOS / fuente)


def ruta_del_conjunto(fuente: str) -> Path:
    """El conjunto validado que leen las demás fuentes y el exportador: `var/actualizacion/validados/<f>/<f>.json`.

    Returns:
        La ruta del conjunto validado de la fuente.
    """
    return carpetas(fuente).validado / f"{fuente}.json"


def relativa(ruta: Path) -> str:
    """Ruta relativa a la raíz del repositorio, con barras normales: la forma en que se registra en los datos.

    Una ruta de fuera del repositorio (por ejemplo, temporal) se devuelve tal cual.

    Returns:
        La ruta relativa a la raíz, con «/» como separador.
    """
    absoluta = Path(ruta).resolve()
    try:
        return absoluta.relative_to(RAIZ).as_posix()
    except ValueError:
        return absoluta.as_posix()


def requerir(ruta: Path) -> Path:
    """Devuelve la ruta si existe; si no, lanza `ArchivoFaltante` con la ruta relativa.

    Returns:
        La misma ruta.

    Raises:
        ArchivoFaltante: Si la ruta no existe.
    """
    if not Path(ruta).exists():
        raise ArchivoFaltante(f"falta {relativa(ruta)}")
    return Path(ruta)


def sha256_bytes(datos: bytes) -> str:
    """Huella SHA-256 en hexadecimal de unos bytes.

    Returns:
        La huella en 64 cifras hexadecimales.
    """
    return hashlib.sha256(datos).hexdigest()


def sha256(ruta: Path) -> str:
    """Huella SHA-256 en hexadecimal de un archivo.

    Returns:
        La huella en 64 cifras hexadecimales.
    """
    # Por bloques, sin cargar el archivo entero: los originales llegan a MAX_DESCARGA_BYTES.
    with Path(ruta).open("rb") as archivo:
        return hashlib.file_digest(archivo, "sha256").hexdigest()


def json_compacto(contenido: object) -> str:
    """JSON en una línea, sin espacios y con caracteres no ASCII legibles.

    Returns:
        El texto JSON en una línea.

    Raises:
        ValueError: Si hay un NaN o un infinito, que no son JSON: la cadena falla donde nace la cifra.
    """
    return json.dumps(contenido, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def leer_json(ruta: Path) -> Json:
    """Lee un archivo JSON en UTF-8.

    Returns:
        El contenido del archivo.

    Raises:
        FormatoInesperado: Si no es JSON válido en UTF-8, con la ruta y el motivo.
    """
    try:
        return json.loads(requerir(ruta).read_text(encoding="utf-8"))
    except ValueError as error:
        raise FormatoInesperado(f"{relativa(ruta)} no es JSON válido: {error}") from error


def _sustituir_entero(destino: Path, sufijo: str, escribir: Callable[[BufferedWriter], object]) -> None:
    """Escribe un archivo entero o nada: un temporal propio junto al destino, a disco, renombrado y sincronizado.

    Una excepción a mitad (también de quien escribe) deja el archivo anterior intacto y retira el temporal. Cada
    escritura crea en exclusiva su propio temporal (`.<destino>.<azar><sufijo>`, `temporal_hermano`) y nunca toca
    otros: dos escrituras simultáneas no se pisan ni siguen enlaces; gana la última en renombrar y el destino siempre
    queda entero. El contenido se sincroniza (fsync) antes de renombrar y la carpeta después, de modo que tras un
    apagón queda la versión anterior o la nueva, entera. Si falla la sincronización de la carpeta, el destino ya es el
    nuevo y el error se propaga. Un corte duro deja su temporal; solo lo retira `retirar_temporales`.
    """
    temporal = None
    try:
        with temporal_hermano(destino.parent, prefijo=f".{destino.name}.", sufijo=sufijo) as archivo:
            temporal = Path(archivo.name)
            escribir(archivo)
            archivo.flush()
            os.fsync(archivo.fileno())
        temporal.replace(destino)
        temporal = None
    finally:
        if temporal is not None:
            temporal.unlink(missing_ok=True)
    _sincronizar_carpeta(destino.parent)


def _sincronizar_carpeta(carpeta: Path) -> None:
    """Lleva a disco las entradas de una carpeta (fsync), para que un renombrado en ella sobreviva a un apagón."""
    descriptor = os.open(carpeta, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def retirar_temporales(destino: Path, sufijo: str) -> None:
    """Retira los temporales que un corte dejó junto a `destino` con `_sustituir_entero`.

    Solo retira archivos regulares con el nombre exacto que genera `temporal_hermano` (prefijo, 8 caracteres de su
    alfabeto y sufijo); los enlaces, las carpetas y cualquier otro nombre se quedan. Solo se llama con exclusión
    demostrada sobre ese destino, porque retiraría también el temporal de una escritura en curso: la recuperación de
    `sustitucion` (bajo su cerrojo o en un área propia de la ejecución) y la migración del estado (bajo el cerrojo
    común).
    """
    prefijo = f".{destino.name}."
    if not destino.parent.is_dir():
        return
    for ruta in destino.parent.iterdir():
        nombre = ruta.name
        if not (nombre.startswith(prefijo) and nombre.endswith(sufijo)):
            continue
        azar = nombre.removeprefix(prefijo).removesuffix(sufijo)
        propio = len(azar) == _LARGO_DEL_AZAR and set(azar) <= set(_LETRAS_DE_TEMPORAL)
        if propio and ruta.is_file() and not ruta.is_symlink():
            ruta.unlink(missing_ok=True)


def escribir_bytes_entero(ruta: Path, datos: bytes, *, sufijo: str = ".parcial") -> None:
    """Escribe unos bytes enteros o nada, con las garantías de `_sustituir_entero`."""
    _sustituir_entero(Path(ruta), sufijo, lambda archivo: archivo.write(datos))


def escribir_entero(ruta: Path, partes: Iterable[str], *, sufijo: str = ".parcial") -> None:
    """Escribe un texto UTF-8 entero o nada, con las garantías de `_sustituir_entero`.

    Fin de línea LF en todos los sistemas, para que las huellas no dependan de la plataforma.
    """

    def escribir(archivo: BufferedWriter) -> None:
        texto = TextIOWrapper(archivo, encoding="utf-8", newline="\n")
        texto.writelines(partes)
        texto.detach()

    _sustituir_entero(Path(ruta), sufijo, escribir)


def escribir_entero_creando_carpeta(ruta: Path, partes: Iterable[str]) -> None:
    """Crea la carpeta del destino si falta y escribe el archivo entero o nada (`escribir_entero`)."""
    destino = Path(ruta)
    destino.parent.mkdir(parents=True, exist_ok=True)
    escribir_entero(destino, partes)


def guardar_json(ruta: Path, contenido: object) -> None:
    """Guarda JSON sangrado con dos espacios y salto de línea final, entero o nada (sin NaN ni infinitos)."""
    texto = json.dumps(contenido, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    escribir_entero_creando_carpeta(ruta, [texto])


def guardar_json_compacto(ruta: Path, contenido: object) -> None:
    """Guarda JSON en una sola línea y sin salto final, entero o nada: el formato de los paquetes grandes del motor."""
    texto = json_compacto(contenido)
    escribir_entero_creando_carpeta(ruta, [texto])


def temporal_hermano(carpeta: Path, *, prefijo: str, sufijo: str = "") -> BufferedWriter:
    """Abre un temporal nuevo en `carpeta` para escribirlo y renombrarlo o enlazarlo después sobre su destino.

    `tempfile.NamedTemporaryFile` crea siempre con permisos 0600, y el renombrado los lleva al archivo publicado: en
    Linux, un servidor web o un Worker local con otro usuario no podría leer datos, web, validados ni el estado del
    panel. Este temporal se crea como `open()`, con 0666 menos la umask del proceso. Lo que debe ser privado no pasa
    por aquí: se escribe con 0600 explícito. No se borra al cerrarlo; quien lo usa lo renombra o lo retira (`.name`).

    Returns:
        El archivo abierto en binario, creado en exclusiva (nunca reutiliza ni sigue un enlace existente).

    Raises:
        FileExistsError: Si no encuentra un nombre libre, algo que solo pasaría con la carpeta llena de temporales.
    """
    for _ in range(_INTENTOS_DE_TEMPORAL):
        azar = "".join(secrets.choice(_LETRAS_DE_TEMPORAL) for _ in range(_LARGO_DEL_AZAR))
        ruta = Path(carpeta) / f"{prefijo}{azar}{sufijo}"
        try:
            return ruta.open("xb")
        except FileExistsError:
            continue
    raise FileExistsError(f"sin nombre libre para un temporal en {relativa(carpeta)}")


def leer_jsonl(ruta: Path) -> list[Any]:
    """Lee un archivo JSON Lines (una línea por registro); ignora las líneas vacías.

    Returns:
        Un registro por línea no vacía, en orden.

    Raises:
        FormatoInesperado: Si una línea no es JSON válido, con la ruta y el número de línea.
    """
    registros = []
    with requerir(ruta).open(encoding="utf-8") as archivo:
        for numero, linea in enumerate(archivo, start=1):
            if not linea.strip():
                continue
            try:
                registros.append(json.loads(linea))
            except ValueError as error:
                raise FormatoInesperado(f"{relativa(ruta)}, línea {numero}: {error}") from error
    return registros


def guardar_jsonl(ruta: Path, filas: Iterable[Any]) -> None:
    """Guarda un registro JSON compacto por línea, entero o nada: si `filas` falla a mitad, queda el anterior."""
    escribir_entero_creando_carpeta(ruta, (json_compacto(fila) + "\n" for fila in filas))


def ahora_utc() -> str:
    """Fecha y hora actuales en UTC, en formato ISO 8601.

    Returns:
        La fecha y la hora en UTC, AAAA-MM-DDTHH:MM:SS.ffffff+00:00.
    """
    return datetime.now(UTC).isoformat()


def hoy_utc() -> date:
    """El día de hoy en UTC, el mismo reloj que ahora_utc; las órdenes que lo usan aceptan otro día para las pruebas.

    Returns:
        El día de hoy en UTC.
    """
    return datetime.now(UTC).date()


def guardar_json_fechado(ruta: Path, contenido: dict[str, Any], campos_fecha: Iterable[str]) -> None:
    """Guarda `contenido` conservando las fechas del archivo anterior si el resto no ha cambiado.

    Así, repetir una etapa con las mismas entradas deja el archivo idéntico byte a byte: la fecha registra cuándo se
    obtuvo ese contenido, no cuándo se volvió a comprobar.
    """
    previo = leer_json(ruta) if Path(ruta).exists() else {}
    guardar_json(ruta, _con_fechas_previas(previo, contenido, tuple(campos_fecha)) if previo else contenido)


# ---------------------------------------------------------------------------------------------------------------------
# Procedencia y validación
# ---------------------------------------------------------------------------------------------------------------------


def procedencia(fuente: str, carpeta: Path | None = None) -> dict[str, Any]:
    """Lee `var/actualizacion/originales/<fuente>/procedencia.json`, o la de otra carpeta de originales de la fuente.

    Args:
        fuente: El id de la fuente.
        carpeta: Una carpeta de originales propia (la de un año, por ejemplo); por omisión, la de la fuente.

    Returns:
        El contenido de la procedencia.
    """
    return leer_json((carpetas(fuente).original if carpeta is None else carpeta) / ARCHIVO_DE_PROCEDENCIA)


def entradas_procedencia(contenido: dict[str, Any]) -> list[dict[str, Any]]:
    """Archivos registrados en una procedencia: la lista `archivos` o, si hay uno solo, la propia procedencia.

    Returns:
        Las entradas de los archivos registrados.
    """
    return contenido.get("archivos", [contenido])


def comprobar_huella(ruta: Path, esperada: str) -> Path:
    """Devuelve la ruta si su SHA-256 coincide con la esperada; si no, lanza `HuellaIncorrecta`.

    Returns:
        La misma ruta.

    Raises:
        HuellaIncorrecta: Si la huella del archivo no es la esperada.
    """
    if sha256(requerir(ruta)) != esperada:
        raise HuellaIncorrecta(f"{Path(ruta).name} no coincide con su procedencia")
    return Path(ruta)


def conserva_su_huella(carpeta: Path, entrada: dict[str, Any]) -> bool:
    """Si el archivo de una entrada de procedencia, en `carpeta`, tiene todavía la huella registrada.

    Returns:
        True si el archivo existe y conserva la huella registrada; False si falta, para que el control lo registre.
    """
    ruta = carpeta / entrada["archivo"]
    return ruta.exists() and sha256(ruta) == entrada["sha256"]


def controles_de_huella(controles: Controles, carpeta: Path, contenido: dict[str, Any]) -> None:
    """Un control por original registrado en una procedencia, «huella de <archivo>»: que conserva su huella."""
    for entrada in entradas_procedencia(contenido):
        controles.comprobar(conserva_su_huella(carpeta, entrada), f"huella de {entrada['archivo']}")


def original(fuente: str, nombre: str, carpeta: Path | None = None) -> Path:
    """Ruta de un original, comprobando que coincide con la huella registrada en su procedencia.

    Args:
        fuente: El id de la fuente.
        nombre: El nombre del original.
        carpeta: Una carpeta de originales propia, con su procedencia; por omisión, la de la fuente.

    Returns:
        La ruta del original comprobado.

    Raises:
        ArchivoFaltante: Si el original no está registrado en su procedencia.
    """
    donde = carpetas(fuente).original if carpeta is None else carpeta
    for entrada in entradas_procedencia(procedencia(fuente, donde)):
        if entrada["archivo"] == nombre:
            return comprobar_huella(donde / nombre, entrada["sha256"])
    raise ArchivoFaltante(f"{nombre} no está registrado en la procedencia de {fuente}")


def ultimo_original(fuente: str, patron: str) -> Path:
    """Original más reciente cuyo nombre encaja con `patron` (los nombres llevan la fecha ISO de la copia).

    Returns:
        La ruta del original más reciente, comprobado con su huella.

    Raises:
        ArchivoFaltante: Si ningún original registrado encaja con `patron`.
    """
    registrados = [entrada["archivo"] for entrada in entradas_procedencia(procedencia(fuente))]
    nombres = [nombre for nombre in registrados if re.fullmatch(patron, nombre)]
    if not nombres:
        raise ArchivoFaltante(f"ningún original de {fuente} encaja con {patron}")
    return original(fuente, max(nombres))


def comprobar_originales(fuente: str, carpeta: Path | None = None) -> list[Path]:
    """Comprueba la huella de todos los originales registrados de una fuente y devuelve sus rutas.

    Args:
        fuente: El id de la fuente.
        carpeta: Una carpeta de originales propia, con su procedencia; por omisión, la de la fuente.

    Returns:
        Las rutas de los originales registrados, en el orden de la procedencia.
    """
    donde = carpetas(fuente).original if carpeta is None else carpeta
    # La procedencia se lee una vez: con `original` por cada entrada se leería n + 1 veces.
    return [
        comprobar_huella(donde / entrada["archivo"], entrada["sha256"])
        for entrada in entradas_procedencia(procedencia(fuente, donde))
    ]


def guardar_validacion(ruta: Path, informe: dict[str, Any]) -> None:
    """Guarda un `validacion.json`; su fecha `comprobado_utc` solo cambia cuando cambia el resultado."""
    guardar_json_fechado(ruta, informe, ("comprobado_utc", "verificacion_integral_utc"))
