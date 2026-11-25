"""Compara dos ciclos fuente por fuente leyendo solo lo que conservaron: el criterio de aceptación del estreno.

Para cada fuente del registro saca la huella de lo validado, la evidencia de lo descargado y un veredicto:

- `igual`: los dos ciclos descargaron la fuente y la admitieron (su fila del registro de comprobaciones es de su
  ciclo, remota y comprobada, completa o parcial), hay huella comparable de lo descargado y lo validado coincide.
- `difiere-justificado`: lo mismo, pero lo validado difiere y lo descargado también.
- `difiere-sin-justificar`: lo validado difiere con lo mismo descargado, o sin que ninguno de los dos descargara.
- `sin-evidencia`: no se puede juzgar: falta lo validado en algún ciclo, la descarga falló en alguno (conservó la
  versión anterior), solo uno descargó o no hay huella comparable. Nunca cuenta como igual, y la orden falla.
- `sin-descarga`: ninguno de los dos descargó la fuente (o es local) y lo validado coincide. No dice nada del
  paralelo: no cuenta como igual ni como fallo, y el resumen la lista aparte.
- `en-serie`: una fuente de `--en-serie-en-b`, que el ciclo B descargó en serie dentro del paralelo
  (FARO_FUENTES_EN_SERIE), como el ciclo A. No se juzga el paralelo en ella: ni cuenta como igual ni como fallo, y el
  resumen la lista aparte. Sus huellas se muestran igualmente.

La huella de lo validado recorre su carpeta de validados; en los JSON quita las claves que terminan en `_utc`, que son
la hora del ciclo (`comprobado_utc`…). Es conservadora: una diferencia solo en otra hora sale como «difiere» y se
investiga; nunca da un «igual» que no lo sea.

La huella de lo descargado, cuando los dos ciclos descargaron y admitieron la fuente, es la de su recepción sin horas
(huellas_de_lo_descargado) si los dos la tienen, y si no la de la procedencia de sus originales. La recepción no viaja
en la generación: sale del campo `recepcion` de los eventos `etapa-fuente` del diario que cada ejecución archiva en el
almacén privado (`diarios/<run>/<intento>/ejecutar.json`, archivo_diario), o, en una raíz candidata, de sus intentos
técnicos. Si falta o no se entiende, no hay huella y la fuente queda «sin-evidencia».

Con esas mismas etapas comprueba además las pausas: dos descargas de fuentes que declaran el mismo servidor no se
solapan y entre el fin de una y el principio de la siguiente pasan al menos los 2 s de la pausa. Cada proceso empieza
antes de su primera petición y acaba después de la última, así que es una cota segura; dentro de un proceso las separa
red.PausasPorDominio.

Uso: python3 -m plataforma_datos.orquestacion.comparar_ciclos A B [--eventos-a LOG] [--eventos-b LOG]
         [--en-serie-en-b FUENTE,...] [--json]
A y B son raíces con lo que conservó cada ciclo: la generación recuperada (transferir_generacion) o la raíz candidata.
LOG es el diario archivado de cada ejecución; sin él, las etapas salen de los intentos de la raíz (en una candidata).
Sale con 0 solo si ninguna fuente difiere sin justificar, ninguna queda sin evidencia y ninguna pausa se incumple.
"""

import argparse
import hashlib
import json
import sys
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NamedTuple

from plataforma_datos.comun.red import PAUSA_ENTRE_PETICIONES_S
from plataforma_datos.orquestacion import comprobaciones_remotas, huellas_de_lo_descargado
from plataforma_datos.orquestacion.descargas_en_paralelo import servidores
from plataforma_datos.orquestacion.ejecucion_observada import CARPETA_DE_INTENTOS
from plataforma_datos.orquestacion.modulos import MODULOS, carpetas
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES, FUENTES, huellas_de_originales

IGUAL = "igual"
JUSTIFICADO = "difiere-justificado"
SIN_JUSTIFICAR = "difiere-sin-justificar"
SIN_EVIDENCIA = "sin-evidencia"
EN_SERIE = "en-serie"
SIN_DESCARGA = "sin-descarga"
DESCARGADA, NO_DESCARGADA, FALLIDA = "descargada", "no-descargada", "fallida"
ADMITIDOS = frozenset({"comprobada", "completa", "parcial"})  # resultados de una descarga admitida en el registro
HOLGURA_S = 0.001  # redondeo de las horas de los eventos, que llevan milisegundos


