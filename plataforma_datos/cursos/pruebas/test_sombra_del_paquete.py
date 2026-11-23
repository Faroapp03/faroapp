"""La sombra de la regla de retirada cubre los cursos que se publican en el paquete: SOC, Consorci y Citilab."""

import contextlib
import io
import json
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

import plataforma_datos.cursos.fuentes.citilab.lector as citilab
import plataforma_datos.cursos.fuentes.consorci.lector as consorci
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.cursos.altas_en_sombra import ALTAS, declaraciones_de_cibervoluntarios
from plataforma_datos.cursos.decisiones_en_sombra import Alta, ruta_de_la_comparacion
from plataforma_datos.cursos.decisiones_retirada import cargar_registro
from plataforma_datos.cursos.fuentes.cibervoluntarios import adquisicion as adquisicion_cibervoluntarios
from plataforma_datos.cursos.fuentes.citilab import lectura as lectura_citilab
from plataforma_datos.cursos.fuentes.consorci import lectura as lectura_consorci
from plataforma_datos.cursos.fuentes.formacion import lectura as lectura_soc
from plataforma_datos.cursos.lecturas.almacen_lecturas import listar_lecturas
from plataforma_datos.cursos.paquete_servido import publicado, unidades_del_paquete
from plataforma_datos.cursos.pruebas.test_citilab import VOCABULARIOS
from plataforma_datos.cursos.pruebas.test_consorci import CURSO
from plataforma_datos.cursos.pruebas.test_lectura_censo_cibervoluntarios import POR_PAGINA, actividad, material
from plataforma_datos.cursos.pruebas.test_lectura_censo_cibervoluntarios import Instalacion as InstalacionCiber
from plataforma_datos.cursos.pruebas.test_lectura_citilab import copia, curso, horas
from plataforma_datos.cursos.pruebas.test_lectura_consorci import carpeta_de, conservar, edicion
from plataforma_datos.cursos.pruebas.test_lectura_consorci import ident as ident_consorci
from plataforma_datos.cursos.pruebas.test_lectura_soc import fila, instalacion, oferta
from plataforma_datos.cursos.pruebas.test_lectura_soc import ident as ident_soc
from plataforma_datos.orquestacion.notas_de_la_sombra import Nota
from plataforma_datos.orquestacion.sombra_del_ciclo import decidir_en_sombra, foto

DIA_A = "2026-11-14"
DIA_B = "2026-11-16"


def alta_de(ambito: str) -> Alta:
    """El alta de la tabla de ese ámbito.

    Returns:
        El alta.
    """
    return next(alta for alta in ALTAS if alta.ambito == ambito)


def escribir_paquete(raiz: Path, nombre: str, contenido: dict) -> None:
    """Deja `datos/<nombre>` como lo exporta el paquete."""
    ruta = raiz / "datos" / nombre
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(contenido), encoding="utf-8")


def ciclo(
    raiz: Path, alta: Alta, antes: Callable[[], None], emitir: Callable[[], None], despues: Callable[[], None]
) -> list[Nota]:
    """Un ciclo: lo publicado antes, la foto, la lectura del ciclo, lo publicado después y la decisión en sombra.

    Returns:
        Las notas de la sombra.
    """
    antes()
    previa = foto(raiz, (alta,))
    emitir()
    despues()
    with contextlib.redirect_stdout(io.StringIO()):
        return decidir_en_sombra(raiz, previa, (alta,))


def comparacion(raiz: Path, alta: Alta) -> dict:
    """La comparación guardada de la última lectura del ámbito.

    Returns:
        Su contenido.
    """
    ultima = next(x for x in reversed(listar_lecturas(raiz, alta.fuente)) if x["ambito"] == alta.ambito)
    return json.loads(ruta_de_la_comparacion(raiz, alta.fuente, ultima["lectura_id"]).read_bytes())


def decisiones(raiz: Path, alta: Alta) -> dict[str, dict]:
    """Las decisiones guardadas de la última lectura del ámbito, por curso.

    Returns:
        Las decisiones que no son «mantener».
    """
    ultima = next(x for x in reversed(listar_lecturas(raiz, alta.fuente)) if x["ambito"] == alta.ambito)
    return {d["curso"]: d for d in cargar_registro(raiz, alta.fuente, ultima["lectura_id"])["decisiones"]}


