"""Cadenas de lecturas escritas a partir de los patrones de presencia del historial real (21/10 a 18/11).

Un patrón como `11101` dice, lectura a lectura, si el curso estaba (1) o faltaba (0) en el censo de su ámbito. Las horas
son las de las lecturas del historial; el resto del censo son dos cursos que siempre están.
"""

import hashlib

from plataforma_datos.cursos.clasificacion.contrato import Regla
from plataforma_datos.cursos.lecturas.contrato_lectura import (
    HuellaForma,
    Lectura,
    Salida,
    huella_de_campos,
    huella_de_ids,
)
from plataforma_datos.cursos.tipos_json import ObjetoJson

HORAS_CIBERNARIUM = (
    "2026-10-21T05:00:00Z",
    "2026-10-23T05:00:00Z",
    "2026-10-25T05:00:00Z",
    "2026-11-15T05:00:00Z",
    "2026-11-18T05:00:00Z",
)
HORAS_CIBERVOLUNTARIOS = HORAS_CIBERNARIUM[1:]
CURSO = "cibernarium:edicion:40112"
SIEMPRE = ("cibernarium:edicion:40187", "cibernarium:edicion:40203")
REGLA_DE_SALUD = Regla(id="salud-lectura", version=1, sha256=hashlib.sha256(b"salud-lectura v1").hexdigest())
FORMA = HuellaForma(campos_sha256=huella_de_campos(("edicion.fin", "edicion.id")), niveles=("edicion",))
# Lo que cada estado exige al contrato de la lectura.
POR_ESTADO = {
    "sana": {"completa": True, "motivos": ()},
    "anomala": {"completa": True, "motivos": ("forma_cambiada",)},
    "incompleta": {"completa": False, "motivo_incompleta": "consulta_fallida"},
    "reconstruida": {"completa": True, "motivos": ()},
}


def huella(texto: str) -> str:
    """Una huella de prueba, estable para el mismo texto.

    Returns:
        El SHA-256 del texto.
    """
    return hashlib.sha256(texto.encode()).hexdigest()


def cadena(
    patron: str,
    *,
    ambito: tuple[str, str] = ("barcelonactiva", "cibernarium:edicion"),
    horas: tuple[str, ...] = HORAS_CIBERNARIUM,
    estados: str = "",
    explicaciones: dict[int, str] | None = None,
) -> list[ObjetoJson]:
    """La cadena de lecturas de un ámbito en la que el curso sigue el patrón de presencia.

    `estados` lleva una letra por lectura (`s` sana, `a` anómala, `i` incompleta, `r` reconstruida); vacío es todo
    sano. `explicaciones` dice, por posición, qué explica la salida del curso en esa lectura.

    Returns:
        Las lecturas tal como las guarda el almacén, de la primera a la última.
    """
    nombres = {"s": "sana", "a": "anomala", "i": "incompleta", "r": "reconstruida"}
    explicaciones = explicaciones or {}
    lecturas, anterior, antes = [], None, set()
    for posicion, presente in enumerate(patron):
        censo = set(SIEMPRE) | ({CURSO} if presente == "1" else set())
        estado = nombres[estados[posicion]] if estados else "sana"
        lectura = Lectura(
            fuente=ambito[0],
            ambito=ambito[1],
            anterior=anterior,
            observado_utc=horas[posicion],
            recuento_bruto=len(censo),
            recuento_vigente=len(censo),
            ids_sha256=huella_de_ids(censo),
            entradas=tuple(sorted(censo - antes)),
            salidas=tuple(Salida(id=i, explicada_por=explicaciones.get(posicion)) for i in sorted(antes - censo)),
            huella_forma=FORMA,
            estado=estado,
            regla=REGLA_DE_SALUD,
            **POR_ESTADO[estado],
        ).a_json()
        lecturas.append(lectura)
        anterior, antes = lectura["lectura_id"], censo
    return lecturas