class Fuente(NamedTuple):
    """Lo que se compara de una fuente en los dos ciclos."""

    fuente: str
    validado: tuple[str | None, str | None]
    descargado: tuple[str | None, str | None]
    veredicto: str


class Descarga(NamedTuple):
    """Una descarga de un ciclo, según sus eventos."""

    fuente: str
    inicio: datetime
    fin: datetime


def _sin_horas(valor: object) -> object:
    if isinstance(valor, dict):
        return {clave: _sin_horas(dato) for clave, dato in valor.items() if not clave.endswith("_utc")}
    if isinstance(valor, list):
        return [_sin_horas(dato) for dato in valor]
    return valor


def _bytes_sin_horas(ruta: Path) -> bytes:
    """Los bytes de un archivo de validados; un JSON o JSONL, sin sus claves `_utc` y en forma canónica.

    Returns:
        Lo que entra en la huella de lo validado.
    """
    contenido = ruta.read_bytes()
    try:
        if ruta.suffix == ".json":
            documentos = [json.loads(contenido)]
        elif ruta.suffix == ".jsonl":
            documentos = [json.loads(linea) for linea in contenido.splitlines() if linea.strip()]
        else:
            return contenido
    except ValueError:
        return contenido  # un JSON ilegible se compara tal cual
    canonicos = (json.dumps(_sin_horas(dato), ensure_ascii=False, sort_keys=True) for dato in documentos)
    return "\n".join(canonicos).encode()


def huella_de_lo_validado(raiz: Path, carpeta: str) -> str | None:
    """La huella de la carpeta de validados de una fuente, sin las horas del ciclo.

    Returns:
        El SHA-256 de cada ruta con la huella de su contenido, o None si la carpeta no está.
    """
    base = raiz / carpeta
    if not base.is_dir():
        return None
    resumen = hashlib.sha256()
    for ruta in sorted(base.rglob("*")):
        if ruta.is_file() and not ruta.is_symlink():
            resumen.update(ruta.relative_to(base).as_posix().encode() + b"\0")
            resumen.update(hashlib.sha256(_bytes_sin_horas(ruta)).hexdigest().encode() + b"\n")
    return resumen.hexdigest()


def huella_de_los_originales(raiz: Path, carpeta: str) -> str | None:
    """La huella de los originales que registra la procedencia de una fuente.

    Returns:
        El SHA-256 de sus parejas archivo y huella, o None si no conserva procedencia o no registra ninguno.
    """
    procedencia = raiz / carpeta / "procedencia.json"
    if not procedencia.is_file():
        return None
    huellas = huellas_de_originales(json.loads(procedencia.read_bytes()))
    return hashlib.sha256(json.dumps(sorted(huellas.items())).encode()).hexdigest() if huellas else None


def estado_de_la_descarga(registro: dict[str, Any], fuente: str) -> str:
    """Qué hizo la fuente con su servidor en el último ciclo del registro de comprobaciones.

    Returns:
        DESCARGADA si su fila es de ese ciclo, remota y admitida (comprobada, completa o parcial); FALLIDA si es de
        ese ciclo y remota pero no se admitió (conservó la versión anterior); NO_DESCARGADA en cualquier otro caso.
    """
    ciclo = (registro.get("ultimo_ciclo") or {}).get("id")
    fila = registro["fuentes"].get(fuente) or {}
    if ciclo is None or fila.get("ciclo") != ciclo or fila.get("remoto") is not True:
        return NO_DESCARGADA
    return DESCARGADA if fila.get("resultado") in ADMITIDOS else FALLIDA


