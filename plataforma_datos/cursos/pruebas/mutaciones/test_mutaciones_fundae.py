"""Mutaciones de las ediciones de FUNDAE sobre el ciclo sin red de índice, fichas, lectura y validación.

Las respuestas son las de la API publicada que usan las pruebas de la fuente (`test_fundae`, `test_fundae_ediciones`);
el árbol no conserva una respuesta real de estas fichas. Hay dos ediciones abiertas de la misma especialidad, cada una
de una entidad: la primera recibe la mutación y la segunda es el testigo sano.
"""

import copy
import json
import unittest
from pathlib import Path

from plataforma_datos.comun.entrada_salida import sha256
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos.fuentes.fundae import ediciones, preinscripcion
from plataforma_datos.cursos.pruebas import test_fundae_ediciones as caso_fundae
from plataforma_datos.cursos.pruebas import test_fundae_puente_preinscripcion as puente
from plataforma_datos.cursos.pruebas.mutaciones import arnes
from plataforma_datos.cursos.pruebas.test_fundae import COLECTIVOS, centro, fila

CODIGO, MUTADA, TESTIGO = caso_fundae.CODIGO, caso_fundae.ABIERTA, 3190
ENTIDAD_MUTADA, ENTIDAD_TESTIGO = "B00000000", "B11111111"
EDICION_PUBLICADA, CURSO_HP = "fundae:edicion:3177", "hp-life:431:es"


def _fila(edicion: int, entidad: str) -> dict:
    return {**fila(edicion), "cifEntidadFormadora": entidad}


def respuestas(mutar_fila: dict | None = None, *, sin_curso: bool = False) -> dict[str, tuple[int, object]]:
    """Las respuestas de la API simulada, con la mutación aplicada solo a la primera edición.

    Returns:
        Código y cuerpo por dirección.
    """
    curso = centro()["curso"]
    mutada = {**_fila(MUTADA, ENTIDAD_MUTADA), **(mutar_fila or {})}
    testigo = _fila(TESTIGO, ENTIDAD_TESTIGO)
    de_la_mutada = {"centrosRFO": [mutada]} if sin_curso else {"centrosRFO": [mutada], "curso": curso}
    return {
        ediciones.url_difusiones(CODIGO): (200, {"centrosRFO": [mutada, testigo], "curso": curso}),
        ediciones.url_centro(CODIGO, ENTIDAD_MUTADA): (200, de_la_mutada),
        ediciones.url_centro(CODIGO, ENTIDAD_TESTIGO): (200, {"centrosRFO": [testigo], "curso": curso}),
        ediciones.url_colectivos(MUTADA): (200, COLECTIVOS),
        ediciones.url_colectivos(TESTIGO): (200, COLECTIVOS),
    }


