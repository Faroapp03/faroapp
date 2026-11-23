"""La regla `retirada-por-evidencia`: retira solo con la fuente o con dos evidencias de grupos independientes.

Los casos salen de los patrones de presencia del historial (`auditoria_coordinacion.json`) y del censo de verdad.
"""

import ast
import itertools
import unittest
from pathlib import Path

from plataforma_datos.cursos import retirada_por_evidencia as retirada
from plataforma_datos.cursos.pruebas.ejemplos_retirada import (
    CURSO,
    HORAS_CIBERNARIUM,
    HORAS_CIBERVOLUNTARIOS,
    cadena,
    huella,
)
from plataforma_datos.cursos.retirada_por_evidencia import (
    ComprobacionPagina,
    Curso,
    Declaracion,
    ErrorRetirada,
    Parametros,
    decidir,
    regla_de_retirada,
)

CIBERNARIUM = Curso(id=CURSO, fuente="barcelonactiva", ambito="cibernarium:edicion")
# Una fuente sin canal de página: allí dos ausencias sanas bastan.
SIN_PAGINA = ("claude_academy", "claude_academy:recurso")
ACADEMY = Curso(id=CURSO, fuente=SIN_PAGINA[0], ambito=SIN_PAGINA[1])
CIBERVOLUNTARIOS = ("cibervoluntarios", "cibervoluntarios:material")
DESPUES_DEL_15 = "2026-11-15T09:00:00Z"
DESPUES_DEL_18 = "2026-11-18T09:00:00Z"


def pagina(veredicto: str, hora: str = DESPUES_DEL_18) -> ComprobacionPagina:
    """Una comprobación de página de prueba.

    Returns:
        La comprobación con ese veredicto y esa hora.
    """
    return ComprobacionPagina(veredicto=veredicto, pedido_utc=hora, sha256=huella(veredicto + hora))


def grupos(decision: retirada.Decision) -> list[str]:
    """Los grupos de las evidencias de una decisión, en su orden.

    Returns:
        La lista de grupos.
    """
    return [evidencia.grupo for evidencia in decision.evidencias]