def evidencias(a: "Ciclo", b: "Ciclo", fuente: str, originales: str) -> tuple[str | None, str | None]:
    """La huella de lo descargado en dos ciclos que descargaron y admitieron la fuente, del mismo tipo en ambos.

    La de la recepción si los dos la tienen en sus etapas; si no, la de la procedencia de sus originales, que en una
    descarga admitida del ciclo es la de lo que ese ciclo descargó.

    Returns:
        Las dos huellas; (None, None) si no hay ninguna comparable.
    """
    recepcion_a, recepcion_b = a.recepciones().get(fuente), b.recepciones().get(fuente)
    if recepcion_a is not None and recepcion_b is not None:
        return f"recepcion:{recepcion_a}", f"recepcion:{recepcion_b}"
    originales_a, originales_b = (huella_de_los_originales(ciclo.raiz, originales) for ciclo in (a, b))
    if originales_a is not None and originales_b is not None:
        return f"originales:{originales_a}", f"originales:{originales_b}"
    return None, None


def veredicto(
    fuente: str,
    validado: tuple[str | None, str | None],
    estados: tuple[str, str],
    descargado: tuple[str | None, str | None],
) -> str:
    """Decide el veredicto de una fuente (ver la cabecera).

    Returns:
        Uno de IGUAL, JUSTIFICADO, SIN_JUSTIFICAR, SIN_EVIDENCIA o SIN_DESCARGA.
    """
    if None in validado:
        return SIN_EVIDENCIA
    if not FUENTES[fuente].red or estados == (NO_DESCARGADA, NO_DESCARGADA):
        return SIN_DESCARGA if validado[0] == validado[1] else SIN_JUSTIFICAR
    if estados != (DESCARGADA, DESCARGADA) or None in descargado:
        return SIN_EVIDENCIA
    if validado[0] == validado[1]:
        return IGUAL
    return JUSTIFICADO if descargado[0] != descargado[1] else SIN_JUSTIFICAR


class Etapa(NamedTuple):
    """Una etapa de fuente de un ciclo, según su evento del diario o su intento técnico."""

    fuente: str
    etapa: str
    estado: str
    codigo: int | None
    inicio: datetime | None
    fin: datetime | None
    recepcion: str | None


def _instante(valor: object) -> datetime | None:
    try:
        return datetime.fromisoformat(valor) if isinstance(valor, str) else None
    except ValueError:
        return None


def etapas_de_los_eventos(lineas: Iterable[str]) -> list[Etapa]:
    """Las etapas que cuentan los eventos `etapa-fuente` del diario, en cualquier línea que lleve uno.

    Returns:
        Una por evento legible; una línea que no se entiende se salta (es telemetría).
    """
    etapas = []
    for linea in lineas:
        posicion = linea.find('{"')
        if posicion < 0 or '"etapa-fuente"' not in linea:
            continue
        try:
            evento = json.loads(linea[posicion:])
        except ValueError:
            continue
        if evento.get("fase") == "etapa-fuente" and isinstance(evento.get("fuente"), str):
            etapas.append(
                Etapa(
                    evento["fuente"],
                    str(evento.get("etapa")),
                    str(evento.get("estado")),
                    evento.get("codigo"),
                    _instante(evento.get("inicio")),
                    _instante(evento.get("fin")),
                    evento.get("recepcion") if isinstance(evento.get("recepcion"), str) else None,
                )
            )
    return etapas


def etapas_de_los_intentos(raiz: Path, ciclo: str | None) -> list[Etapa]:
    """Las etapas de un ciclo según los intentos técnicos de una raíz candidata (no viajan en la generación).

    Returns:
        Una por intento legible de ese ciclo.
    """
    etapas = []
    for ruta in sorted((raiz / CARPETA_DE_INFORMES / CARPETA_DE_INTENTOS).glob("*/intento.json")):
        try:
            dato = json.loads(ruta.read_bytes())
        except (OSError, ValueError):
            continue
        if not isinstance(dato, dict) or dato.get("ciclo") != ciclo or not isinstance(dato.get("fuente"), str):
            continue
        etapas.append(
            Etapa(
                dato["fuente"],
                str(dato.get("etapa")),
                str(dato.get("estado")),
                dato.get("codigo"),
                _instante(dato.get("inicio_utc")),
                _instante(dato.get("fin_utc")),
                huellas_de_lo_descargado.huella_o_nada(dato.get("recibo")),
            )
        )
    return etapas


