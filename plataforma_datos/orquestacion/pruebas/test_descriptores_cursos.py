"""Los descriptores de cursos gobiernan la operación y rechazan registros divergentes."""

import json
import shutil
import tempfile
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.contratos import fuentes
from plataforma_datos.orquestacion import actualizar, modulos
from plataforma_datos.orquestacion import planificacion_de_comprobaciones as planificacion
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import FUENTES
from plataforma_datos.orquestacion.planificacion_de_comprobaciones import CONJUNTOS


class PruebaConexionDescriptores(unittest.TestCase):
    """Comprueba consumidores reales contra su referencia independiente de las fichas."""

    def test_registros_conservan_politicas_cadencias_y_dependencias(self) -> None:
        """La expectativa congelada no se calcula desde las fichas ni el registro activo."""
        ruta = Path(fuentes.__file__).parent / "pruebas/operacion-cursos-v1.json"
        esperado = json.loads(ruta.read_text(encoding="utf-8"))
        reales = {modulo.id: modulo for modulo in modulos.MODULOS}
        for identidad, dato in esperado.items():
            with self.subTest(fuente=identidad):
                self.assertEqual(FUENTES[identidad]._asdict(), dato["actualizacion"])
                self.assertEqual([c._asdict() for c in CONJUNTOS if c.fuente == identidad], dato["conjuntos"])
                self.assertEqual(list(reales[identidad].entradas), dato["dependencias"])
                self.assertEqual(reales[identidad].fuentes, (identidad,))
        self.assertEqual(len(CONJUNTOS), len({c.id for c in CONJUNTOS}))
        self.assertEqual(modulos.comprobar_registro(), [])

    def test_ficha_no_puede_activar_un_lector_ajeno(self) -> None:
        """El descubrimiento documental exige productor estático; no ejecuta un módulo del JSON."""
        ficha = replace(fuentes.cargar_fuente("fundae"), id="ajena")
        with mock.patch.object(modulos, "cargar_descriptores", return_value=(ficha,)):
            self.assertIn("ajena: descriptor sin productor estático", modulos.comprobar_registro())

    def test_modulo_o_casa_distintos_se_rechazan(self) -> None:
        """Una ruta coincidente por nombre no permite sustituir la implementación o casa real."""
        ficha = fuentes.cargar_fuente("memoria")
        for campo, valor in (("lector", "os.system"), ("casa_datos", "otra")):
            with (
                self.subTest(campo=campo),
                mock.patch.object(modulos, "cargar_descriptores", return_value=(replace(ficha, **{campo: valor}),)),
            ):
                self.assertTrue(any("identidad del lector estático" in x for x in modulos.comprobar_registro()))

    def test_politica_y_dependencias_divergentes_se_detectan(self) -> None:
        """No se puede mantener otra configuración activa que contradiga la ficha."""
        ficha = fuentes.cargar_fuente("fundae")
        self.assertTrue(ficha.actualizacion.red)
        self.assertEqual(ficha.actualizacion.politica, "diaria")
        casos = (
            (replace(ficha, actualizacion=ficha.actualizacion._replace(red=False)), "política"),
            (replace(ficha, actualizacion=ficha.actualizacion._replace(politica="manual")), "política"),
            (replace(ficha, dependencias=("esco",)), "dependencias"),
        )
        for diferente, campo in casos:
            with (
                self.subTest(campo=campo),
                mock.patch.object(modulos, "cargar_descriptores", return_value=(diferente,)),
            ):
                self.assertTrue(any(f"fundae: {campo} distinta" in x for x in modulos.comprobar_registro()))

    def test_originales_no_pueden_ser_los_de_otra_fuente(self) -> None:
        """El directorio que se sustituye debe pertenecer a la casa de este productor."""
        ruta = Path(fuentes.__file__).parents[1] / "cursos/fuentes/fundae/fuente.json"
        dato = json.loads(ruta.read_text(encoding="utf-8"))
        dato["actualizacion"]["originales"] = "formacion"
        with self.assertRaisesRegex(fuentes.ErrorDescriptor, "originales fuera"):
            fuentes.validar_descriptor(dato)

    def test_ids_duplicados_no_generan_un_plan_incompleto(self) -> None:
        """Un intento del SOC no puede ocultar una consulta independiente del Consorci."""
        conjuntos = tuple(c._replace(id="soc-oferta") if c.fuente == "consorci" else c for c in CONJUNTOS)
        ahora = datetime(2026, 10, 22, tzinfo=UTC)
        with mock.patch.object(planificacion, "CONJUNTOS", conjuntos):
            with self.assertRaisesRegex(ValueError, "duplicadas"):
                planificacion.planificar(ahora, {"soc-oferta": ahora})
            self.assertTrue(any("duplicadas" in f for f in modulos.comprobar_registro()))

    def test_conjuntos_consumidos_coinciden_con_el_descriptor(self) -> None:
        """Una cadencia distinta en memoria no puede contradecir la ficha operativa."""
        conjuntos = tuple(c._replace(intervalo_dias=99) if c.id == "soc-oferta" else c for c in CONJUNTOS)
        with mock.patch.object(planificacion, "CONJUNTOS", conjuntos):
            self.assertIn("formacion: conjuntos distintos del descriptor", modulos.comprobar_registro())

    def test_configuracion_incoherente_se_para_antes_de_cualquier_efecto(self) -> None:
        """La entrada real comprueba JSON alterados antes de cerrojo, área, consulta o escritura."""
        instaladas = Path(fuentes.__file__).parents[1] / "cursos/fuentes"
        with tempfile.TemporaryDirectory(prefix="registro-fuentes-") as temporal:
            raiz = Path(temporal)
            copia = raiz / "fuentes"
            for ruta in instaladas.glob("*/fuente.json"):
                destino = copia / ruta.parent.name / ruta.name
                destino.parent.mkdir(parents=True)
                shutil.copyfile(ruta, destino)
            archivo = copia / "fundae/fuente.json"
            original = json.loads(archivo.read_text(encoding="utf-8"))
            for cambio in ("originales", "casa", "conjuntos"):
                dato = json.loads(json.dumps(original))
                if cambio == "originales":
                    dato["actualizacion"]["originales"] = "formacion"
                elif cambio == "casa":
                    dato["casa_datos"] = "ajena"
                    dato["actualizacion"]["originales"] = "ajena"
                else:
                    dato["conjuntos"][0]["id"] = "soc-oferta"
                archivo.write_text(json.dumps(dato), encoding="utf-8")
                with (
                    self.subTest(cambio=cambio),
                    mock.patch.object(fuentes, "carpeta_de_fuentes", return_value=copia),
                    mock.patch.object(actualizar.sustitucion, "cerrojo") as cerrojo,
                    mock.patch.object(actualizar, "preparar_area") as area,
                    mock.patch.object(actualizar.comprobaciones_remotas, "iniciar_ciclo") as ciclo,
                    mock.patch("builtins.print"),
                ):
                    ejecutor = mock.Mock()
                    resultado = actualizar.actualizar_con_resultado(raiz, actualizar.Opciones(), ejecutor)
                    self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
                    cerrojo.assert_not_called()
                    area.assert_not_called()
                    ciclo.assert_not_called()
                    ejecutor.assert_not_called()

    def test_descriptor_corrupto_no_se_ignora(self) -> None:
        """El inventario conserva el fallo del contrato en vez de fingir una fuente válida."""
        with mock.patch.object(modulos, "cargar_descriptores", side_effect=fuentes.ErrorDescriptor("dañado")):
            self.assertTrue(any("descriptores de Cursos no válidos" in x for x in modulos.comprobar_registro()))


if __name__ == "__main__":
    unittest.main()
