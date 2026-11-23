"""Pruebas de los textos de tareas (textos.py): procedencia, estado de cada archivo, controles y combinación."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.ocupaciones.fuentes.textos.lector as textos
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import guardar_jsonl
from plataforma_datos.comun.nucleo import (
    FormatoInesperado,
    ValidacionFallida,
)
from plataforma_datos.orquestacion import admision

REDACTADO_CON_IA = "redactado con IA"
TRADUCIDO_CON_IA = "traducido con IA"


class PruebaTextos(unittest.TestCase):
    """Procedencia, controles y combinación de los textos de tareas."""

    def setUp(self) -> None:
        """Textos de prueba en una carpeta temporal: piloto, generadas y traducidas; se liberan aunque algo falle."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        carpeta = Path(temporal.name)
        piloto = {
            "estado": "x",
            "tareas": {"1111-1": {"corto": "a", "texto_es": "b", "ia_podria": "c", "lo_tuyo": "d"}},
        }
        (carpeta / textos.PILOTO).write_text(json.dumps(piloto), encoding="utf-8")
        generada = {"id": "1111-1", "corto": "g", "texto_es": "g", "ia_podria": "g", "lo_tuyo": "g"}
        generada.update(estado=REDACTADO_CON_IA, modelo="m", fecha="2026-01-01", huella_instrucciones="h1")
        traducida = {"id": "1111-2", "corto": "t", "texto_es": "t", "estado": TRADUCIDO_CON_IA}
        traducida.update(modelo="m", fecha="2026-01-02", huella_instrucciones="h2")
        self.lineas = {textos.GENERADAS: [generada], textos.TRADUCIDAS: [traducida]}
        for nombre, lineas in self.lineas.items():
            guardar_jsonl(carpeta / nombre, lineas)
        parche = mock.patch.object(textos, "PREPARADO", carpeta)
        parche.start()
        self.addCleanup(parche.stop)
        aviso = mock.patch.object(textos, "aviso_traduccion", return_value="Aviso OIT de prueba, literal.")
        aviso.start()
        self.addCleanup(aviso.stop)

    def test_combinar_por_preferencia(self) -> None:
        """La redacción manual manda sobre la generada, y esta sobre la traducción; el estado resume el conjunto."""
        combinados = textos.combinar()
        self.assertEqual(combinados["tareas"]["1111-1"]["corto"], "a")
        self.assertEqual(combinados["tareas"]["1111-2"], {"corto": "t", "texto_es": "t", "estado": TRADUCIDO_CON_IA})
        self.assertEqual(combinados["estado"], "1 tareas: redacción manual; 1 tareas: traducido con IA")

    def test_una_linea_generada_sin_redaccion_no_pasa_el_control_de_su_archivo(self) -> None:
        """El archivo de redacción con IA exige «La IA podría» y «Lo tuyo»: sin ellos, su control falla."""
        generada = {
            campo: valor
            for campo, valor in self.lineas[textos.GENERADAS][0].items()
            if campo not in textos.CAMPOS_REDACCION
        }
        guardar_jsonl(textos.PREPARADO / textos.GENERADAS, [{**generada, "id": "1111-3"}])
        controles = textos.Controles()
        oficiales = {"1111-1": {}, "1111-2": {}, "1111-3": {}}
        textos._comprobar_archivo(controles, textos.GENERADAS, oficiales)
        self.assertIn(f"{textos.GENERADAS}: 1 textos correctos", controles.fallidos)
        self.assertTrue(textos.problemas_de_textos([{**generada, "id": "1111-3"}], oficiales, con_redaccion=True))

    def test_procedencia_registra_la_generacion(self) -> None:
        """La procedencia guarda la huella de cada archivo y con qué modelo e instrucciones se generó."""
        casos = (
            (textos.GENERADAS, "redactar-tareas", "instruccionesRedactar", "2026-01-01", "h1"),
            (textos.TRADUCIDAS, "traducir-tareas-oficiales", "instruccionesTraducirOficiales", "2026-01-02", "h2"),
        )
        for nombre, herramienta, instrucciones, fecha, huella in casos:
            with self.subTest(archivo=nombre):
                registro = textos._registro_procedencia(nombre)
                self.assertEqual(registro["sha256"], entrada_salida.sha256(textos.PREPARADO / nombre))
                self.assertEqual((registro["herramienta"], registro["instrucciones"]), (herramienta, instrucciones))
                self.assertEqual(
                    (registro["modelos"], registro["fechas"], registro["huellas_instrucciones"]),
                    ({"m": 1}, {fecha: 1}, {huella: 1}),
                )

    def test_controles(self) -> None:
        """Con su procedencia al día, los textos se admiten; un archivo cambiado después ya no."""
        procedencia = {"archivos": [textos._registro_procedencia(nombre) for nombre in textos.ARCHIVOS]}
        oficiales = {"1111-1": {}, "1111-2": {}}
        self.assertTrue(textos._controles(procedencia, oficiales).admitido)
        (textos.PREPARADO / textos.TRADUCIDAS).write_text("", encoding="utf-8")
        self.assertFalse(textos._controles(procedencia, oficiales).admitido)

    def test_textos_correctos(self) -> None:
        """Textos completos de tareas oficiales, en cualquiera de los tres estados: se admiten."""
        tareas = {
            "1111-1": {"corto": "a", "texto_es": "b", "estado": TRADUCIDO_CON_IA},
            "1111-2": {"corto": "a", "texto_es": "b", "ia_podria": "d", "lo_tuyo": "e", "estado": REDACTADO_CON_IA},
            "1111-3": {"corto": "a", "texto_es": "b", "estado": "redacción manual"},
        }
        textos.validar_textos(tareas, {"1111-1": {}, "1111-2": {}, "1111-3": {}})

    def test_textos_con_problemas(self) -> None:
        """Una tarea ajena, un campo vacío, una redacción a medias o un estado desconocido impiden exportar."""
        oficiales = {"1111-1": {}}
        casos = [
            {"9999-1": {"corto": "a", "texto_es": "b", "estado": TRADUCIDO_CON_IA}},
            {"1111-1": {"corto": " ", "texto_es": "b", "estado": TRADUCIDO_CON_IA}},
            {"1111-1": {"corto": "a", "texto_es": "b", "estado": REDACTADO_CON_IA, "ia_podria": "d"}},
            # Un estado que no es ninguno de los tres ocultaría al motor que el texto se hizo con IA.
            {"1111-1": {"corto": "a", "texto_es": "b", "estado": "traducido automáticamente"}},
        ]
        for tareas in casos:
            with self.subTest(tareas=tareas), self.assertRaises(ValidacionFallida):
                textos.validar_textos(tareas, oficiales)

    def test_cada_archivo_con_su_estado(self) -> None:
        """Lo escrito con IA no puede decir que es redacción manual, ni lo traducido que es redactado."""
        oficiales = {"1111-1": {}, "1111-2": {}}
        for nombre, estado_ajeno in ((textos.GENERADAS, "redacción manual"), (textos.TRADUCIDAS, REDACTADO_CON_IA)):
            with self.subTest(archivo=nombre):
                lineas = [{**linea, "estado": estado_ajeno} for linea in self.lineas[nombre]]
                guardar_jsonl(textos.PREPARADO / nombre, lineas)
                # Se restaura antes de afirmar y aunque los controles fallen: el caso siguiente lee el archivo bueno.
                procedencia = {"archivos": [textos._registro_procedencia(archivo) for archivo in textos.ARCHIVOS]}
                try:
                    controles = textos._controles(procedencia, oficiales)
                finally:
                    guardar_jsonl(textos.PREPARADO / nombre, self.lineas[nombre])
                self.assertEqual(controles.fallidos, [f"{nombre}: 1 textos correctos"])