class Ciclo(NamedTuple):
    """Lo que se sabe de un ciclo: su registro de comprobaciones, sus validados (en la raíz) y sus etapas."""

    raiz: Path
    registro: dict[str, Any]
    etapas: tuple[Etapa, ...]

    def recepciones(self) -> dict[str, str]:
        """La huella de la última descarga terminada en 0 de cada fuente, si su recibo dejó huella.

        Returns:
            Por fuente, su huella.
        """
        hechas = (e for e in self.etapas if e.etapa == "descargar" and e.estado == "terminado" and e.codigo == 0)
        ordenadas = sorted(hechas, key=lambda etapa: etapa.inicio or datetime.min.replace(tzinfo=UTC))
        return {etapa.fuente: etapa.recepcion for etapa in ordenadas if etapa.recepcion is not None}

    def descargas(self) -> list[Descarga]:
        """Las descargas con su inicio y su fin, para comprobar las pausas.

        Returns:
            Una por etapa de descarga terminada.
        """
        return [
            Descarga(etapa.fuente, etapa.inicio, etapa.fin)
            for etapa in self.etapas
            if etapa.etapa == "descargar" and etapa.inicio is not None and etapa.fin is not None
        ]


def leer_ciclo(raiz: Path, eventos: Path | None = None) -> Ciclo:
    """Reúne lo que conservó un ciclo: el diario archivado si se da, o los intentos de su raíz candidata.

    Returns:
        El ciclo, con sus etapas.
    """
    registro = comprobaciones_remotas.leer_registro(raiz)
    if eventos is not None:
        with eventos.open(encoding="utf-8", errors="replace") as archivo:
            etapas = etapas_de_los_eventos(archivo)
    else:
        etapas = etapas_de_los_intentos(raiz, (registro.get("ultimo_ciclo") or {}).get("id"))
    return Ciclo(raiz, registro, tuple(etapas))


def comparar_fuentes(a: Ciclo | Path, b: Ciclo | Path, en_serie: frozenset[str] = frozenset()) -> list[Fuente]:
    """Compara todas las fuentes del registro en los dos ciclos.

    Args:
        a: El primer ciclo, o su raíz (entonces sus etapas salen de sus intentos).
        b: El segundo, igual.
        en_serie: Las fuentes que el segundo descargó en serie dentro del paralelo: su veredicto es EN_SERIE.

    Returns:
        Una fila por fuente, en el orden del registro.
    """
    a, b = (ciclo if isinstance(ciclo, Ciclo) else leer_ciclo(ciclo) for ciclo in (a, b))
    filas = []
    for modulo in MODULOS:
        rutas = carpetas(modulo)
        for indice, fuente in enumerate(modulo.fuentes):
            originales, validados = rutas[3 * indice], rutas[3 * indice + 2]
            validado = (huella_de_lo_validado(a.raiz, validados), huella_de_lo_validado(b.raiz, validados))
            estados = (estado_de_la_descarga(a.registro, fuente), estado_de_la_descarga(b.registro, fuente))
            descargado: tuple[str | None, str | None] = estados  # lo que hizo cada ciclo, si no descargaron los dos
            if estados == (DESCARGADA, DESCARGADA):
                descargado = evidencias(a, b, fuente, originales)
            decision = EN_SERIE if fuente in en_serie else veredicto(fuente, validado, estados, descargado)
            filas.append(Fuente(fuente, validado, descargado, decision))
    return filas


def descargas_de_los_eventos(lineas: Iterable[str]) -> list[Descarga]:
    """Las descargas que cuentan los eventos `etapa-fuente`.

    Returns:
        Una por evento de descarga con inicio y fin.
    """
    return Ciclo(Path(), {}, tuple(etapas_de_los_eventos(lineas))).descargas()


def pausas_incumplidas(descargas: Iterable[Descarga]) -> Iterator[str]:
    """Las parejas de descargas al mismo servidor declarado que se solapan o quedan a menos de la pausa.

    Yields:
        Una descripción por pareja: servidor, las dos fuentes y los segundos entre ellas.
    """
    por_servidor: dict[str, list[Descarga]] = {}
    for descarga in descargas:
        if descarga.fuente in FUENTES and FUENTES[descarga.fuente].red:
            for servidor in servidores(descarga.fuente):
                por_servidor.setdefault(servidor, []).append(descarga)
    for servidor, lista in sorted(por_servidor.items()):
        ordenadas = sorted(lista, key=lambda descarga: descarga.inicio)
        for anterior, siguiente in zip(ordenadas, ordenadas[1:], strict=False):
            hueco = (siguiente.inicio - anterior.fin).total_seconds()
            if hueco < PAUSA_ENTRE_PETICIONES_S - HOLGURA_S:
                yield f"{servidor}: {anterior.fuente} → {siguiente.fuente} a {hueco:.3f} s"