class PatronesDelHistorial(unittest.TestCase):
    """Lo que habría decidido la regla con los cursos que faltaron una vez y volvieron."""

    def test_ausente_una_vez_y_vuelve_no_retira_nunca(self) -> None:
        """Los patrones 11101 y 1101 no retiran en ningún punto de la cadena y acaban mantenidos."""
        for curso, patron, ambito, horas in (
            (CIBERNARIUM, "11101", ("barcelonactiva", "cibernarium:edicion"), HORAS_CIBERNARIUM),
            (ACADEMY, "11101", SIN_PAGINA, HORAS_CIBERNARIUM),
            (
                Curso(id=CURSO, fuente=CIBERVOLUNTARIOS[0], ambito=CIBERVOLUNTARIOS[1]),
                "1101",
                CIBERVOLUNTARIOS,
                HORAS_CIBERVOLUNTARIOS,
            ),
        ):
            lecturas = cadena(patron, ambito=ambito, horas=horas)
            for hasta in range(1, len(patron) + 1):
                with self.subTest(patron=patron, fuente=curso.fuente, lecturas=hasta):
                    self.assertNotEqual(decidir(curso, lecturas[:hasta]).decision, "retirar")
            self.assertEqual(decidir(curso, lecturas).decision, "mantener")

    def test_fin_publicado_ya_pasado_retira_por_la_fuente(self) -> None:
        """El patrón 11100 con el fin publicado anterior a la última lectura sana retira por la fuente."""
        lecturas = cadena("11100")
        fin = Declaracion(
            lectura_id=lecturas[2]["lectura_id"],
            canal="fin_publicado",
            sha256=huella("fin"),
            cierra_el="2026-11-01T22:59:59Z",
        )
        curso = Curso(id=CURSO, fuente="barcelonactiva", ambito="cibernarium:edicion", declaraciones=(fin,))
        decision = decidir(curso, lecturas)
        self.assertEqual(decision.decision, "retirar")
        self.assertIn("fuente", grupos(decision))

    def test_salida_explicada_por_su_fin_retira_por_la_fuente(self) -> None:
        """Una salida que la lectura sana explica por su fin publicado es una afirmación de la fuente."""
        decision = decidir(CIBERNARIUM, cadena("11100", explicaciones={3: "fin_publicado"}))
        self.assertEqual(decision.decision, "retirar")
        self.assertEqual(decision.evidencias[0].canal, "fin_publicado")

    def test_fin_aun_no_alcanzado_en_la_ultima_lectura_no_cuenta(self) -> None:
        """El fin se compara con la hora de la lectura, no con el reloj: si aún no llegó, no cuenta."""
        lecturas = cadena("11100")
        fin = Declaracion(
            lectura_id=lecturas[2]["lectura_id"],
            canal="fin_publicado",
            sha256=huella("fin"),
            cierra_el="2026-12-01T22:59:59Z",
        )
        curso = Curso(id=CURSO, fuente="barcelonactiva", ambito="cibernarium:edicion", declaraciones=(fin,))
        decision = decidir(curso, lecturas)
        self.assertEqual(decision.decision, "pendiente")
        self.assertEqual(grupos(decision), ["censo", "censo"])

    def test_sin_fin_dos_ausencias_sanas_retiran_solo_sin_canal_de_pagina(self) -> None:
        """El patrón 11100 sin fin: pendiente tras la primera ausencia; retira tras la segunda solo sin página."""
        lecturas = cadena("11100", ambito=SIN_PAGINA)
        self.assertEqual(decidir(ACADEMY, lecturas[:4]).decision, "pendiente")
        self.assertEqual(decidir(ACADEMY, lecturas).decision, "retirar")
        self.assertEqual(decidir(CIBERNARIUM, cadena("11100")).decision, "pendiente")

    def test_sin_fin_una_de_las_dos_ausencias_en_lectura_anomala_queda_pendiente(self) -> None:
        """Con una de las dos ausencias en una lectura anómala solo queda una observación."""
        self.assertEqual(decidir(ACADEMY, cadena("11100", ambito=SIN_PAGINA, estados="sssas")).decision, "pendiente")


class LecturasQueNoSonObservaciones(unittest.TestCase):
    """Una lectura anómala, incompleta o reconstruida solo puede impedir una retirada."""

    def test_ausencia_en_lectura_no_sana_no_cuenta(self) -> None:
        """Una ausencia en una lectura anómala, incompleta o reconstruida no es una evidencia."""
        for estados in ("sssa", "sssi", "sssr"):
            with self.subTest(estados=estados):
                decision = decidir(ACADEMY, cadena("1110", ambito=SIN_PAGINA, estados=estados))
                self.assertEqual((decision.decision, decision.evidencias), ("mantener", ()))

    def test_sin_lecturas_o_solo_no_sanas_se_mantiene(self) -> None:
        """Sin ninguna lectura sana no hay observación del censo: el curso se mantiene."""
        self.assertEqual(decidir(CIBERNARIUM, []).decision, "mantener")
        no_sanas = cadena("110", estados="ari")
        self.assertEqual(decidir(CIBERNARIUM, no_sanas, [pagina("no_existe")]).decision, "mantener")

    def test_aparecer_en_una_lectura_anomala_anula_las_ausencias_anteriores(self) -> None:
        """Que la fuente vuelva a listar el curso, aun en una lectura anómala, anula las ausencias previas."""
        self.assertEqual(decidir(ACADEMY, cadena("11010", ambito=SIN_PAGINA, estados="sssas")).decision, "pendiente")


