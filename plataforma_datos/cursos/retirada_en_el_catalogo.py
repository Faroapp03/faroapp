"""Lo que la regla de retirada activa de cada fuente quita del catálogo de cursos, y su estado en el linaje.

Una fuente con la regla `activa` deja de publicar en el catálogo los cursos que la regla retira en las lecturas de su
último ciclo (`aplicacion_de_la_retirada.retiradas_por_la_regla`): la selección de la entrega los retiene con el motivo
`seleccion_entrega_catalogo.RETIRADA_POR_EVIDENCIA` antes de mirar su vigencia. Con la fuente en `sombra` no se retiene
nada y lo publicado no cambia ni un byte. Cada fuente solo retira unidades propias: las que empiezan por el prefijo de
uno de sus ámbitos, el mismo con que la sombra las da de alta (`altas_en_sombra.ALTAS`, que se compone de estas mismas
constantes y no se importa aquí porque lleva hasta la entrega).

Para que la entrega se pueda reproducir, el estado de la regla de cada fuente es una entrada más de su linaje. En
sombra la entrada solo dice el modo: un registro nuevo de la sombra no cambia lo que se retiene, así que tampoco cambia
el linaje ni deja la entrega desactualizada a mitad de ciclo. Activa, lleva además el número y la huella del registro
vigente, del que sale lo que se retiene.
"""

from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.activacion_de_la_retirada import ACTIVA, SOMBRA
from plataforma_datos.cursos.aplicacion_de_la_retirada import retiradas_por_la_regla
from plataforma_datos.cursos.estado_de_la_retirada import ultimo_registro
from plataforma_datos.cursos.fuentes.barcelonactiva import lectura as lectura_cibernarium
from plataforma_datos.cursos.fuentes.cibervoluntarios import lectura as lectura_cibervoluntarios
from plataforma_datos.cursos.fuentes.claude_academy import lectura as lectura_academy
from plataforma_datos.cursos.fuentes.fundae import lectura as lectura_fundae
from plataforma_datos.cursos.fuentes.fundae import lectura_preinscripcion
from plataforma_datos.cursos.fuentes.hp_life import lectura as lectura_hp_life
from plataforma_datos.cursos.tipos_json import ObjetoJson

# Las piezas de las que depende lo que se retiene: entran en la huella del código de la entrega.
CODIGO = (
    "retirada_en_el_catalogo.py",
    "aplicacion_de_la_retirada.py",
    "estado_de_la_retirada.py",
    "activacion_de_la_retirada.py",
    "decisiones_retirada.py",
)
# Las fuentes que publican en el catálogo de cursos, con el prefijo de las unidades de cada uno de sus ámbitos.
PREFIJOS: dict[str, tuple[str, ...]] = {
    lectura_cibernarium.FUENTE: (lectura_cibernarium.PREFIJO_EDICION,),
    lectura_fundae.FUENTE: (lectura_preinscripcion.PREFIJO, lectura_fundae.PREFIJO),
    lectura_cibervoluntarios.FUENTE: (lectura_cibervoluntarios.PREFIJO_MATERIAL,),
    lectura_hp_life.FUENTE: (lectura_hp_life.PREFIJO,),
    lectura_academy.FUENTE: (lectura_academy.PREFIJO,),
}


def retiradas_del_catalogo(raiz: Path) -> frozenset[str]:
    """Las unidades del catálogo que retira la regla de las fuentes activas, cada una solo entre las suyas.

    Returns:
        Sus identificadores; ninguno si todas las fuentes del catálogo están en sombra.
    """
    return frozenset(
        curso
        for fuente, prefijos in PREFIJOS.items()
        for curso in retiradas_por_la_regla(raiz, fuente)
        if curso.startswith(prefijos)
    )


def estado_en_el_linaje(raiz: Path) -> ObjetoJson:
    """El estado de la regla de cada fuente del catálogo, como entrada del linaje de la entrega.

    Returns:
        Por fuente, `{"estado": "sombra"}` si no está activa; activa, su modo con el número y la huella de su
        registro vigente.
    """
    estados: ObjetoJson = {}
    for fuente in PREFIJOS:
        registro = ultimo_registro(raiz, fuente)
        if registro is None or registro["estado"] != ACTIVA:
            estados[fuente] = {"estado": SOMBRA}
            continue
        estados[fuente] = {"estado": ACTIVA, "registro": registro["numero"], "sha256": sha256_json(registro)}
    return estados