class PruebaRegresionesTextos(unittest.TestCase):
    """Entradas defectuosas y conservación de la lectura que se comprobó."""

    setUp = PruebaTextos.setUp

    def test_redaccion_presente_tiene_que_ser_texto_no_vacio(self) -> None:
        """Los dos campos opcionales presentes deben contener texto utilizable por el motor."""
        for valor in ("", "  ", None, 1, []):
            with self.subTest(valor=valor), self.assertRaises(ValidacionFallida):
                textos.validar_textos(
                    {
                        "1111-1": {
                            "corto": "a",
                            "texto_es": "b",
                            "estado": REDACTADO_CON_IA,
                            "ia_podria": valor,
                            "lo_tuyo": "d",
                        }
                    },
                    {"1111-1": {}},
                )

    def test_linea_sin_identificador_da_error_de_fuente(self) -> None:
        """Un registro sin id válido señala archivo y registro, sin KeyError ni TypeError."""
        for registro in ({"corto": "x"}, {"id": []}, {"id": ""}, None):
            guardar_jsonl(textos.PREPARADO / textos.GENERADAS, [registro])
            with (
                self.subTest(registro=registro),
                self.assertRaisesRegex(FormatoInesperado, textos.GENERADAS + ".*registro 1"),
            ):
                textos._lineas(textos.GENERADAS)

    def test_validar_generada_incompleta_guarda_informe_rechazado(self) -> None:
        """El control de redacción incompleta escribe informe y falla como ValidacionFallida."""
        generada = {k: v for k, v in self.lineas[textos.GENERADAS][0].items() if k not in textos.CAMPOS_REDACCION}
        guardar_jsonl(textos.PREPARADO / textos.GENERADAS, [{**generada, "id": "1111-3"}])
        procedencia = {"archivos": [textos._registro_procedencia(n) for n in textos.ARCHIVOS]}
        informe = textos.PREPARADO / "validacion-prueba.json"
        with (
            mock.patch.object(
                textos,
                "leer_json",
                side_effect=lambda ruta: procedencia if ruta == textos.PROCEDENCIA else entrada_salida.leer_json(ruta),
            ),
            mock.patch.object(
                textos, "leer_validado", return_value={"tareas": {"1111-1": {}, "1111-2": {}, "1111-3": {}}}
            ),
            mock.patch.object(
                entrada_salida,
                "carpetas",
                return_value=entrada_salida.Carpetas(textos.PREPARADO, textos.PREPARADO, textos.PREPARADO),
            ),
            mock.patch.object(
                admision,
                "carpetas",
                return_value=entrada_salida.Carpetas(textos.PREPARADO, textos.PREPARADO, textos.PREPARADO),
            ),
            mock.patch.object(
                admision, "guardar_validacion", side_effect=lambda _, x: entrada_salida.guardar_json(informe, x)
            ),
            self.assertRaises(ValidacionFallida),
        ):
            textos.validar()
        self.assertEqual(entrada_salida.leer_json(informe)["estado"], "Con errores")

    def test_validacion_usa_una_sola_captura(self) -> None:
        """Cada archivo se lee una vez y la huella del informe corresponde a esos bytes."""
        procedencia = {"archivos": [textos._registro_procedencia(n) for n in textos.ARCHIVOS]}
        leidos = []
        original = Path.read_bytes

        def leer(ruta: Path) -> bytes:
            leidos.append(ruta.name)
            return original(ruta)

        with (
            mock.patch.object(
                textos,
                "leer_json",
                side_effect=lambda ruta: procedencia if ruta == textos.PROCEDENCIA else entrada_salida.leer_json(ruta),
            ),
            mock.patch.object(textos, "leer_validado", return_value={"tareas": {"1111-1": {}, "1111-2": {}}}),
            mock.patch.object(textos, "cerrar_validacion") as cerrar,
            mock.patch.object(Path, "read_bytes", leer),
        ):
            textos.validar()
        self.assertEqual(leidos, list(textos.ARCHIVOS))
        self.assertEqual(
            cerrar.call_args.args[1]["sha256"], {x["archivo"]: x["sha256"] for x in procedencia["archivos"]}
        )

    def test_exporta_la_captura_admitida_aunque_cambie_archivo(self) -> None:
        """Una edición posterior no sustituye los bytes admitidos entre comprobación y combinación."""
        procedencia = {"sha256": {n: textos._registro_procedencia(n)["sha256"] for n in textos.ARCHIVOS}}
        with mock.patch.object(textos, "exigir_admitido", return_value=procedencia):
            archivos = textos.archivos_validados()
        (textos.PREPARADO / textos.TRADUCIDAS).write_text("", encoding="utf-8")
        self.assertEqual(list(archivos), list(textos.ARCHIVOS))
        self.assertIn("1111-2", textos.combinar(archivos)["tareas"])
        with (
            mock.patch.object(textos, "exigir_admitido", return_value=procedencia),
            self.assertRaises(ValidacionFallida),
        ):
            textos.archivos_validados()

    def test_aviso_no_anuncia_identificadores_ocultos_si_caben(self) -> None:
        """Un aviso corto muestra su lista exacta; solo una lista truncada lleva puntos suspensivos."""
        base = {"corto": "a", "texto_es": "b", "estado": TRADUCIDO_CON_IA}
        self.assertNotIn("…", textos.problemas_de_textos([{"id": "1", **base}], {})[0])
        self.assertIn("…", textos.problemas_de_textos([{"id": str(i), **base} for i in range(6)], {})[0])

    def test_generacion_exige_campos_de_texto_no_vacios(self) -> None:
        """Modelo, fecha e instrucciones no se acreditan con booleanos, listas ni números."""
        for campo in textos.CAMPOS_GENERACION:
            for valor in (7, ["x"], True, "  "):
                linea = {**self.lineas[textos.GENERADAS][0], campo: valor}
                guardar_jsonl(textos.PREPARADO / textos.GENERADAS, [linea])
                controles = textos.Controles()
                textos._comprobar_archivo(controles, textos.GENERADAS, {"1111-1": {}})
                with self.subTest(campo=campo, valor=valor):
                    self.assertIn(
                        f"{textos.GENERADAS}: cada texto registra modelo, fecha y huella de las instrucciones",
                        controles.fallidos,
                    )

    def test_estado_no_textual_se_rechaza_sin_typeerror(self) -> None:
        """Un estado sin forma de texto queda en el control; el resumen no oculta su diagnóstico."""
        oficiales = {"1111-1": {}, "1111-2": {}}
        for valor in ([], {"otro": "estado"}):
            guardar_jsonl(
                textos.PREPARADO / textos.TRADUCIDAS, [{**self.lineas[textos.TRADUCIDAS][0], "estado": valor}]
            )
            procedencia = {"archivos": [textos._registro_procedencia(n) for n in textos.ARCHIVOS]}
            with self.subTest(valor=valor):
                controles = textos._controles(procedencia, oficiales)
                self.assertIn(f"{textos.TRADUCIDAS}: 1 textos correctos", controles.fallidos)
                combinado = textos.combinar()
                self.assertEqual(combinado["tareas"]["1111-2"]["estado"], valor)
                cobertura = textos._cobertura(oficiales, combinado["tareas"])
                self.assertIn(str(valor), cobertura["estados"])


if __name__ == "__main__":
    unittest.main()