class CensoYPagina(unittest.TestCase):
    """El censo y la página son grupos independientes; cada uno solo no retira."""

    def test_ausencia_sana_y_pagina_no_existe_retira(self) -> None:
        """Una ausencia sana y una página que no existe son dos grupos independientes: retiran."""
        decision = decidir(CIBERNARIUM, cadena("1110"), [pagina("no_existe", DESPUES_DEL_15)])
        self.assertEqual(decision.decision, "retirar")
        self.assertEqual(grupos(decision), ["censo", "pagina"])

    def test_pagina_cerrado_sola_queda_pendiente(self) -> None:
        """Una página cerrada con el curso aún en el censo es una sola evidencia."""
        decision = decidir(CIBERNARIUM, cadena("11111"), [pagina("cerrado")])
        self.assertEqual((decision.decision, grupos(decision)), ("pendiente", ["pagina"]))

    def test_pagina_anterior_a_la_ultima_presencia_no_cuenta(self) -> None:
        """Un veredicto de página anterior a la última vez que el censo listó el curso queda anulado."""
        self.assertEqual(
            decidir(CIBERNARIUM, cadena("11101"), [pagina("no_existe", DESPUES_DEL_15)]).decision, "mantener"
        )

    def test_cuenta_el_ultimo_veredicto_y_sin_respuesta_no_es_observacion(self) -> None:
        """Una página disponible posterior anula la baja; una sin respuesta no dice nada."""
        lecturas = cadena("1110")
        tarde = "2026-11-16T09:00:00Z"
        disponible_despues = [pagina("no_existe", DESPUES_DEL_15), pagina("disponible", tarde)]
        self.assertEqual(decidir(CIBERNARIUM, lecturas, disponible_despues).decision, "pendiente")
        sin_respuesta_despues = [pagina("no_existe", DESPUES_DEL_15), pagina("sin_respuesta", tarde)]
        self.assertEqual(decidir(CIBERNARIUM, lecturas, sin_respuesta_despues).decision, "retirar")

    def test_veredictos_distintos_a_la_misma_hora_no_cuentan_como_baja(self) -> None:
        """Ante dos veredictos distintos a la misma hora, la página no cuenta como baja."""
        dudosa = ComprobacionPagina(veredicto="dudoso", pedido_utc=DESPUES_DEL_15, sha256=huella("otra"))
        decision = decidir(CIBERNARIUM, cadena("1110"), [pagina("no_existe", DESPUES_DEL_15), dudosa])
        self.assertEqual((decision.decision, grupos(decision)), ("pendiente", ["censo"]))


class LoQueAfirmaLaFuente(unittest.TestCase):
    """La inscripción cerrada o sin plazas declarada por la fuente basta, si es lo último que dijo."""

    def curso(self, lecturas: list, posicion: int, canal: str = "inscripcion_cerrada") -> Curso:
        """El curso con una declaración en la lectura de esa posición.

        Returns:
            El curso de Cibernàrium con la declaración.
        """
        declaracion = Declaracion(lectura_id=lecturas[posicion]["lectura_id"], canal=canal, sha256=huella(canal))
        return Curso(id=CURSO, fuente="barcelonactiva", ambito="cibernarium:edicion", declaraciones=(declaracion,))

    def test_inscripcion_cerrada_declarada_retira(self) -> None:
        """La inscripción cerrada o sin plazas que declara la fuente en su última lectura retira."""
        lecturas = cadena("11111")
        for canal in ("inscripcion_cerrada", "sin_plazas"):
            with self.subTest(canal=canal):
                decision = decidir(self.curso(lecturas, 4, canal), lecturas)
                self.assertEqual((decision.decision, grupos(decision)), ("retirar", ["fuente"]))

    def test_declaracion_superada_por_una_lectura_posterior_no_cuenta(self) -> None:
        """Una declaración que la fuente no repite en su lectura siguiente queda superada."""
        lecturas = cadena("11111")
        self.assertEqual(decidir(self.curso(lecturas, 3), lecturas).decision, "mantener")

    def test_declaracion_en_lectura_anomala_no_cuenta(self) -> None:
        """Lo que se lee en una lectura anómala no provoca una retirada."""
        lecturas = cadena("11111", estados="ssssa")
        self.assertEqual(decidir(self.curso(lecturas, 4), lecturas).decision, "mantener")

    def test_declaracion_de_una_lectura_ajena_o_sin_el_curso_se_rechaza(self) -> None:
        """Una declaración que cita una lectura de otra cadena o sin el curso es un error."""
        lecturas = cadena("11100")
        with self.assertRaises(ErrorRetirada):
            decidir(self.curso(lecturas, 4), lecturas)
        with self.assertRaises(ErrorRetirada):
            decidir(self.curso(cadena("11111", horas=retirada_horas(dia=2)), 4), lecturas)


