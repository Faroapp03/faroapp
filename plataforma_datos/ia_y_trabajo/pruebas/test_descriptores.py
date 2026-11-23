"""Las fichas de IA conservan productores, política y documentación del registro real."""

import unittest
from pathlib import Path

from plataforma_datos.contratos.fuentes import cargar_descriptores, comprobar_lector, generar_readme
from plataforma_datos.orquestacion.modulos import MODULOS
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS
from plataforma_datos.orquestacion.reconstruir import FUENTES_EN_ORDEN

REGISTRADOS = frozenset(
    {
        "cambra",
        "hechos_informe",
        "tich",
        "mundo_eurostat",
        "tic_llars",
        "clima_empresarial",
        "ue_eurostat",
        "decada_digital",
        "eurobarometro",
        "ceo_panel",
        "ia_nacional_isl",
        "ia_nacional_gbr",
        "ia_nacional_bra",
        "ia_nacional_che",
        "ia_nacional_isr",
        "ia_nacional_kor",
    }
)
EXTERNOS = frozenset({"ia_nacional", "encuestas_isco4"})


class PruebaDescriptoresIA(unittest.TestCase):
    """La metadata no cambia quién se ejecuta ni registra los dos productores externos."""

    def test_lectores_y_politicas_son_los_del_registro(self) -> None:
        """Las quince fichas coinciden con cada productor estático y su operación efectiva."""
        descriptores = tuple(d for d in cargar_descriptores(tema="ia_y_trabajo") if d.modalidad == "operativa")
        self.assertEqual({d.id for d in descriptores}, REGISTRADOS)
        lectores = dict(FUENTES_EN_ORDEN)
        modulos = {m.id: m for m in MODULOS}
        for descriptor in descriptores:
            with self.subTest(fuente=descriptor.id):
                lector = lectores[descriptor.id]
                comprobar_lector(
                    descriptor,
                    identificador=descriptor.id,
                    modulo=lector.__name__,
                    casa=lector.FUENTE,
                )
                self.assertEqual(descriptor.actualizacion, FUENTES[descriptor.id])
                self.assertEqual(descriptor.conjuntos, tuple(c for c in CONJUNTOS if c.fuente == descriptor.id))
                self.assertEqual(descriptor.dependencias, modulos[descriptor.id].entradas)

    def test_productores_externos_siguen_fuera_del_registro(self) -> None:
        """Mover código externo no le concede un productor principal ni consulta automática."""
        self.assertFalse(EXTERNOS.intersection(dict(FUENTES_EN_ORDEN)))
        self.assertFalse(EXTERNOS.intersection(FUENTES))
        for externo in EXTERNOS:
            with self.subTest(fuente=externo):
                conjunto = next(c for c in CONJUNTOS if c.id == externo)
                self.assertIsNone(conjunto.fuente)
                self.assertEqual(conjunto.operacion, "revision")
                self.assertIsNone(conjunto.intervalo_dias)

    def test_documentacion_deriva_de_las_fichas(self) -> None:
        """Cada README mantiene exactamente el contrato operativo que se acaba de cargar."""
        fuentes = Path(__file__).resolve().parents[1] / "fuentes"
        for descriptor in cargar_descriptores(tema="ia_y_trabajo"):
            with self.subTest(fuente=descriptor.id):
                self.assertEqual(
                    (fuentes / descriptor.id / "README.md").read_text(),
                    generar_readme(descriptor),
                )
