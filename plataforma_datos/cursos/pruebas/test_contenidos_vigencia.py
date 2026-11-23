"""Referencias exactas: contenido estable único, variables de evento e integridad."""

import hashlib
import json
import sqlite3
import unittest
from copy import deepcopy
from unittest.mock import patch

from plataforma_datos.cursos import contenidos_vigencia as contenidos


class ContenidosVigenciaPruebas(unittest.TestCase):
    """No consulta fuentes ni modifica catálogos reales."""

    def setUp(self) -> None:
        """Crea solo el almacén físico en memoria, sin esquema de producto supuesto."""
        self.conexion = sqlite3.connect(":memory:")
        self.addCleanup(self.conexion.close)
        self.conexion.executescript(contenidos.ESQUEMA)

    def dato(self, id: str, fecha: str) -> dict:
        """Construye evento con contenido y soportes repetidos intencionadamente.

        Returns:
            JSON lógico sintético con claves dinámicas y valores comerciales intactos.
        """
        return {
            "id": id,
            "fecha": fecha,
            "detalle": {
                "texto": "Contenido estable " * 100,
                "soporte": {"url": "https://example.org/curso", "sha256": "a" * 64, "capturado_utc": fecha},
                "coste": 0,
                "precio_publicado": "2027-01-01",
                "registro": None,
            },
            "capturas": {id: [fecha, True, 1.0]},
        }

    def test_cada_consulta_es_evento_y_el_contenido_estable_no_se_reinserta(self) -> None:
        """Cambian ID/fecha; no cambia el diccionario compartido ni el JSON reconstruido."""
        primero = self.dato("consulta-1", "2026-10-23T10:00:00Z")
        a = contenidos.codificar(self.conexion, primero, identidades={primero["id"]})
        filas = self.conexion.execute("SELECT count(*) FROM contenidos_vigencia").fetchone()[0]
        segundo = self.dato("consulta-2", "2026-10-24T10:00:00Z")
        b = contenidos.codificar(self.conexion, segundo, identidades={segundo["id"]})
        self.assertEqual(self.conexion.execute("SELECT count(*) FROM contenidos_vigencia").fetchone()[0], filas)
        self.assertEqual(a["raiz"], b["raiz"])
        self.assertNotEqual(a["variables"], b["variables"])
        self.assertEqual(contenidos.decodificar(self.conexion, a), primero)
        self.assertEqual(contenidos.decodificar(self.conexion, b), segundo)
        self.assertEqual(contenidos.codificar(self.conexion, segundo, identidades={segundo["id"]}), b)
        self.assertEqual(self.conexion.execute("SELECT count(*) FROM contenidos_vigencia").fetchone()[0], filas)

    def test_contenido_nuevo_o_fallo_no_se_pierden(self) -> None:
        """Cambios verdaderos añaden solo nodos distintos y conservan el anterior íntegro."""
        dato = self.dato("consulta-1", "2026-10-23T10:00:00Z")
        a = contenidos.codificar(self.conexion, dato, identidades={dato["id"]})
        distinto = deepcopy(dato)
        distinto["detalle"]["texto"] = "Contenido corregido."
        b = contenidos.codificar(self.conexion, distinto, identidades={dato["id"]})
        self.assertNotEqual(a["raiz"], b["raiz"])
        self.assertEqual(contenidos.decodificar(self.conexion, a), dato)
        self.assertEqual(contenidos.decodificar(self.conexion, b), distinto)
        fallo = {"id": "fallo-1", "fecha": "2026-10-24T10:00:00Z", "resultado": "fallida", "error": "HTTP 503"}
        c = contenidos.codificar(self.conexion, fallo, identidades={fallo["id"]})
        self.assertEqual(contenidos.decodificar(self.conexion, c), fallo)

    def test_corte_revierte_nodos_y_no_deja_referencias_parciales(self) -> None:
        """El escritor usa la transacción SQLite existente; no crea un segundo diario.

        Raises:
            KeyboardInterrupt: Corte sintético contenido por la regresión.
        """
        with self.assertRaises(KeyboardInterrupt), self.conexion:
            contenidos.codificar(self.conexion, self.dato("consulta", "2026-10-23T10:00:00Z"), identidades={"consulta"})
            raise KeyboardInterrupt("Corte tras contenido")
        self.assertEqual(self.conexion.execute("SELECT count(*) FROM contenidos_vigencia").fetchone()[0], 0)

    def dag(self, profundidad: int, valor: object) -> dict:
        """Crea pocos nodos válidos con reutilización exponencial intencionada.

        Returns:
            Envoltorio protegido; no construye el árbol lógico expandido.
        """
        id = contenidos._guardar(self.conexion, ["v", valor])
        for _ in range(profundidad):
            id = contenidos._guardar(self.conexion, ["a", [["r", id], ["r", id]]])
        return {"formato_contenido": 1, "raiz": ["r", id], "variables": []}

    def test_dag_explosivo_se_rechaza_antes_de_expandir_con_trabajo_memoizado(self) -> None:
        """Treinta nodos no pueden reservar un árbol de miles de millones de hojas."""
        dato = self.dag(30, "hoja")
        consultas = []
        self.conexion.set_trace_callback(consultas.append)
        with (
            patch.object(contenidos._Decodificador, "expandir", side_effect=AssertionError("No expandir")),
            self.assertRaisesRegex(contenidos.ErrorContenido, "expandido excesivo"),
        ):
            contenidos.decodificar(self.conexion, dato)
        self.assertLessEqual(len([q for q in consultas if q.startswith("SELECT")]), 31)

    def test_presupuesto_limita_bytes_y_valores_independientemente(self) -> None:
        """Rechaza tanto texto compartido enorme como listas enormes de escalares cortos."""
        for profundidad, valor in ((15, "x" * 1024), (20, None)):
            with (
                self.subTest(profundidad=profundidad),
                patch.object(contenidos._Decodificador, "expandir", side_effect=AssertionError("No expandir")),
                self.assertRaisesRegex(contenidos.ErrorContenido, "expandido excesivo"),
            ):
                contenidos.decodificar(self.conexion, self.dag(profundidad, valor))

    def test_altura_cacheada_no_permite_un_camino_posterior_mas_profundo(self) -> None:
        """El presupuesto cacheado conserva la altura; no solo el tamaño del subárbol."""
        id = contenidos._guardar(self.conexion, ["v", None])
        for _ in range(120):
            id = contenidos._guardar(self.conexion, ["a", [["r", id]]])
        compartido = id
        for _ in range(10):
            id = contenidos._guardar(self.conexion, ["a", [["r", id]]])
        raiz = contenidos._guardar(self.conexion, ["a", [["r", compartido], ["r", id]]])
        with (
            patch.object(contenidos._Decodificador, "expandir", side_effect=AssertionError("No expandir")),
            self.assertRaisesRegex(contenidos.ErrorContenido, "demasiado profundo"),
        ):
            contenidos.decodificar(self.conexion, {"formato_contenido": 1, "raiz": ["r", raiz], "variables": []})

    def test_escritura_no_admite_un_resultado_que_su_lector_no_puede_expandir(self) -> None:
        """El presupuesto también impide publicar referencias ilegibles desde la API escritora."""
        with (
            patch.object(contenidos, "MAX_BYTES_LOGICOS", 128),
            self.assertRaises(contenidos.ErrorContenido),
            self.conexion,
        ):
            contenidos.codificar(self.conexion, ["x" * 64] * 4, identidades=set())
        self.assertEqual(self.conexion.execute("SELECT count(*) FROM contenidos_vigencia").fetchone()[0], 0)

    def test_nodo_fisico_parametro_o_clase_ajena_no_es_un_valor_almacenado(self) -> None:
        """SHA correcto no convierte p/r/k en una clase válida de nodo inmutable."""
        for clase in ("p", "r", "k", None, 0):
            with self.subTest(clase=clase):
                id = contenidos._guardar(self.conexion, [clase, "texto"])
                with self.assertRaisesRegex(contenidos.ErrorContenido, "Clase de nodo almacenado"):
                    contenidos.decodificar(self.conexion, {"formato_contenido": 1, "raiz": ["r", id], "variables": []})
        dato = {"texto": "p", "tipo": "r", "letra": "a"}
        self.assertEqual(
            contenidos.decodificar(self.conexion, contenidos.codificar(self.conexion, dato, identidades=set())), dato
        )

    def test_dag_acotado_conserva_todas_sus_hojas_y_tamano_exacto(self) -> None:
        """Compartir no implica rechazar estructuras válidas que caben en presupuesto."""
        dato = self.dag(8, "hoja")
        lector = contenidos._Decodificador(self.conexion, [], None)
        presupuesto = lector.presupuesto(dato["raiz"], None, 0)
        esperado = "hoja"
        for _ in range(8):
            esperado = [esperado, esperado]
        resultado = contenidos.decodificar(self.conexion, dato)
        self.assertEqual(resultado, esperado)
        self.assertEqual(presupuesto[0], len(contenidos._json(resultado).encode()))
        self.assertEqual(presupuesto[1:], (511, 8))

    def test_ausencia_alteracion_ciclo_o_parametro_invalidos_rechazan(self) -> None:
        """No interpreta referencias hostiles ni confunde dato con código."""
        dato = self.dato("consulta", "2026-10-23T10:00:00Z")
        a = contenidos.codificar(self.conexion, dato, identidades={"consulta"})
        for ref in (["r", True], ["r", 99999], ["p", 99999]):
            with self.subTest(ref=ref), self.assertRaises(contenidos.ErrorContenido):
                contenidos.decodificar(self.conexion, {**a, "raiz": ref})
        id = a["raiz"][1]
        self.conexion.execute("UPDATE contenidos_vigencia SET contenido='[]' WHERE id=?", (id,))
        with self.assertRaises(contenidos.ErrorContenido):
            contenidos.decodificar(self.conexion, a)
        cuerpo = json.dumps(["a", [["r", id]]], separators=(",", ":"))
        self.conexion.execute(
            "UPDATE contenidos_vigencia SET contenido=?,sha256=? WHERE id=?",
            (cuerpo, hashlib.sha256(cuerpo.encode()).hexdigest(), id),
        )
        with self.assertRaises(contenidos.ErrorContenido):
            contenidos.decodificar(self.conexion, a)


if __name__ == "__main__":
    unittest.main()
