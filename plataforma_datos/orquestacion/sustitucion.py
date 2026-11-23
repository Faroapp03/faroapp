"""Cerrojo de la actualización y sustitución de lo vigente con diario de recuperación.

- Cerrojo: `flock` exclusivo y sin espera (POSIX) sobre CARPETA/.cerrojo. Dos actualizaciones nunca corren a
  la vez; el sistema lo suelta si el proceso muere.
- Sustitución de cada carpeta o archivo de `sustituidos`: se copia lo nuevo al lado («.nuevo») y se comprueba
  que es idéntico al área; después se anota el diario (en CARPETA, escrito de forma atómica)
  y se renombra: la vigente pasa a «.anterior» y la nueva ocupa su sitio. Con todo en su sitio, el diario pasa
  a «hecho» y se borran las anteriores.
- Recuperación (`recuperar`, al empezar cada actualización): si un corte dejó un diario sin «hecho», se devuelve cada
  carpeta a su estado anterior; si lo dejó en «hecho», solo se limpian los restos. Si falla la recuperación, quedan
  el diario y los respaldos pendientes para intervenir.
- Una ruta que lo vigente aún no tiene (primera publicación) se crea igual y el diario la anota como ausente: si el
  corte llega antes de «hecho», la recuperación la retira entera y lo vigente queda como estaba.
- Cada módulo de actualización (modulos.py) sustituye sus carpetas con su propio diario (`diario`), así que un corte
  en uno no toca lo publicado por otro.
Python estándar.
"""

import fcntl
import hashlib
import json
import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from plataforma_datos.comun.entrada_salida import escribir_entero, retirar_temporales
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES as CARPETA

ARCHIVO_DEL_CERROJO = ".cerrojo"
ARCHIVO_DEL_DIARIO = "diario.json"
PREPARADO = "preparado"
HECHO = "hecho"
NUEVO, ANTERIOR = ".nuevo", ".anterior"


class ActualizacionEnCurso(RuntimeError):
    """Otra actualización tiene el cerrojo."""


class RecuperacionIncompleta(OSError):
    """No terminó la recuperación: conservar el área, el diario y los respaldos indicados."""