class MutacionesFundaePruebas(unittest.TestCase):
    """Un ciclo sano el 23/10 y, el 24/10, la misma consulta con una sola mutación en la primera edición."""

    def setUp(self) -> None:
        """Lee y valida un primer día con las dos ediciones abiertas."""
        self.caso = caso_fundae.EdicionesFundaePruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.api = respuestas()
        self.primero = self.caso.ciclo((CODIGO,), None)
        self.assertTrue(self.caso.admitido(self.primero))
        self.antes = self.por_edicion(self.primero)
        self.assertEqual(set(self.antes), {str(MUTADA), str(TESTIGO)})

    @staticmethod
    def por_edicion(preparado: dict) -> dict[str, dict]:
        """Las ediciones del conjunto preparado, por identificador.

        Returns:
            Edición por identificador.
        """
        return {e["id"]: e for e in preparado["conjunto"]["ediciones"]}

    def segundo_dia(self, **mutacion: object) -> dict:
        """Lee el día siguiente con la mutación, componiendo con la salida admitida del primero.

        Returns:
            Lo que preparar deja para validar.
        """
        self.caso.fin = "2026-10-24T10:00:01Z"
        self.caso.api = respuestas(**mutacion)
        return self.caso.ciclo((CODIGO,), self.caso.previa(copy.deepcopy(self.primero)))

    def observar(self, mutacion: arnes.Mutacion, preparado: dict) -> arnes.Observado:
        """Anota si la fuente se admitiría y qué edición queda en el conjunto que lee el motor.

        Returns:
            Lo observado; la composición del catálogo no se recorre en este tramo.
        """
        despues = self.por_edicion(preparado)
        retiradas = {r["id"]: r["motivo"] for r in preparado["retiradas"]}
        estado = {
            i: "en-el-conjunto" if despues.get(i) == e else retiradas.get(i, "cambiada") for i, e in self.antes.items()
        }
        return arnes.Observado(
            self.caso.admitido(preparado),
            None,
            dict.fromkeys(self.antes, "en-el-conjunto"),
            estado,
            frozenset({str(MUTADA)}),
        )

    def test_m3_fechas_invertidas_no_publican_un_plazo_imposible_ni_tocan_el_testigo(self) -> None:
        """M3: el plazo de preinscripción de la primera edición llega con el inicio después del fin."""
        mutacion = arnes.Mutacion("M3", "fundae", "fechaPreinscripcionInicio posterior a fechaPreinscripcionFin")
        invertidas = {
            "fechaPreinscripcionInicio": "2026-10-31T00:00:00",
            "fechaPreinscripcionFin": "2026-09-01T00:00:00",
        }
        preparado = self.segundo_dia(mutar_fila=invertidas)
        observado = self.observar(mutacion, preparado)
        self.assertTrue(observado.fuente_en_verde)
        self.assertEqual(set(arnes.cambiadas(observado)), {str(MUTADA)})
        self.assertEqual(arnes.alcance(observado), arnes.CURSO)
        # Ninguna edición del conjunto lleva un plazo cuyo inicio sea posterior a su fin.
        plazos = [e["preinscripcion"] for e in preparado["conjunto"]["ediciones"]]
        self.assertTrue(all(p["inicio"] <= p["fin"] for p in plazos))
        self.assertEqual(self.por_edicion(preparado)[str(TESTIGO)], self.antes[str(TESTIGO)])
        with self.assertRaises(ValueError):
            arnes.veredicto_del_ciclo(mutacion, observado)

    def test_m4_sin_nivel_de_programa_conserva_la_edicion_y_no_toca_el_testigo(self) -> None:
        """M4: la ficha de la entidad de la primera edición llega sin el bloque `curso` (el nivel de programa)."""
        mutacion = arnes.Mutacion("M4", "fundae", "respuesta de la entidad sin el bloque curso")
        preparado = self.segundo_dia(sin_curso=True)
        observado = self.observar(mutacion, preparado)
        self.assertTrue(observado.fuente_en_verde)
        self.assertEqual(arnes.cambiadas(observado), {})
        self.assertEqual(arnes.alcance(observado), arnes.NINGUNO)
        # La edición se descarta con su motivo y queda la versión admitida el día anterior.
        self.assertEqual(preparado["conservadas"], [str(MUTADA)])
        self.assertEqual(
            preparado["descartadas"],
            [
                {
                    "especialidad": CODIGO,
                    "id": str(MUTADA),
                    "motivo": f"{CODIGO}: la respuesta de FUNDAE no trae la ficha del curso",
                }
            ],
        )
        with self.assertRaises(ValueError):
            arnes.veredicto_del_ciclo(mutacion, observado)


class FechasInvertidasEnElAlmacenPruebas(unittest.TestCase):
    """M3 en el tramo siguiente: aplicación al almacén común (HP LIFE y FUNDAE), vigencia y proyección de la entrega.

    El conjunto admitido de ediciones lo escribe la ayuda del árbol (`EdicionesEnSqlite.recibir`), que deja fuera
    la edición cuyo plazo no incluye el día; las capturas de la ficha, con el plazo invertido, las lee el productor.
    """

    def setUp(self) -> None:
        """Admite la edición del 15/11 sobre el almacén que ya publica un curso de HP LIFE."""
        self.caso = puente.EdicionesEnSqlite()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)

    def proyectar(self, base: Path, corte: str) -> dict[str, dict]:
        """Proyecta y valida la entrega pública del almacén, como hace la composición antes de publicar.

        Returns:
            Ofertas públicas por unidad.
        """
        admitido = almacen.solicitud(base)
        solicitud = entrega.SolicitudEntrega(
            admision=admitido,
            instalacion=self.caso.raiz,
            sha256_admision=sha256(admitido.validacion_destino),
            area=self.caso.raiz / (base.name + "-entrega"),
            corte_utc=corte,
        )
        entrega.preparar(solicitud)
        entrega.validar(solicitud)
        publico = json.loads((solicitud.area / "validado" / entrega.PUBLICO).read_bytes())
        return {o["unidad"]["id"]: o for o in publico["ofertas"]}

    def test_m3_el_almacen_no_cambia_y_la_entrega_publica_las_dos_fuentes(self) -> None:
        """El plazo invertido no entra en el almacén: la edición conserva su plazo y HP LIFE sigue publicada."""
        antes = self.proyectar(self.caso.primera, "2026-11-15T14:00:00Z")
        self.assertEqual(set(antes), {EDICION_PUBLICADA, CURSO_HP})
        self.caso.recibir("2026-11-20", inicio="2026-11-30", fin="2026-11-01")
        nueva = self.caso.aplicar(self.caso.primera, "invertida", "2026-11-20")
        self.assertEqual(nueva, self.caso.primera)
        self.assertEqual(self.caso.decision(nueva), "disponible-publicamente")
        plazo = preinscripcion._ediciones_previas(nueva / "catalogo.sqlite3")[self.caso.ident]["preinscripcion"]
        self.assertEqual(plazo, {"inicio": "2026-11-01", "fin": "2026-11-30"})
        self.assertEqual(set(self.proyectar(nueva, "2026-11-20T14:00:00Z")), {EDICION_PUBLICADA, CURSO_HP})
