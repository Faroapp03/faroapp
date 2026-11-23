"""La regla de retirada aplicada en sombra a la lectura de un ciclo: decide, guarda y se compara con lo publicado.

Tras la lectura de un ámbito, se decide cada curso que lo publicado (el catálogo de cursos servido o el paquete de
datos) lista antes o después del ciclo y cada curso del censo de la lectura anterior, con las declaraciones que da la
propia fuente (si afirma algo) y sin comprobaciones de página. Los identificadores de la lectura y los de las unidades
publicadas son los mismos. Se guarda el registro `decisiones-retirada` y, al lado, la comparación con lo que hizo
producción en el mismo ciclo: los cursos que dejaron de publicarse y qué habría decidido la regla de cada uno, y los
que la regla retiraría y siguen publicados. Solo identificadores y recuentos. Nada de lo que se publica cambia: solo
se escriben esos dos archivos.
"""

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from plataforma_datos.comun.dia_de_consulta import dia_en_cataluna
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.decisiones_retirada import construir_registro, guardar_registro
from plataforma_datos.cursos.lecturas.almacen_lecturas import guardar_inmutable
from plataforma_datos.cursos.lecturas.cadena import censo_de
from plataforma_datos.cursos.lecturas.contrato_lectura import bytes_de
from plataforma_datos.cursos.paquete_servido import Publicado
from plataforma_datos.cursos.retirada_por_evidencia import Curso, Decision, Declaracion, decidir, regla_de_retirada
from plataforma_datos.cursos.tipos_json import ObjetoJson

CARPETA = "sombra"
VERSION = 1

# Lo que la fuente afirma de cada curso en una lectura, leído de lo que la instalación conserva de su captura.
type LectorDeDeclaraciones = Callable[[Path, ObjetoJson], Mapping[str, tuple[Declaracion, ...]]]


@dataclass(frozen=True, kw_only=True)
class Alta:
    """Un ámbito dado de alta en la sombra: su fuente, dónde se publican sus unidades y sus declaraciones.

    Un ámbito publica en el catálogo de cursos servido (`prefijo`, el de sus unidades) o en el paquete de datos
    (`en_el_paquete`). Sin ninguno de los dos no publica unidades propias: se salta. Sin lector de declaraciones se
    decide solo con la evidencia del censo, porque la fuente no afirma nada que la regla pueda leer.
    """

    fuente: str
    ambito: str
    prefijo: str | None
    declaraciones: LectorDeDeclaraciones | None = None
    en_el_paquete: bool = False

    @property
    def publica(self) -> bool:
        """Si el ámbito tiene unidades propias que la persona ve.

        Returns:
            Si publica en el catálogo servido o en el paquete.
        """
        return self.prefijo is not None or self.en_el_paquete

    def suyas(self, publicado: Publicado, dia: str) -> frozenset[str]:
        """Las unidades publicadas que son de este ámbito el día dado.

        Returns:
            Las del paquete que ve la persona, o las del catálogo que empiezan por su prefijo; ninguna si no publica.
        """
        if self.en_el_paquete:
            return publicado.vigentes_del_paquete(self.ambito, dia)
        if self.prefijo is None:
            return frozenset()
        return frozenset(unidad for unidad in publicado.catalogo if unidad.startswith(self.prefijo))


def cadena_de(lectura: ObjetoJson, lecturas: Iterable[ObjetoJson]) -> list[ObjetoJson]:
    """La cadena de la lectura, de la primera a ella: una cadena nueva no arrastra las lecturas de la vieja.

    Returns:
        Las lecturas encadenadas hasta `lectura`.

    Raises:
        ValueError: Si falta una lectura de la cadena o la cadena vuelve sobre sí misma.
    """
    por_id = {otra["lectura_id"]: otra for otra in lecturas}
    cadena = [lectura]
    while cadena[-1]["anterior"] is not None:
        anterior = por_id.get(cadena[-1]["anterior"])
        if anterior is None or len(cadena) > len(por_id):
            raise ValueError(f"la cadena de {lectura['ambito']} está rota en {cadena[-1]['lectura_id']}")
        cadena.append(anterior)
    return list(reversed(cadena))


