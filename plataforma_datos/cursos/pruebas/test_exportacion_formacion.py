"""Composición focal de formación y escritura explícita, sin datos reales."""

import hashlib
import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

import plataforma_datos.cursos.fuentes.formacion.exportacion as formacion
from plataforma_datos.comun.nucleo import ArchivoFaltante, ErrorFuente, FormatoInesperado, ValidacionFallida
from plataforma_datos.orquestacion.exportacion import comun


class PruebaExportacionFormacion(unittest.TestCase):
    """Forma pública, minimización, citas, admisión y huellas del paquete individual."""

    def test_composicion_conserva_orden_cobertura_y_minimiza_cursos(self) -> None:
        """Los tres preparados se leen en orden y solo se publican los campos usados."""
        rutas = {clave: Path(clave) for clave in ("eures", "especialidades", "cursos")}
        eures = [
            {"esco": "u2", "cosispe": "2222", "relacion": "estrecha", "etiqueta": "Dos"},
            {"esco": "u1", "cosispe": "1111", "relacion": "exacta", "etiqueta": "Uno"},
            {"esco": "u2", "cosispe": "2233", "relacion": "amplia", "etiqueta": "Tres"},
        ]
        especialidad = {
            "codigo": "S2",
            "denominacion": "Árbol",
            "nivel": 2,
            "horas": 30,
            "familia": "F",
            "modalidad": "P",
            "ocupaciones": [],
            "ficha": "https://ejemplo.test/S2",
            "campo_interno": "se queda fuera",
        }
        curso = {campo: campo + " á" for campo in formacion.CAMPOS_CURSO}
        cobertura = {"cursos": 1, "ocupaciones": 2}
        with ExitStack() as pila:
            pila.enter_context(mock.patch.object(formacion, "PREPARADOS_FORMACION", rutas))
            admitir = pila.enter_context(
                mock.patch.object(formacion, "exigir_admitido", return_value={"cobertura": cobertura})
            )
            pila.enter_context(mock.patch.object(formacion, "requerir", side_effect=lambda ruta: ruta))
            leer = pila.enter_context(
                mock.patch.object(
                    formacion, "leer_jsonl", side_effect=[eures, [especialidad], [{**curso, "telefono": "privado"}]]
                )
            )
            pila.enter_context(
                mock.patch.object(
                    formacion,
                    "procedencia",
                    side_effect=lambda fuente: (
                        {"descargado": "2026-09-27"}
                        if fuente == "sepe"
                        else {
                            "archivos": [
                                {"archivo": "soc-cursos-2026-09-27.json"},
                                {"archivo": "soc-cursos-2026-09-20.json"},
                            ]
                        }
                    ),
                )
            )
            paquete = formacion.paquete_formacion()
        admitir.assert_called_once_with("formacion")
        self.assertEqual(leer.call_args_list, [mock.call(rutas[k]) for k in rutas])
        self.assertEqual(paquete.origenes, list(rutas.values()))
        self.assertEqual(
            list(paquete.datos), ["fuentes", "fecha_cursos", "cobertura", "ocupaciones", "especialidades", "cursos"]
        )
        self.assertEqual(paquete.datos["fecha_cursos"], "2026-09-27")
        self.assertEqual(paquete.datos["cobertura"], cobertura)
        self.assertEqual(list(paquete.datos["ocupaciones"]), ["u2", "u1"])
        self.assertEqual(paquete.datos["ocupaciones"]["u2"], [["2222", "estrecha", "Dos"], ["2233", "amplia", "Tres"]])
        self.assertEqual(
            paquete.datos["especialidades"],
            {
                "S2": {
                    "nombre": "Árbol",
                    "nivel": 2,
                    "horas": 30,
                    "familia": "F",
                    "modalidad": "P",
                    "ocupaciones": [],
                    "ficha": "https://ejemplo.test/S2",
                }
            },
        )
        self.assertEqual(paquete.datos["cursos"], [curso])
        self.assertEqual(
            paquete.datos["fuentes"],
            {
                "sepe": "Origen de los datos: SEPE, Catálogo de Especialidades Formativas (exportado el 27/09/2026).",
                "soc": "Generalitat de Catalunya. Servei Públic d'Ocupació de Catalunya: cursos y especialidades "
                "formativas (datos abiertos).",
                "eures": "© Unión Europea. Correspondencia EURES entre ESCO y CO-SISPE 2011.",
            },
        )

    def test_correspondencia_eures_aparte_es_la_misma_de_formacion(self) -> None:
        """correspondencia-eures.json lleva la cita y las relaciones de formacion.json, del mismo preparado."""
        ruta = Path("eures")
        eures = [
            {"esco": "u2", "cosispe": "2222", "relacion": "estrecha", "etiqueta": "Dos"},
            {"esco": "u1", "cosispe": "1111", "relacion": "exacta", "etiqueta": "Uno"},
            {"esco": "u2", "cosispe": "2233", "relacion": "amplia", "etiqueta": "Tres"},
        ]
        with ExitStack() as pila:
            pila.enter_context(mock.patch.object(formacion, "PREPARADOS_FORMACION", {"eures": ruta}))
            admitir = pila.enter_context(mock.patch.object(formacion, "exigir_admitido", return_value={}))
            pila.enter_context(mock.patch.object(formacion, "requerir", side_effect=lambda origen: origen))
            leer = pila.enter_context(mock.patch.object(formacion, "leer_jsonl", return_value=eures))
            paquete = formacion.paquete_correspondencia_eures()
        admitir.assert_called_once_with("formacion")
        leer.assert_called_once_with(ruta)
        self.assertEqual(paquete.origenes, [ruta])
        self.assertEqual(list(paquete.datos), ["fuente", "ocupaciones"])
        self.assertEqual(paquete.datos["fuente"], "© Unión Europea. Correspondencia EURES entre ESCO y CO-SISPE 2011.")
        self.assertEqual(list(paquete.datos["ocupaciones"]), ["u2", "u1"])
        self.assertEqual(paquete.datos["ocupaciones"]["u2"], [["2222", "estrecha", "Dos"], ["2233", "amplia", "Tres"]])

    def test_correspondencia_eures_exige_la_fuente_admitida(self) -> None:
        """Sin la formación admitida no se lee el preparado de EURES."""
        with (
            mock.patch.object(formacion, "exigir_admitido", side_effect=ValidacionFallida("no admitida")),
            mock.patch.object(formacion, "leer_jsonl") as leer,
            self.assertRaises(ValidacionFallida),
        ):
            formacion.paquete_correspondencia_eures()
        leer.assert_not_called()

    def test_no_compone_fuente_no_admitida(self) -> None:
        """La admisión precede a cualquier lectura del preparado."""
        with (
            mock.patch.object(formacion, "exigir_admitido", side_effect=ValidacionFallida("no admitida")),
            mock.patch.object(formacion, "leer_jsonl") as leer,
            self.assertRaises(ValidacionFallida),
        ):
            formacion.paquete_formacion()
        leer.assert_not_called()

    def test_no_compone_si_falta_un_preparado(self) -> None:
        """Un origen ausente falla antes de componer el contenido."""
        with (
            mock.patch.object(formacion, "exigir_admitido", return_value={}),
            mock.patch.object(formacion, "requerir", side_effect=ArchivoFaltante("falta")),
            self.assertRaises(ArchivoFaltante),
        ):
            formacion.paquete_formacion()

    def test_fecha_de_cita_exige_fecha_iso_del_calendario(self) -> None:
        """Una marca horaria o una fecha imposible no puede convertirse en una cita falsa."""
        self.assertEqual(formacion._fecha_es("2024-02-29"), "29/02/2024")
        self.assertEqual(formacion._fecha_es("0001-01-02"), "02/01/0001")
        for fecha in ("2026-09-27T10:00", "2026-02-30", "20260927", "2026-9-7"):
            with self.subTest(fecha=fecha), self.assertRaises(FormatoInesperado):
                formacion._fecha_es(fecha)

    def test_cursos_exigen_copia_en_procedencia(self) -> None:
        """La fecha pública se obtiene de una copia registrada de cursos."""
        with (
            mock.patch.object(formacion, "procedencia", return_value={"archivos": [{"archivo": "otro.json"}]}),
            self.assertRaises(ErrorFuente),
        ):
            formacion._fecha_cursos()

    def test_copia_de_cursos_exige_fecha_real(self) -> None:
        """Una copia con nombre sintáctico pero fecha imposible no puede publicarse."""
        with (
            mock.patch.object(
                formacion, "procedencia", return_value={"archivos": [{"archivo": "soc-cursos-2026-02-30.json"}]}
            ),
            self.assertRaises(FormatoInesperado),
        ):
            formacion._fecha_cursos()

    def test_origen_ausente_no_reemplaza_salida_previa(self) -> None:
        """Las huellas se comprueban antes de sustituir el paquete público."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            destino = raiz / "salida.json"
            destino.write_bytes(b"previo")
            with self.assertRaises(FileNotFoundError):
                comun.escribir("salida.json", comun.Paquete({}, [raiz / "ausente"]), raiz, formato="compacto")
            self.assertEqual(destino.read_bytes(), b"previo")

    def test_escribir_formatos_y_huellas_sin_tocar_manifiesto(self) -> None:
        """Ambos formatos conservan caracteres, orden y SHA de todos los orígenes."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            origenes = [raiz / "entrada á", raiz / "entrada b"]
            for origen, contenido in zip(origenes, (b"uno\n", b"dos\n"), strict=True):
                origen.write_bytes(contenido)
            manifiesto = raiz / "manifiesto.json"
            manifiesto.write_bytes(b"intocable\n")
            paquete = comun.Paquete({"z": "á", "a": [1]}, origenes)
            for formato in ("compacto", "sangrado"):
                with self.subTest(formato=formato):
                    entrada = comun.escribir("salida.json", paquete, raiz, formato=formato)
                    esperado = (
                        json.dumps(paquete.datos, ensure_ascii=False, separators=(",", ":"))
                        if formato == "compacto"
                        else json.dumps(paquete.datos, ensure_ascii=False, indent=2)
                    )
                    contenido = (esperado + ("\n" if formato == "sangrado" else "")).encode()
                    self.assertEqual((raiz / "salida.json").read_bytes(), contenido)
                    self.assertEqual(
                        entrada,
                        {
                            "origenes": {
                                str(r.resolve()): hashlib.sha256(r.read_bytes()).hexdigest() for r in origenes
                            },
                            "sha256": hashlib.sha256(contenido).hexdigest(),
                        },
                    )
                    self.assertEqual(manifiesto.read_bytes(), b"intocable\n")

    def test_formato_invalido_no_escribe(self) -> None:
        """Una selección errónea no pisa un archivo existente."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            destino = raiz / "salida.json"
            destino.write_bytes(b"previo")
            with self.assertRaises(ValueError):
                comun.escribir("salida.json", comun.Paquete({}, []), raiz, formato="otro")
            self.assertEqual(destino.read_bytes(), b"previo")

    def test_fallo_de_serializacion_conserva_salida_previa(self) -> None:
        """El guardado común no sustituye el archivo si falla la serialización."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            destino = raiz / "salida.json"
            destino.write_bytes(b"previo")
            with self.assertRaises(TypeError):
                comun.escribir("salida.json", comun.Paquete({"mal": object()}, []), raiz, formato="compacto")
            self.assertEqual(destino.read_bytes(), b"previo")


if __name__ == "__main__":
    unittest.main()
