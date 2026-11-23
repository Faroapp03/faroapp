"""Una admisión de empresas no sobrevive al cambio de los contratos que la produjeron."""

import json
import unittest
from pathlib import Path

import plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce as contrato_eticce
import plataforma_datos.mercado.fuentes.empresas.piezas.correspondencia_cnae as correspondencia_cnae
import plataforma_datos.mercado.fuentes.empresas.piezas.periodos_empresas as periodos_empresas
import plataforma_datos.mercado.pruebas.test_periodos_empresas as test_periodos_empresas
from plataforma_datos.comun.nucleo import Controles, FormatoInesperado, ValidacionFallida
from plataforma_datos.mercado.pruebas.ayuda_contratos_empresas import RUTA_CNAE, InstalacionContratosEmpresas
from plataforma_datos.mercado.pruebas.test_correspondencia_cnae import filas_de_prueba
from plataforma_datos.orquestacion import admision
from plataforma_datos.orquestacion.exportacion.validados import paquete_validado


class PruebaContratosEmpresas(InstalacionContratosEmpresas, unittest.TestCase):
    """Los originales y la admisión antigua permanecen intactos mientras cambia solo un recurso local."""

    def test_contratos_tienen_casa_unica_y_no_remapean_admisiones_antiguas(self) -> None:
        """Trasladar recursos exige validar realmente: las rutas del informe previo no se reescriben."""
        casa = "plataforma_datos/mercado/fuentes/empresas/contratos/"
        self.assertEqual(
            set(contrato_eticce.vinculos_actuales()),
            {casa + "empresas-eticce2026.json", casa + "empresas-cnae2025.json"},
        )
        self.validacion["recursos_de_validacion"] = {
            "cadena_de_datos/contratos/" + Path(ruta).name: huella
            for ruta, huella in self.validacion["recursos_de_validacion"].items()
        }
        self.informe.write_text(json.dumps(self.validacion), encoding="utf-8")
        anteriores = self.informe.read_bytes(), self.conjunto.read_bytes()
        with self.assertRaises(ValidacionFallida):
            admision.exigir_admitido("empresas")
        self.assertEqual((self.informe.read_bytes(), self.conjunto.read_bytes()), anteriores)

    def test_cambiar_correspondencia_invalida_admision_anterior(self) -> None:
        """La mutación que cambia la inclusión de 45 exige revisar y validar otra vez."""
        antes = self.informe.read_bytes(), self.conjunto.read_bytes()
        self.assertEqual(
            correspondencia_cnae.agrupaciones_para_cnae09(filas_de_prueba(), {45})["Total Empresas"]["divisiones"], []
        )
        contrato = json.loads(self.cnae.read_text())
        for clase in ["45.11", "45.19", "45.20", "45.31", "45.32", "45.40"]:
            contrato["clases_2009_a_2025"][clase] = ["47.11"]
        self.cnae.write_text(json.dumps(contrato), encoding="utf-8")
        self.assertEqual(
            correspondencia_cnae.agrupaciones_para_cnae09(filas_de_prueba(), {45})["Total Empresas"]["divisiones"], [45]
        )
        with self.assertRaises(ValidacionFallida):
            admision.exigir_admitido("empresas")
        self.assertEqual((self.informe.read_bytes(), self.conjunto.read_bytes()), antes)

    def test_cambiar_eticce_impide_exportar_validado_anterior(self) -> None:
        """Incluso un cambio de bytes sin modificar cifras requiere una validación actual."""
        self.eticce.write_bytes(self.eticce.read_bytes() + b" ")
        with self.assertRaises(ValidacionFallida):
            paquete_validado("empresas")

    def test_2026_sin_vinculo_no_se_acepta_como_fixture_historica(self) -> None:
        """Una validación antigua sin recursos no acredita un conjunto declarado como CNAE-2025."""
        self.validacion.pop("recursos_de_validacion")
        self.informe.write_text(json.dumps(self.validacion), encoding="utf-8")
        with self.assertRaises(ValidacionFallida):
            admision.leer_validado("empresas")

    def test_cierre_no_admite_2026_ocultando_edicion_en_el_informe(self) -> None:
        """El propio conjunto también determina que el vínculo contractual es obligatorio."""
        informe = {"estado": "Admitido", "controles": self.validacion["controles"]}
        conjunto = json.loads(self.conjunto.read_text())
        antes = self.informe.read_bytes(), self.conjunto.read_bytes()
        with self.assertRaises(ValidacionFallida):
            admision.cerrar_validacion("empresas", informe, Controles(), lambda: conjunto)
        self.assertEqual((self.informe.read_bytes(), self.conjunto.read_bytes()), antes)

    def test_historico_2025_no_exige_recursos_que_no_utilizo(self) -> None:
        """El contrato anterior conserva su admisión y no depende del nuevo paso CNAE-2025."""
        self.validacion.pop("recursos_de_validacion")
        self.validacion["cobertura"]["edicion"] = "2024–1T2025"
        self.informe.write_text(json.dumps(self.validacion), encoding="utf-8")
        self.conjunto.write_text(json.dumps({"encuesta": {"edicion": "2024–1T2025"}}), encoding="utf-8")
        self.assertEqual(admision.exigir_admitido("empresas")["estado"], "Admitido")

    def test_recurso_cambia_durante_validacion_no_puede_admitir(self) -> None:
        """Se usan bytes fijados, pero se rechaza cerrar si el disco ya contiene otro contrato."""
        antes = self.informe.read_bytes(), self.conjunto.read_bytes()
        with contrato_eticce.recursos_en_uso() as usados:
            original = contrato_eticce.contrato()
            self.eticce.write_bytes(self.eticce.read_bytes().replace(b'"CNAE-2025"', b'"CNAE-invalida"', 1))
            self.assertEqual(contrato_eticce.contrato(), original)
            informe = {**self.validacion, "recursos_de_validacion": usados}
            controles = Controles()
            with self.assertRaises(ValidacionFallida):
                admision.cerrar_validacion("empresas", informe, controles, lambda: {"no_debe_escribirse": True})
        self.assertEqual((self.informe.read_bytes(), self.conjunto.read_bytes()), antes)

    def test_inventario_de_contratos_no_admite_rutas_ajenas_ni_huellas_parciales(self) -> None:
        """La validación no decide qué rutas se abren para comprobar sus contratos."""
        for vinculos in [{}, {RUTA_CNAE: "0" * 64}, {"../ajeno": "0" * 64}]:
            with self.subTest(vinculos=vinculos):
                informe = {**self.validacion, "recursos_de_validacion": vinculos}
                self.informe.write_text(json.dumps(informe), encoding="utf-8")
                with self.assertRaises(ValidacionFallida):
                    admision.exigir_admitido("empresas")

    def test_prueba_historica_no_sustituye_la_admision_actual(self) -> None:
        """La huella histórica se conserva y se exige inventario, mientras el conjunto actual debe revalidarse."""
        tabla, prueba = test_periodos_empresas.PruebaContinuidadEurostat().contexto()
        prueba["edicion"] = "2025–1T2026"
        prueba["validacion"]["cobertura"]["edicion"] = prueba["edicion"]
        prueba["validacion"]["recursos_de_validacion"] = self.validacion["recursos_de_validacion"]
        self.cnae.write_bytes(self.cnae.read_bytes() + b" ")
        with self.assertRaises(ValidacionFallida):
            admision.exigir_admitido("empresas")
        self.assertEqual(periodos_empresas.comprobar_continuidad(tabla, prueba, False), [2025])
        prueba["validacion"].pop("recursos_de_validacion")
        with self.assertRaises(ValidacionFallida):
            periodos_empresas.comprobar_continuidad(tabla, prueba, False)

    def test_edicion_nueva_sin_identificador_se_rechaza(self) -> None:
        """Los datos de 2026 no pueden entrar por la rama histórica al omitir contrato_ine."""
        with self.assertRaises(FormatoInesperado):
            contrato_eticce.es_contrato_2026({"anio": 2026, "nombre": "2025–1T2026"})


if __name__ == "__main__":
    unittest.main()
