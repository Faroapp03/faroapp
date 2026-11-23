"""Las notas que deja la retirada en sombra de un ciclo, para que el supervisor las pase a su diario.

El ciclo corre en el candidato y el diario lo escribe el supervisor después, como con los intentos de cada etapa
(`diario_mantenimiento.registrar_intentos`). Por eso la sombra deja sus notas en un archivo de las ejecuciones del
candidato y el supervisor las copia al diario. Cada nota es de forma cerrada: el ámbito, qué pasó, el motivo y, si
falló, el tipo del error; sin textos libres ni rutas. Este módulo no depende de la orquestación: lo importan los dos.
"""

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from plataforma_datos.comun.entrada_salida import escribir_bytes_entero
from plataforma_datos.cursos.lecturas.contrato_lectura import AMBITO, FUENTE
from plataforma_datos.orquestacion.formas_del_diario import TIPO_DE_ERROR
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES

ARCHIVO = f"{CARPETA_DE_INFORMES}/retirada-en-sombra.json"
FASE = "retirada-en-sombra"
# «comprobada»: la página de una muestra de sus retiradas se consultó; «activada» y «vuelta-a-sombra»: la regla de la
# fuente cambió de modo en este ciclo (activacion_de_la_retirada).
ESTADOS = ("en-curso", "decidida", "saltada", "problema", "comprobada", "activada", "vuelta-a-sombra")
# «ciclo-cortado»: el ciclo no terminó y no hubo nada que decidir. Lo anota la sombra si el ciclo sale con una
# excepción, y el supervisor al copiar una nota que sigue «en-curso» porque el ciclo se detuvo sin poder decirlo.
# «sin-tiempo»: la decisión agotó su tope antes de llegar a ese ámbito, o la consulta de páginas el suyo;
# «pagina-no-decide»: la página de esa fuente no dice si un curso sigue publicado y no se consulta.
SIN_TIEMPO = "sin-tiempo"
MOTIVOS = (
    "sin-lectura-nueva",
    "no-publica",
    "sin-version-admitida",
    "sin-foto",
    "fallo",
    "ciclo-cortado",
    "pagina-no-decide",
    SIN_TIEMPO,
)
EN_CURSO = "en-curso"
CICLO_CORTADO = {"estado": "saltada", "motivo": "ciclo-cortado"}
MAX_BYTES = 256 * 1024
MAX_NOTAS = 200


@dataclass(frozen=True, kw_only=True)
class Nota:
    """Lo que la sombra hizo con un ámbito, con una fuente o con el ciclo entero (sin ámbito ni fuente).

    `confirman`, `contradicen`, `no_se_sabe` y `sin_comprobar` cuentan lo que dijo la página de las retiradas de la
    fuente; en «activada», `confirman` son las decisiones comprobadas que sostienen la activación.
    """

    estado: str
    ambito: str | None = None
    fuente: str | None = None
    motivo: str | None = None
    tipo: str | None = None
    produccion_retira: int | None = None
    solo_la_regla_retira: int | None = None
    confirman: int | None = None
    contradicen: int | None = None
    no_se_sabe: int | None = None
    sin_comprobar: int | None = None

    def __post_init__(self) -> None:
        """Rechaza una nota fuera de su forma cerrada.

        Raises:
            ValueError: Si un campo no es de la lista cerrada o no tiene su forma.
        """
        if (
            self.estado not in ESTADOS
            or (self.ambito is not None and AMBITO.fullmatch(self.ambito) is None)
            or (self.fuente is not None and FUENTE.fullmatch(self.fuente) is None)
            or (self.motivo is not None and self.motivo not in MOTIVOS)
            or (self.tipo is not None and TIPO_DE_ERROR.fullmatch(self.tipo) is None)
            or any(
                valor is not None and (type(valor) is not int or valor < 0)
                for valor in (
                    self.produccion_retira,
                    self.solo_la_regla_retira,
                    self.confirman,
                    self.contradicen,
                    self.no_se_sabe,
                    self.sin_comprobar,
                )
            )
        ):
            raise ValueError("nota de la retirada en sombra fuera de su forma")


def guardar(raiz: Path, notas: list[Nota]) -> None:
    """Escribe las notas del ciclo, sustituyendo las que hubiera."""
    destino = raiz / ARCHIVO
    destino.parent.mkdir(parents=True, exist_ok=True)
    contenido = [asdict(nota) for nota in notas[:MAX_NOTAS]]
    escribir_bytes_entero(destino, json.dumps(contenido, sort_keys=True, separators=(",", ":")).encode())


def leer(raiz: Path) -> list[Nota]:
    """Lee las notas del ciclo; si el ciclo no dejó ninguna, la lista está vacía.

    Returns:
        Las notas, validadas.

    Raises:
        ValueError: Si el archivo no es propio, es demasiado grande o una nota no tiene su forma.
    """
    ruta = raiz / ARCHIVO
    if not ruta.exists() and not ruta.is_symlink():
        return []
    if ruta.is_symlink() or not ruta.is_file() or ruta.stat().st_size > MAX_BYTES:
        raise ValueError("las notas de la retirada en sombra no son un archivo propio")
    datos = json.loads(ruta.read_bytes())
    campos = {campo.name for campo in fields(Nota)}
    if (
        not isinstance(datos, list)
        or len(datos) > MAX_NOTAS
        or not all(isinstance(d, dict) and set(d) == campos for d in datos)
    ):
        raise ValueError("las notas de la retirada en sombra no tienen su forma")
    return [Nota(**dato) for dato in datos]