class DeterminismoYHuella(unittest.TestCase):
    """La decisión no depende del orden, ni del reloj; la huella de la regla depende de sus parámetros."""

    def test_el_orden_de_las_lecturas_y_las_comprobaciones_no_cambia_la_decision(self) -> None:
        """Cualquier orden de las lecturas y de las comprobaciones da la misma decisión."""
        lecturas = cadena("11100")
        comprobaciones = [pagina("cerrado", DESPUES_DEL_15), pagina("no_existe"), pagina("sin_respuesta")]
        esperada = decidir(CIBERNARIUM, lecturas, comprobaciones)
        for orden in itertools.permutations(lecturas):
            self.assertEqual(decidir(CIBERNARIUM, orden, reversed(comprobaciones)), esperada)

    def test_no_consulta_el_reloj_ni_la_red(self) -> None:
        """El módulo solo importa piezas puras: ni reloj, ni red, ni azar."""
        arbol = ast.parse(Path(retirada.__file__).read_text(encoding="utf-8"))
        importados = {
            nombre.name.split(".")[0]
            for nodo in ast.walk(arbol)
            if isinstance(nodo, ast.Import)
            for nombre in nodo.names
        } | {nodo.module.split(".")[0] for nodo in ast.walk(arbol) if isinstance(nodo, ast.ImportFrom)}
        self.assertEqual(importados, {"hashlib", "collections", "dataclasses", "pathlib", "plataforma_datos"})

    def test_la_huella_de_la_regla_cambia_con_sus_parametros(self) -> None:
        """La misma regla con los mismos parámetros tiene la misma huella; con otros, otra."""
        base = regla_de_retirada()
        self.assertEqual(base, regla_de_retirada(retirada.PARAMETROS))
        mas_ausencias = Parametros(fuentes_con_pagina=retirada.PARAMETROS.fuentes_con_pagina, ausencias_sin_pagina=3)
        sin_paginas = Parametros(fuentes_con_pagina=frozenset(), ausencias_sin_pagina=2)
        self.assertEqual(
            len({base.sha256, regla_de_retirada(mas_ausencias).sha256, regla_de_retirada(sin_paginas).sha256}), 3
        )
        self.assertEqual(decidir(CIBERNARIUM, cadena("11100"), parametros=sin_paginas).decision, "retirar")

    def test_parametros_que_retirarian_con_una_ausencia_se_rechazan(self) -> None:
        """Ningún parámetro deja retirar con una sola ausencia."""
        with self.assertRaises(ErrorRetirada):
            Parametros(fuentes_con_pagina=frozenset(), ausencias_sin_pagina=1)


class CadenaDeLecturas(unittest.TestCase):
    """La regla solo decide sobre una cadena completa del ámbito del curso."""

    def test_cadena_rota_se_rechaza(self) -> None:
        """Sin una lectura intermedia la cadena no se puede recorrer."""
        lecturas = cadena("11100")
        with self.assertRaises(ErrorRetirada):
            decidir(CIBERNARIUM, [lecturas[0], *lecturas[2:]])

    def test_lectura_de_otro_ambito_o_repetida_se_rechaza(self) -> None:
        """Una lectura de otro ámbito o repetida no se mezcla con la cadena."""
        with self.assertRaises(ErrorRetirada):
            decidir(ACADEMY, cadena("111"))
        lecturas = cadena("111")
        with self.assertRaises(ErrorRetirada):
            decidir(CIBERNARIUM, [*lecturas, lecturas[1]])


def retirada_horas(dia: int = 0) -> tuple[str, ...]:
    """Las horas de las cinco lecturas de Cibernàrium, desplazadas unos días si se pide otra cadena distinta.

    Returns:
        Cinco horas UTC crecientes.
    """
    return tuple(f"2026-10-{21 + 2 * n + dia:02d}T05:00:00Z" for n in range(5))


if __name__ == "__main__":
    unittest.main()