class PaqueteServido(unittest.TestCase):
    """Lo que publica el paquete exportado y quién lo ve."""

    def setUp(self) -> None:
        """Una instalación temporal."""
        self.raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def test_lee_las_unidades_de_las_tres_fuentes_con_el_fin_donde_oculta(self) -> None:
        """El SOC y el Consorci dicen su fin; Citilab no oculta ninguno y no lo necesita."""
        escribir_paquete(self.raiz, "formacion.json", {"cursos": [{"id": "A/1", "fin": "2026-12-02"}, {"id": "A/2"}]})
        escribir_paquete(self.raiz, "consorci.json", {"ediciones": [{"id": "1-2-x", "fin": "2026-11-20"}]})
        escribir_paquete(self.raiz, "citilab.json", {"cursos": [{"id": 7, "fin": "2026-06-15"}]})
        unidades = unidades_del_paquete(self.raiz)
        self.assertEqual(unidades[lectura_soc.AMBITO], {"A/1": "2026-12-02", "A/2": None})
        self.assertEqual(unidades[lectura_consorci.AMBITO_EDICIONES], {"1-2-x": "2026-11-20"})
        self.assertEqual(unidades[lectura_citilab.AMBITO], {"7": None})

    def test_el_dia_de_fin_se_ve_y_el_siguiente_no(self) -> None:
        """Igual que el motor: un curso con el fin anterior al día de la consulta es terminado."""
        escribir_paquete(self.raiz, "formacion.json", {"cursos": [{"id": "A", "fin": "2026-11-15"}, {"id": "B"}]})
        suyas = alta_de(lectura_soc.AMBITO).suyas
        lo_publicado = publicado(self.raiz)
        self.assertEqual(suyas(lo_publicado, "2026-11-15"), frozenset({"A", "B"}))
        self.assertEqual(suyas(lo_publicado, "2026-11-16"), frozenset({"B"}))

    def test_sin_paquete_no_hay_nada_y_uno_mal_formado_se_rechaza(self) -> None:
        """Una instalación sin exportar publica nada; una lista sin identificadores no se interpreta a medias."""
        self.assertTrue(all(not ids for ids in unidades_del_paquete(self.raiz).values()))
        escribir_paquete(self.raiz, "citilab.json", {"cursos": [{"titulo": "sin id"}]})
        with self.assertRaises(ValueError):
            unidades_del_paquete(self.raiz)


class CorrespondenciaDeIdentificadores(unittest.TestCase):
    """El identificador de cada unidad publicada es el de la lectura de su fuente."""

    def test_una_edicion_del_consorci_se_publica_con_el_id_de_su_lectura(self) -> None:
        """`consorci.edicion` (lo que exporta el paquete) da el mismo identificador que censa la lectura."""
        raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))
        carpeta = carpeta_de(raiz)
        conservar(carpeta, DIA_A, ([edicion(5)], []))
        emitida = next(e for e in lectura_consorci.emitir(carpeta).emisiones if e.lectura["ambito"].endswith("edicion"))
        publicada, _ = consorci.edicion(edicion(5), consorci.indice_de_cursos([CURSO]))
        self.assertEqual(emitida.lectura["entradas"], [publicada["id"]])
        self.assertEqual(publicada["id"], ident_consorci(5))

    def test_una_ficha_de_citilab_se_publica_con_el_id_de_su_lectura(self) -> None:
        """El `id` entero que exporta el paquete es el texto que censa la lectura."""
        raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))
        original = raiz / DATOS_RELATIVOS / "originales" / "citilab"
        registros, totales = copia(original, DIA_A, [curso(7)], horas(DIA_A))
        resultado = lectura_citilab.emitir(original, registros, totales, citilab.calendario_de_la_ficha)
        publicada = citilab.hechos(curso(7), VOCABULARIOS)
        self.assertEqual(resultado.emisiones[0].lectura["entradas"], [str(publicada["id"])])