def _corta(huella: str | None) -> str:
    return "—" if huella is None else huella.rsplit(":", 1)[-1][:12]


def _lista_de_fuentes(texto: str) -> frozenset[str]:
    """Convierte «fuente,fuente» y permite a argparse rechazar una que no es del registro.

    Returns:
        Las fuentes nombradas.

    Raises:
        ArgumentTypeError: Si alguna no es una fuente del registro.
    """
    fuentes = frozenset(nombre.strip() for nombre in texto.split(",") if nombre.strip())
    if desconocidas := sorted(fuentes - set(FUENTES)):
        raise argparse.ArgumentTypeError(f"no son fuentes del registro: {', '.join(desconocidas)}")
    return fuentes


def main(argv: list[str] | None = None) -> int:
    """Compara dos ciclos y dice si el estreno se acepta.

    Args:
        argv: Los argumentos (sin el nombre del programa); None lee los del proceso.

    Returns:
        0 si todo coincide o está justificado y las pausas se cumplen; 1 en cualquier otro caso.
    """
    analizador = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("a", type=Path, help="lo que conservó el primer ciclo (p. ej. el de la serie)")
    analizador.add_argument("b", type=Path, help="lo que conservó el segundo ciclo (p. ej. el del estreno)")
    analizador.add_argument("--eventos-a", type=Path, help="registro del job o diario del primer ciclo")
    analizador.add_argument("--eventos-b", type=Path, help="registro del job o diario del segundo ciclo")
    analizador.add_argument(
        "--en-serie-en-b",
        type=_lista_de_fuentes,
        default=frozenset(),
        metavar="FUENTE,...",
        help="fuentes que B descargó en serie dentro del paralelo (FARO_FUENTES_EN_SERIE): no se juzgan",
    )
    analizador.add_argument("--json", action="store_true", help="la comparación en JSON")
    argumentos = analizador.parse_args(argv)
    a, b = leer_ciclo(argumentos.a, argumentos.eventos_a), leer_ciclo(argumentos.b, argumentos.eventos_b)
    filas = comparar_fuentes(a, b, argumentos.en_serie_en_b)
    pausas = [
        *(f"A · {texto}" for texto in pausas_incumplidas(a.descargas())),
        *(f"B · {texto}" for texto in pausas_incumplidas(b.descargas())),
    ]
    malas = [fila for fila in filas if fila.veredicto in (SIN_JUSTIFICAR, SIN_EVIDENCIA)]
    en_serie = [fila.fuente for fila in filas if fila.veredicto == EN_SERIE]
    sin_descarga = [fila.fuente for fila in filas if fila.veredicto == SIN_DESCARGA]
    conformes = [fila for fila in filas if fila.veredicto in (IGUAL, JUSTIFICADO)]
    if argumentos.json:
        documento = {
            "fuentes": [fila._asdict() for fila in filas],
            "en_serie": en_serie,
            "sin_descarga": sin_descarga,
            "pausas_incumplidas": pausas,
        }
        print(json.dumps(documento, indent=2))
    else:
        for fila in filas:
            validado = f"{_corta(fila.validado[0])} {_corta(fila.validado[1])}"
            print(f"{fila.fuente:20} {fila.veredicto:24} validado {validado}  descargado {_corta(fila.descargado[0])}")
        for texto in pausas:
            print(f"Pausa incumplida: {texto}")
        juzgadas = len(conformes) + len(malas)
        print(f"{len(conformes)} de {juzgadas} fuentes juzgadas conformes; {len(pausas)} pausas incumplidas.")
        if sin_descarga:
            print(f"Sin descarga en los dos ciclos y con lo validado igual: {', '.join(sin_descarga)}.")
        if en_serie:
            print(f"En serie en los dos ciclos, sin juzgar el paralelo: {', '.join(en_serie)}.")
    return 1 if malas or pausas else 0


if __name__ == "__main__":
    sys.exit(main())
