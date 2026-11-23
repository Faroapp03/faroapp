"""Un archivo del paquete que cambia de nombre a propósito no detiene la sustitución si su sucesor sale de lo mismo.

Medido el 23/11/2026 sobre la generación vigente de producción: el paquete nuevo publica «exposicion-cambra.json» y
la generación vigente aún tiene «cambra.json», con el mismo validado de origen; sin esta regla, cada ciclo quedaba en
ámbar con «cambra.json desaparece del paquete».
"""

import unittest

from plataforma_datos.orquestacion.piezas_de_la_actualizacion import (
    DESAPARECE,
    NUEVO,
    SUCESORES,
    alarmas_del_paquete,
    renombrados,
)

ORIGEN = "var/actualizacion/validados/cambra/cambra.json"


def entrada(origen: str = ORIGEN, sha256: str = "a" * 64) -> dict[str, object]:
    """Una entrada del manifiesto con un solo validado de origen.

    Returns:
        La entrada, con sus orígenes y su huella.
    """
    return {"origenes": {origen: "b" * 64}, "sha256": sha256}


def fila(nombre: str, estado: str) -> dict[str, object]:
    """Una fila de la comparación del paquete con solo su estado.

    Returns:
        La fila, sin lados.
    """
    return {"archivo": nombre, "antes": None, "despues": None, "estado": estado}


class Renombrados(unittest.TestCase):
    """El renombre declarado de la Cambra y las demás desapariciones."""

    def test_la_cambra_es_el_unico_sucesor_declarado(self) -> None:
        """Solo se declara el cambio de nombre de la Cambra."""
        self.assertEqual(SUCESORES, {"cambra.json": "exposicion-cambra.json"})

    def test_el_sucesor_que_sale_del_mismo_validado_es_un_renombre(self) -> None:
        """El sucesor con los mismos validados de origen hace del antiguo un renombre."""
        vigente = {"cambra.json": entrada(), "oit.json": entrada("var/actualizacion/validados/oit/oit.json")}
        nuevo = {"exposicion-cambra.json": entrada(sha256="c" * 64), "oit.json": vigente["oit.json"]}
        self.assertEqual(renombrados((vigente, nuevo)), frozenset({"cambra.json"}))

    def test_no_es_un_renombre_si_cambia_el_origen_falta_el_sucesor_o_sigue_el_antiguo(self) -> None:
        """Otro origen, sin sucesor, el antiguo todavía publicado o sin orígenes: no hay renombre."""
        vigente = {"cambra.json": entrada()}
        casos = (
            {"exposicion-cambra.json": entrada("var/actualizacion/validados/otra/otra.json")},
            {},
            {"cambra.json": entrada(), "exposicion-cambra.json": entrada()},
            {"exposicion-cambra.json": {"sha256": "c" * 64}},
        )
        for nuevo in casos:
            with self.subTest(nuevo=sorted(nuevo)):
                self.assertEqual(renombrados((vigente, nuevo)), frozenset())

    def test_un_renombre_no_da_alarma_y_cualquier_otra_desaparicion_si(self) -> None:
        """El renombre no detiene la sustitución; cualquier otra desaparición sí."""
        filas = [fila("cambra.json", DESAPARECE), fila("exposicion-cambra.json", NUEVO), fila("oit.json", DESAPARECE)]
        self.assertEqual(
            list(alarmas_del_paquete(filas, renombrados=frozenset({"cambra.json"}))),
            ["oit.json desaparece del paquete"],
        )
        self.assertEqual(
            list(alarmas_del_paquete(filas)),
            ["cambra.json desaparece del paquete", "oit.json desaparece del paquete"],
        )


if __name__ == "__main__":
    unittest.main()