class SombraDelPaquete(unittest.TestCase):
    """Los tres ámbitos deciden, comparan con producción y se saltan sin lectura."""

    def setUp(self) -> None:
        """Una instalación temporal."""
        self.raiz = Path(self.enterContext(tempfile.TemporaryDirectory()))

    def test_el_soc_se_decide_solo_con_su_censo(self) -> None:
        """Producción retira lo que ya no publica; la regla, con una sola evidencia, lo deja pendiente."""
        alta = alta_de(lectura_soc.AMBITO)
        original = instalacion(self.raiz)
        cursos = [{"id": ident_soc(n), "fin": "2026-12-02"} for n in (1, 2, 3)]
        notas = ciclo(
            self.raiz,
            alta,
            lambda: escribir_paquete(self.raiz, "formacion.json", {"cursos": cursos}),
            lambda: (
                lectura_soc.emitir(original, oferta(fila(1), fila(2), fila(3)), f"{DIA_A}T08:00:00+00:00"),
                lectura_soc.emitir(original, oferta(fila(1), fila(2)), f"{DIA_B}T08:00:00+00:00"),
            ),
            lambda: escribir_paquete(self.raiz, "formacion.json", {"cursos": cursos[:2]}),
        )
        self.assertEqual(
            [(n.estado, n.ambito, n.fuente) for n in notas],
            [("decidida", lectura_soc.AMBITO, None), ("comprobada", None, lectura_soc.FUENTE)],
        )
        guardada = comparacion(self.raiz, alta)
        self.assertEqual(guardada["retiradas_por_produccion"], [ident_soc(3)])
        self.assertEqual(guardada["la_regla_en_esas"], {"retirar": 0, "pendiente": 1, "mantener": 0})
        self.assertFalse(guardada["con_declaraciones"])
        self.assertEqual(decisiones(self.raiz, alta)[ident_soc(3)]["decision"], "pendiente")

    def test_el_consorci_retira_con_el_fin_que_publica_y_el_terminado_no_cuenta_como_retirada(self) -> None:
        """La edición ya terminada no la ve nadie: no es una retirada de producción aunque la regla la retire."""
        alta = alta_de(lectura_consorci.AMBITO_EDICIONES)
        carpeta = carpeta_de(self.raiz)
        terminada = ident_consorci(2, inicio="20261001", fin="20261115")
        antes = [
            {"id": ident_consorci(1), "fin": "2026-12-15"},
            {"id": terminada, "fin": "2026-11-15"},
            {"id": ident_consorci(3), "fin": "2026-12-15"},
        ]

        def emitir() -> None:
            conservar(
                carpeta,
                DIA_A,
                ([edicion(1), edicion(2, inicio="2026-10-01", fin="2026-11-15"), edicion(3)], []),
                hora=f"{DIA_A}T10:00:00+00:00",
            )
            lectura_consorci.emitir(carpeta)
            conservar(
                carpeta,
                DIA_B,
                ([edicion(1), edicion(2, inicio="2026-10-01", fin="2026-11-15")], []),
                hora=f"{DIA_B}T10:00:00+00:00",
            )
            lectura_consorci.emitir(carpeta)

        notas = ciclo(
            self.raiz,
            alta,
            lambda: escribir_paquete(self.raiz, "consorci.json", {"ediciones": antes}),
            emitir,
            lambda: escribir_paquete(self.raiz, "consorci.json", {"ediciones": antes[:2]}),
        )
        self.assertEqual(notas[0].estado, "decidida")
        guardada = comparacion(self.raiz, alta)
        self.assertEqual(guardada["retiradas_por_produccion"], [ident_consorci(3)])
        self.assertTrue(guardada["con_declaraciones"])
        self.assertEqual(guardada["la_regla_retira_y_produccion_mantiene"], 0)
        decididas = decisiones(self.raiz, alta)
        self.assertEqual(decididas[terminada]["decision"], "retirar")
        self.assertEqual(decididas[terminada]["evidencias"][0]["canal"], "fin_publicado")
        self.assertEqual(decididas[ident_consorci(3)]["decision"], "pendiente")

    def test_citilab_sigue_mostrando_lo_terminado_y_la_regla_lo_retira(self) -> None:
        """Citilab no oculta por el fin: la ficha terminada sigue publicada y es lo que solo la regla retiraría."""
        alta = alta_de(lectura_citilab.AMBITO)
        original = self.raiz / DATOS_RELATIVOS / "originales" / "citilab"
        fichas = [
            curso(1, inicio="2026-10-01", fin="2026-11-30"),
            curso(2, inicio="2026-10-01", fin="2026-11-10"),
            curso(3, inicio="2026-10-01", fin="2026-12-15"),
        ]

        def emitir() -> None:
            registros, totales = copia(original, DIA_A, fichas, horas(DIA_A))
            lectura_citilab.emitir(original, registros, totales, citilab.calendario_de_la_ficha)
            registros, totales = copia(original, DIA_B, fichas[:2], horas(DIA_B))
            (original / "procedencia.json").write_text(json.dumps({"archivos": registros, "totales": totales}))
            lectura_citilab.emitir(original, registros, totales, citilab.calendario_de_la_ficha)

        notas = ciclo(
            self.raiz,
            alta,
            lambda: escribir_paquete(self.raiz, "citilab.json", {"cursos": [{"id": 1}, {"id": 2}, {"id": 3}]}),
            emitir,
            lambda: escribir_paquete(self.raiz, "citilab.json", {"cursos": [{"id": 1}, {"id": 2}]}),
        )
        self.assertEqual(notas[0].estado, "decidida")
        guardada = comparacion(self.raiz, alta)
        self.assertEqual(guardada["retiradas_por_produccion"], ["3"])
        self.assertEqual(guardada["solo_la_regla_retira"], ["2"])
        self.assertEqual(decisiones(self.raiz, alta)["2"]["evidencias"][0]["canal"], "fin_publicado")

    def test_sin_lectura_nueva_se_salta_y_las_acciones_previstas_no_publican_unidades(self) -> None:
        """Un ámbito sin lectura del ciclo se salta diciéndolo; las previstas no tienen identificador en el paquete."""
        altas = tuple(alta_de(ambito) for ambito in (lectura_soc.AMBITO, lectura_consorci.AMBITO_PREVISTAS))
        previa = foto(self.raiz, altas)
        with contextlib.redirect_stdout(io.StringIO()):
            notas = decidir_en_sombra(self.raiz, previa, altas)
        self.assertEqual(
            [(n.estado, n.motivo) for n in notas], [("saltada", "sin-lectura-nueva"), ("saltada", "no-publica")]
        )

    def test_solo_escribe_en_las_carpetas_de_la_sombra_de_su_fuente(self) -> None:
        """Las tres fuentes no son del catálogo: junto a sus lecturas solo dejan decisiones, comparación y estado."""
        alta = alta_de(lectura_soc.AMBITO)
        original = instalacion(self.raiz)
        ciclo(
            self.raiz,
            alta,
            lambda: None,
            lambda: lectura_soc.emitir(original, oferta(fila(1)), f"{DIA_A}T08:00:00+00:00"),
            lambda: None,
        )
        carpetas = {ruta.name for ruta in (self.raiz / DATOS_RELATIVOS / "validados" / "formacion").iterdir()}
        self.assertEqual(carpetas, {"lecturas", "decisiones", "sombra", "retirada"})