@contextmanager
def cerrojo(raiz: Path, *, carpeta: Path | None = None) -> Iterator[None]:
    """Cerrojo exclusivo de la actualización, con carpeta de control explícita opcional.

    Sin carpeta explícita conserva CARPETA/.cerrojo; los controles distintos no se bloquean entre sí.

    Raises:
        ActualizacionEnCurso: Si otra actualización tiene el cerrojo.
    """
    carpeta = carpeta if carpeta is not None else raiz / CARPETA
    carpeta.mkdir(parents=True, exist_ok=True)
    with (carpeta / ARCHIVO_DEL_CERROJO).open("a", encoding="utf-8") as archivo:
        try:
            fcntl.flock(archivo, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ActualizacionEnCurso(f"otra actualización está en curso ({carpeta / ARCHIVO_DEL_CERROJO})") from error
        try:
            yield
        finally:
            fcntl.flock(archivo, fcntl.LOCK_UN)


def escribir_atomico(ruta: Path, contenido: str) -> None:
    """Escribe un archivo entero o nada con el escritor común, con un temporal propio de sufijo «.tmp».

    No toca temporales ajenos, así que sirve con o sin cerrojo. Los restos de un corte junto a un diario los retira
    `recuperar`, que se llama con exclusión sobre él.
    """
    escribir_entero(ruta, [contenido], sufijo=".tmp")


def huellas_del_arbol(carpeta: Path) -> dict[str, str]:
    """SHA-256 de cada archivo de un árbol (y destino de cada enlace), por ruta relativa.

    Una raíz que es un archivo usa «.» como clave, sin confundirse con una carpeta vacía.

    Returns:
        Por ruta relativa, la huella SHA-256 en hexadecimal o `enlace:<destino>`.
    """
    if carpeta.is_symlink():
        return {".": "enlace:" + str(carpeta.readlink())}
    if carpeta.is_file():
        return {".": hashlib.sha256(carpeta.read_bytes()).hexdigest()}
    huellas = {}
    for ruta in sorted(carpeta.rglob("*")):
        relativa = ruta.relative_to(carpeta).as_posix()
        if ruta.is_symlink():
            huellas[relativa] = "enlace:" + str(ruta.readlink())
        elif ruta.is_file():
            huellas[relativa] = hashlib.sha256(ruta.read_bytes()).hexdigest()
    return huellas


def _ruta(raiz: Path, relativa: str, sufijo: str = "") -> Path:
    """La carpeta vigente (o su «.nuevo» o «.anterior») dentro del repositorio.

    Returns:
        La ruta de la carpeta, con el sufijo si se indica.
    """
    return raiz / f"{relativa}{sufijo}"


def _ruta_del_diario(raiz: Path, diario: str | Path) -> Path:
    """Resuelve el nombre tradicional o una ruta explícita del diario.

    Returns:
        La ruta de control, sin crear un árbol de informes para diarios explícitos.
    """
    return diario if isinstance(diario, Path) else raiz / CARPETA / diario


def anotar_diario(
    raiz: Path, fase: str, sustituidos: tuple[str, ...], diario: str | Path, ausentes: tuple[str, ...]
) -> None:
    """Escribe el diario de la sustitución con su fase, entero o nada.

    Cada fase se anota antes de dar el paso siguiente; una prueba puede cortar aquí el proceso para comprobar que
    la recuperación deja lo publicado entero.
    """
    contenido = (
        json.dumps({"fase": fase, "sustituidos": list(sustituidos), "ausentes": list(ausentes)}, ensure_ascii=False)
        + "\n"
    )
    escribir_atomico(_ruta_del_diario(raiz, diario), contenido)


def _borrar(carpeta: Path) -> None:
    """Retira una ruta si está; los enlaces se retiran sin seguir su destino.

    Raises:
        FileNotFoundError: Si falta una entrada interior pero la carpeta todavía existe.
    """
    if carpeta.is_symlink() or carpeta.is_file():
        carpeta.unlink()
        return
    try:
        shutil.rmtree(carpeta)
    except FileNotFoundError:
        if carpeta.exists():
            raise


def _rutas_de_diario(declaradas: object, admitidas: tuple[str, ...], *, vacias: bool = False) -> tuple[str, ...]:
    """Valida que el diario nunca amplíe las rutas autorizadas por el llamador.

    Returns:
        Las rutas declaradas, sin duplicados.

    Raises:
        OSError: Si la declaración no es una lista de rutas admitidas.
    """
    if (
        not isinstance(declaradas, list)
        or (not declaradas and not vacias)
        or any(not isinstance(relativa, str) or relativa not in admitidas for relativa in declaradas)
        or len(declaradas) != len(set(declaradas))
    ):
        raise OSError("diario inválido: rutas no admitidas")
    return tuple(declaradas)


def _leer_diario(ruta: Path, sustituidos: tuple[str, ...]) -> tuple[str | None, tuple[str, ...], tuple[str, ...]]:
    """Lee también diarios anteriores sin campo ausentes.

    Returns:
        La fase, las rutas y las originalmente ausentes; sin diario, no declara ninguna ausente.

    Raises:
        OSError: Si el diario no declara una fase admitida o amplía el alcance de la recuperación.
    """
    if not ruta.exists():
        return None, sustituidos, ()
    try:
        documento = json.loads(ruta.read_text(encoding="utf-8"))
    except ValueError as error:
        raise OSError(f"diario inválido {ruta}: no es JSON") from error
    if not isinstance(documento, dict) or documento.get("fase") not in (PREPARADO, HECHO):
        raise OSError(f"diario inválido {ruta}: fase debe ser {PREPARADO!r} o {HECHO!r}")
    declaradas = _rutas_de_diario(documento.get("sustituidos", list(sustituidos)), sustituidos)
    ausentes = _rutas_de_diario(documento.get("ausentes", []), declaradas, vacias=True)
    return documento["fase"], declaradas, ausentes


def _recuperar(raiz: Path, sustituidos: tuple[str, ...], diario: str | Path) -> str | None:
    """Aplica el diario; solo lo retira cuando termina la recuperación o la limpieza.

    Returns:
        La recuperación realizada o None si no había restos.

    Raises:
        OSError: Si el diario no tiene una fase admitida o falta una carpeta que declara promovida.
    """
    ruta = _ruta_del_diario(raiz, diario)
    fase, sustituidos, ausentes = _leer_diario(ruta, sustituidos)
    restos = any(_ruta(raiz, relativa, sufijo).exists() for relativa in sustituidos for sufijo in (NUEVO, ANTERIOR))
    if fase is None and not restos:
        retirar_temporales(ruta, ".tmp")
        return None
    if fase == HECHO:
        for relativa in sustituidos:
            vigente = _ruta(raiz, relativa)
            if not (vigente.is_dir() or vigente.is_file()):
                raise OSError(f"falta la ruta promovida {vigente}; no se retiran los respaldos")
    for relativa in sustituidos:
        anterior = _ruta(raiz, relativa, ANTERIOR)
        if relativa in ausentes and fase != HECHO:
            _borrar(_ruta(raiz, relativa))
        elif anterior.exists() and fase != HECHO:
            _borrar(_ruta(raiz, relativa))
            anterior.rename(_ruta(raiz, relativa))
        _borrar(anterior)
        _borrar(_ruta(raiz, relativa, NUEVO))
    retirar_temporales(ruta, ".tmp")
    ruta.unlink(missing_ok=True)
    return "completada" if fase == HECHO else "deshecha"


def recuperar(raiz: Path, sustituidos: tuple[str, ...], diario: str | Path = ARCHIVO_DEL_DIARIO) -> str | None:
    """Restaura lo anterior sin «hecho»; con «hecho», comprueba lo vigente y limpia los restos.

    `diario` str conserva CARPETA/nombre; Path indica una ruta explícita cuyo padre debe existir.
    Se llama con exclusión sobre el diario (su cerrojo o un área propia de la ejecución) y retira también los
    temporales que un corte dejó junto a él.
    Si falla una operación de recuperación, no se retira el diario ni se descartan los respaldos pendientes.
    No cubre pérdida del disco, modificaciones concurrentes ni corrupción externa del diario.

    Returns:
        «deshecha», «completada» o `None` si no había nada que recuperar.

    Raises:
        RecuperacionIncompleta: Si no se pudo terminar; el mensaje identifica diario y respaldos.
    """
    try:
        return _recuperar(raiz, sustituidos, diario)
    except OSError as error:
        respaldos = ", ".join(str(_ruta(raiz, relativa, ANTERIOR)) for relativa in sustituidos)
        raise RecuperacionIncompleta(
            f"recuperación incompleta: {error}; conservar diario {_ruta_del_diario(raiz, diario)} "
            f"y respaldos pendientes: {respaldos}"
        ) from error


def sustituir(raiz: Path, area: Path, sustituidos: tuple[str, ...], diario: str | Path = ARCHIVO_DEL_DIARIO) -> None:
    """Cambia las rutas `sustituidos` del repositorio por las del área; si algo falla, deja las anteriores.

    `diario` str conserva CARPETA/nombre; Path indica una ruta explícita cuyo padre debe existir.
    Registra los destinos inicialmente ausentes: antes de «hecho», recuperar los retira; después los conserva.
    Un error de disco intenta deshacer en el acto y se propaga; tras un corte se llama a `recuperar`.
    Entre renombres puede faltar la ruta para lectores sin cerrojo; no garantiza lectura atómica de varias rutas.
    Si también falla la recuperación, se conservan sus restos para intervenir.

    Raises:
        OSError: Si falla la copia, la comprobación o el renombrado.
        RecuperacionIncompleta: Si además falla la recuperación; conserva el error inicial como causa.
    """
    ausentes = tuple(relativa for relativa in sustituidos if not _ruta(raiz, relativa).exists())
    try:
        for relativa in sustituidos:
            nuevo = _ruta(raiz, relativa, NUEVO)
            _borrar(nuevo)
            origen = area / relativa
            if origen.is_file() and not origen.is_symlink():
                shutil.copy2(origen, nuevo)
            elif origen.is_dir() and not origen.is_symlink():
                shutil.copytree(origen, nuevo, symlinks=True)
            else:
                raise OSError(f"la ruta a sustituir no es un archivo o carpeta propios: {origen}")
            if huellas_del_arbol(nuevo) != huellas_del_arbol(area / relativa):
                raise OSError(f"la copia de {relativa} no es idéntica a la del área")
        anotar_diario(raiz, PREPARADO, sustituidos, diario, ausentes)
        for relativa in sustituidos:
            if relativa not in ausentes:
                _ruta(raiz, relativa).rename(_ruta(raiz, relativa, ANTERIOR))
            _ruta(raiz, relativa, NUEVO).rename(_ruta(raiz, relativa))
        anotar_diario(raiz, HECHO, sustituidos, diario, ausentes)
    except OSError as error:
        try:
            recuperar(raiz, sustituidos, diario)
        except RecuperacionIncompleta as recuperacion:
            raise RecuperacionIncompleta(f"falló la sustitución: {error}; {recuperacion}") from error
        raise
    recuperar(raiz, sustituidos, diario)
