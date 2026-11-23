"""Fichas completas de lectores pasivos y productores externos sin activación implícita."""

import importlib
import json
import unittest
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from unittest import mock

from plataforma_datos.contratos import fuentes
from plataforma_datos.ia_y_trabajo.fuentes.encuestas_isco4 import lector as encuestas
from plataforma_datos.ia_y_trabajo.fuentes.ia_nacional import lector as nacional
from plataforma_datos.orquestacion import modulos
from plataforma_datos.orquestacion import planificacion_de_comprobaciones as planificacion
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN

PLATAFORMA = Path(fuentes.__file__).resolve().parents[1]
CATALOGO = ("claude_academy", "hp_life")
EXTERNOS = ("ia_nacional", "encuestas_isco4")


def documento(identidad: str, tema: str) -> dict[str, object]:
    """Lee únicamente metadata del paquete para alteraciones adversas.

    Returns:
        Una copia del documento JSON, sin cargar el código que declara.
    """
    return json.loads((PLATAFORMA / tema / "fuentes" / identidad / "fuente.json").read_text())


class FuentesNoRegistradasPruebas(unittest.TestCase):
    """La ficha no concede descarga, dependencias automáticas ni publicación."""

    def test_catalogo_tiene_operacion_casa_y_cli_registradas(self) -> None:
        """La extracción no concede oferta: la operación sí conserva sus controles propios."""
        for identidad in CATALOGO:
            with self.subTest(identidad=identidad):
                d = fuentes.cargar_fuente(identidad)
                self.assertEqual(d.modalidad, "operativa")
                self.assertEqual(d.casa_datos, identidad)
                self.assertEqual(d.dependencias, ())
                self.assertEqual([c.id for c in d.conjuntos], [identidad])
                self.assertTrue(d.actualizacion.red)
                self.assertTrue(all(r.licencia is None for r in d.recursos))
                texto = fuentes.generar_readme(d)
                self.assertIn(f"python -m {d.lector} preparar", texto)
                self.assertIn(f"python -m {d.lector} validar", texto)

    def test_externos_conservan_casas_conjuntos_y_dependencias_reales(self) -> None:
        """Las comprobaciones externas siguen con fuenteNone y sin cadencia inventada."""
        for identidad, lector, dependencias in (
            (EXTERNOS[0], nacional, ()),
            (EXTERNOS[1], encuestas, ("oit", "clasificaciones")),
        ):
            with self.subTest(identidad=identidad):
                d = fuentes.cargar_fuente(identidad, tema="ia_y_trabajo")
                self.assertEqual(d.modalidad, "productor-externo")
                self.assertIsNone(d.actualizacion)
                self.assertEqual(d.casa_datos, lector.FUENTE)
                self.assertEqual(d.dependencias, dependencias)
                self.assertEqual(d.conjuntos, tuple(c for c in CONJUNTOS if c.id == identidad))
                self.assertTrue(all(c.fuente is None and c.intervalo_dias is None for c in d.conjuntos))
                self.assertIn(f"python -m {d.lector} preparar", fuentes.generar_readme(d))

    def test_recursos_nacionales_no_cambian_licencias_urls_o_titulos(self) -> None:
        """Se conserva cada uno de los 3 + 31 archivos declarados, incluidos 12 ECH humanos."""
        archivos = [
            *encuestas.ARCHIVOS,
            *encuestas.ARCHIVOS_DANE,
            *encuestas.ARCHIVOS_ECH,
            encuestas.NOTA_CIUO08_INE,
            *encuestas.ARCHIVOS_IBGE,
        ]
        for identidad, entradas in ((EXTERNOS[0], nacional.ARCHIVOS), (EXTERNOS[1], archivos)):
            with self.subTest(identidad=identidad):
                d = fuentes.cargar_fuente(identidad, tema="ia_y_trabajo")
                self.assertEqual(
                    [(r.ubicacion, r.licencia, r.descripcion) for r in d.recursos],
                    [(a["url"], a["licencia"], a["titulo"]) for a in entradas],
                )

    def test_mezclas_medias_activas_o_pasivas_no_se_admiten(self) -> None:
        """Null no es un permiso para omitir operación de una fuente registrada."""
        pasivo = {
            **documento("hp_life", "cursos"),
            "actualizacion": None,
            "casa_datos": None,
            "conjuntos": [],
            "dependencias": [],
        }
        self.assertEqual(fuentes.validar_descriptor(pasivo).modalidad, "lectura-candidata")
        activo = documento("formacion", "cursos")
        externo = documento("ia_nacional", "ia_y_trabajo")
        cambios = [
            {**pasivo, "casa_datos": "hp-life"},
            {**pasivo, "dependencias": ["oit"]},
            {**pasivo, "actualizacion": activo["actualizacion"]},
            {**activo, "actualizacion": None},
            {**activo, "conjuntos": []},
            {**externo, "casa_datos": None},
            {**externo, "conjuntos": []},
        ]
        descarga = deepcopy(externo)
        descarga["conjuntos"][0].update(operacion="descargar", intervalo_dias=7)
        cambios.append(descarga)
        for d in cambios:
            with self.subTest(id=d["id"], dato=d), self.assertRaises(fuentes.ErrorDescriptor):
                fuentes.validar_descriptor(d)

    def test_json_no_importa_codigo_y_modulo_ajeno_se_rechaza(self) -> None:
        """Ni una ficha pasiva permite elegir importaciones arbitrarias desdeJSON."""
        with mock.patch.object(importlib, "import_module") as importar:
            for identidad in CATALOGO:
                fuentes.validar_descriptor(documento(identidad, "cursos"))
                mala = documento(identidad, "cursos")
                mala["lector"] = "os.system"
                with self.assertRaises(fuentes.ErrorDescriptor):
                    fuentes.validar_descriptor(mala)
            importar.assert_not_called()

    def test_catalogo_activo_y_externos_permanecen_separados(self) -> None:
        """Solo las fuentes operativas declaradas entran en el programador y el ciclo."""
        for ids, esperado in ((CATALOGO, True), (EXTERNOS, False)):
            for identidad in ids:
                self.assertEqual(identidad in FUENTES, esperado)
                self.assertEqual(identidad in dict(FUENTES_EN_ORDEN), esperado)
                self.assertEqual(identidad in {m.id for m in modulos.MODULOS}, esperado)
                self.assertEqual(identidad in {c.fuente for c in CONJUNTOS}, esperado)
        self.assertEqual(modulos.comprobar_registro(), [])

    def test_id_pasivo_arbitrario_no_se_ignora(self) -> None:
        """El descubrimiento exige identidad estática, aunque la ficha sea pasiva válida."""
        original = fuentes.cargar_fuente("hp_life")
        ajena = replace(
            original,
            id="intrusa",
            lector="plataforma_datos.cursos.fuentes.intrusa.lector",
            casa_datos=None,
            actualizacion=None,
            conjuntos=(),
            dependencias=(),
        )
        self.assertEqual(ajena.modalidad, "lectura-candidata")
        cargar = modulos.cargar_descriptores

        def modificados(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            return (*cargar(tema=tema), ajena) if tema == "cursos" else cargar(tema=tema)

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=modificados):
            self.assertIn("intrusa: descriptor sin productor estático", modulos.comprobar_registro())

    def test_candidato_en_modulo_activo_o_externo_sin_ficha_se_rechaza(self) -> None:
        """Registro separado nunca convierte metadata en permiso operativo."""
        with mock.patch.object(
            modulos, "MODULOS", (*modulos.MODULOS, modulos.Modulo("versiones_navegadores", ("versiones_navegadores",)))
        ):
            self.assertTrue(any("versiones_navegadores" in f and "activa" in f for f in modulos.comprobar_registro()))
        cargar = modulos.cargar_descriptores

        def sin_externo(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            return tuple(d for d in cargar(tema=tema) if d.id != "ia_nacional")

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=sin_externo):
            self.assertTrue(any("ia_nacional" in f and "sin descriptor" in f for f in modulos.comprobar_registro()))

    def test_descriptor_y_plan_externo_se_contrastan_en_ambos_sentidos(self) -> None:
        """Ni un JSON cambiado tras importar ni un plan mutado en memoria quedan invisibles."""
        cargar = modulos.cargar_descriptores

        def cambiado(*, tema: str = "cursos") -> tuple[fuentes.DescriptorFuente, ...]:
            return tuple(
                replace(d, conjuntos=(d.conjuntos[0]._replace(id="otro-conjunto"),)) if d.id == "ia_nacional" else d
                for d in cargar(tema=tema)
            )

        with mock.patch.object(modulos, "cargar_descriptores", side_effect=cambiado):
            self.assertIn("ia_nacional: comprobaciones externas distintas del descriptor", modulos.comprobar_registro())
        alterados = tuple(
            c._replace(operacion="descargar", intervalo_dias=7) if c.id == "ia_nacional" else c for c in CONJUNTOS
        )
        with mock.patch.object(planificacion, "CONJUNTOS", alterados):
            self.assertIn("ia_nacional: comprobaciones externas distintas del descriptor", modulos.comprobar_registro())

    def test_dos_productores_no_comparten_casa_real(self) -> None:
        """La casaNone de lectores puros no equivale a una carpeta compartida."""
        uno = fuentes.cargar_fuente("ia_nacional", tema="ia_y_trabajo")
        otro = fuentes.cargar_fuente("encuestas_isco4", tema="ia_y_trabajo")
        with (
            mock.patch.object(fuentes, "cargar_fuente", side_effect=[uno, replace(otro, casa_datos=uno.casa_datos)]),
            self.assertRaisesRegex(fuentes.ErrorDescriptor, "casa_datos global"),
        ):
            fuentes.cargar_descriptores(EXTERNOS, tema="ia_y_trabajo")
        self.assertEqual(len(fuentes.cargar_descriptores(CATALOGO)), 2)

    def test_readmes_cuatro_son_generados_exactos(self) -> None:
        """No se mantiene otra política manual en los cuatroREADME nuevos."""
        for tema, ids in (("cursos", CATALOGO), ("ia_y_trabajo", EXTERNOS)):
            for identidad in ids:
                d = fuentes.cargar_fuente(identidad, tema=tema)
                self.assertEqual(
                    (PLATAFORMA / tema / "fuentes" / identidad / "README.md").read_text(), fuentes.generar_readme(d)
                )