class DeclaracionesDeCibervoluntarios(unittest.TestCase):
    """Las bajas que declara Cibervoluntarios se leen después de la adquisición, sin cambiar esta."""

    def test_las_bajas_se_leen_de_las_paginas_que_conserva_su_procedencia(self) -> None:
        """La alta del ámbito lee las declaraciones de la lectura del ciclo con las páginas conservadas."""
        sitio = InstalacionCiber(self)
        censo = [
            actividad(1, materiales=[material(1001, borrado=True)]),
            actividad(2, materiales=[material(1002)]),
        ]
        emisiones = sitio.ciclo(censo, "2026-11-15T05:00:10Z").emisiones
        lectura = next(e.lectura for e in emisiones if e.lectura["ambito"] == "cibervoluntarios:material")
        # Las páginas de la prueba son de dos actividades: la consulta que las pidió lo dice en su dirección.
        with patch.object(adquisicion_cibervoluntarios, "TAMANO_PAGINA", POR_PAGINA):
            declaradas = declaraciones_de_cibervoluntarios(sitio.raiz, lectura)
        self.assertEqual(
            {id: [d.canal for d in lista] for id, lista in declaradas.items()},
            {"cibervoluntarios:material:1001": ["baja_declarada"]},
        )
        self.assertIsNotNone(alta_de("cibervoluntarios:material").declaraciones)


if __name__ == "__main__":
    unittest.main()