def cursos_a_decidir(cadena: list[ObjetoJson], publicados: frozenset[str]) -> list[str]:
    """Los cursos publicados del ámbito y los del censo de la lectura anterior, que pueden acabar de salir.

    Returns:
        Sus identificadores, ordenados.
    """
    anterior: frozenset[str] = frozenset()
    if len(cadena) > 1:
        anterior = censo_de(cadena[-2], {lectura["lectura_id"]: lectura for lectura in cadena})
    return sorted(publicados | anterior)


def comparar_con_produccion(
    decisiones: Iterable[Decision], antes: frozenset[str], despues: frozenset[str]
) -> ObjetoJson:
    """Lo que hizo producción en el ciclo frente a lo que habría decidido la regla.

    Producción retira lo que publicaba antes del ciclo y ya no publica después, como cuenta las retiradas
    `movimientos_de_cursos.comparar`.

    Returns:
        Las retiradas de producción con la decisión de la regla de cada una, y lo que solo la regla retiraría.
    """
    por_curso = {decision.curso: decision.decision for decision in decisiones}
    retiradas = sorted(antes - despues)
    segun_la_regla = dict.fromkeys(("retirar", "pendiente", "mantener"), 0)
    for curso in retiradas:
        segun_la_regla[por_curso.get(curso, "mantener")] += 1
    solo_la_regla = sorted(curso for curso in despues if por_curso.get(curso) == "retirar")
    return {
        "produccion_retira": len(retiradas),
        "la_regla_en_esas": segun_la_regla,
        "retiradas_por_produccion": retiradas,
        "la_regla_retira_y_produccion_mantiene": len(solo_la_regla),
        "solo_la_regla_retira": solo_la_regla,
    }


def ruta_de_la_comparacion(raiz: Path, fuente: str, lectura_id: str) -> Path:
    """Dónde se guarda la comparación de una lectura, hermana del registro de decisiones.

    Returns:
        `var/actualizacion/validados/<fuente>/sombra/<lectura_id>.json` bajo `raiz`.
    """
    return raiz / DATOS_RELATIVOS / "validados" / fuente / CARPETA / f"{lectura_id}.json"


def decidir_lectura(
    raiz: Path,
    alta: Alta,
    lectura: ObjetoJson,
    lecturas: Iterable[ObjetoJson],
    servidas: tuple[Publicado, Publicado],
) -> ObjetoJson:
    """Decide en sombra los cursos de una lectura, guarda el registro y la comparación con producción.

    `servidas` es lo publicado antes y después del ciclo, de todas las fuentes. Lo que el paquete publica depende del
    día: se toma el de la lectura en Cataluña, el mismo antes y después, para que un curso que ya terminó por su fin
    no cuente como retirada de producción.

    Returns:
        La comparación guardada.

    Raises:
        ValueError: Si la cadena, las declaraciones o los registros no son coherentes (`ErrorRetirada`,
            `ErrorDecisiones`, `ErrorLectura`, `CadenaRota`).
        OSError: Si no se puede leer lo conservado o escribir los registros.
    """
    cadena = cadena_de(lectura, lecturas)
    dia = dia_en_cataluna(lectura["observado_utc"]).isoformat()
    antes, despues = (alta.suyas(publicado, dia) for publicado in servidas)
    declaradas = {} if alta.declaraciones is None else alta.declaraciones(raiz, lectura)
    decisiones = [
        decidir(Curso(id=id, fuente=alta.fuente, ambito=alta.ambito, declaraciones=declaradas.get(id, ())), cadena)
        for id in cursos_a_decidir(cadena, antes | despues)
    ]
    regla = regla_de_retirada()
    guardar_registro(raiz, construir_registro(lectura, regla, decisiones))
    comparacion = {
        "version": VERSION,
        "fuente": alta.fuente,
        "ambito": alta.ambito,
        "lectura_id": lectura["lectura_id"],
        "regla": regla.a_json(),
        "con_declaraciones": alta.declaraciones is not None,
        **comparar_con_produccion(decisiones, antes, despues),
    }
    destino = ruta_de_la_comparacion(raiz, alta.fuente, lectura["lectura_id"])
    guardar_inmutable(destino, bytes_de(comparacion), "comparación")
    return comparacion
