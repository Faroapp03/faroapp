"""Solo la oferta SOC válida puede variar sin invalidar catálogo ni vectores."""

import copy
import hashlib
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from plataforma_datos.cursos.fuentes.formacion.constantes import FICHA_CURSO
from plataforma_datos.orquestacion import piezas_de_la_actualizacion as piezas


def formacion() -> dict:
    """Construye un paquete pequeño sin originales ni registros personales.

    Returns:
        Catálogo, relaciones y tres convocatorias sintéticas.
    """
    especialidad = {
        "nombre": "Programa",
        "nivel": "1",
        "horas": "20",
        "familia": "Familia",
        "modalidad": "Presencial",
        "ocupaciones": ["12345678"],
        "ficha": "https://ejemplo.invalid/programa",
    }
    curso = {
        "id": "uno",
        "nombre": "Curso",
        "especialidades": ["ABC"],
        "modalidad": "Presencial",
        "municipio": "Municipio",
        "inicio": "2026-10-18",
        "fin": "2026-10-20",
        "horas": "20",
        "estado": "Abierto",
        "centro": "Centro",
        "enlace": FICHA_CURSO + "uno",
        "destinatarios": "en-busqueda-de-empleo",
    }
    cursos = [{**curso, "id": str(i), "enlace": FICHA_CURSO + str(i)} for i in range(3)]
    return {
        "fuentes": {"sepe": "SEPE", "soc": "SOC", "eures": "EURES"},
        "fecha_cursos": "2026-10-17",
        "cobertura": {
            "ocupaciones_con_especialidad_sepe": 1,
            "ocupaciones_esco": 1,
            "cursos_con_relacion_oficial": 3,
            "cursos": 3,
        },
        "ocupaciones": {"esco": [["12345678", "exacta", "Ocupación"]]},
        "especialidades": {"ABC": especialidad, "DEF": {**especialidad, "nombre": "Otro programa"}},
        "cursos": cursos,
    }


class PruebaOfertaSoc(unittest.TestCase):
    """La excepción se concede desde comparar y conserva las demás alarmas."""

    def setUp(self) -> None:
        """Cada prueba usa dos paquetes pequeños aislados."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz, self.area = (Path(temporal.name) / nombre for nombre in ("raiz", "area"))
        self.antes = formacion()

    @staticmethod
    def escribir(base: Path, documento: object, nombre: str = "formacion.json") -> None:
        """Escribe contenido y manifiesto reales, sin simular los recuentos."""
        carpeta = base / piezas.PAQUETE_RELATIVO
        carpeta.mkdir(parents=True, exist_ok=True)
        contenido = json.dumps(documento, ensure_ascii=False).encode()
        (carpeta / nombre).write_bytes(contenido)
        (carpeta / "manifiesto.json").write_text(
            json.dumps({nombre: {"sha256": hashlib.sha256(contenido).hexdigest()}}), encoding="utf-8"
        )

    def comparar(self, despues: object) -> piezas.Comparacion:
        """Compara ambos documentos mediante el consumidor operativo.

        Returns:
            Comparación de contenido, manifiestos y alarmas.
        """
        self.escribir(self.raiz, self.antes)
        self.escribir(self.area, despues)
        return piezas.comparar(self.raiz, self.area)

    def test_oferta_distinta_con_mismos_recuentos(self) -> None:
        """El contenido de cursos puede renovarse aunque bytes y conteos no detecten su significado."""
        despues = copy.deepcopy(self.antes)
        despues["cursos"][0]["nombre"] = "Nueva"
        resultado = self.comparar(despues)
        self.assertEqual(resultado.paquete[0]["estado"], "cambia")
        self.assertEqual(resultado.alarmas, [])

    def test_fecha_y_cobertura_de_cursos_pueden_renovarse(self) -> None:
        """La copia nueva admite altas y conteos nuevos manteniendo los insumos del catálogo."""
        despues = copy.deepcopy(self.antes)
        despues["fecha_cursos"] = "2026-10-18"
        despues["cursos"].append({**despues["cursos"][0], "id": "nuevo"})
        despues["cobertura"].update(cursos=4, cursos_con_relacion_oficial=4)
        self.assertEqual(self.comparar(despues).alarmas, [])

    def test_campos_fijados_conservan_las_dos_alarmas(self) -> None:
        """Nombres, relaciones, citas y cobertura ESCO no son una actualización de oferta."""
        for campo in ("fuentes", "ocupaciones", "especialidades", "cobertura"):
            despues = copy.deepcopy(self.antes)
            if campo == "fuentes":
                despues[campo]["soc"] = "Otra cita"
            elif campo == "ocupaciones":
                despues[campo]["esco"][0][2] = "Otra etiqueta"
            elif campo == "especialidades":
                despues[campo]["ABC"]["nombre"] = "Otro nombre"
            else:
                despues[campo]["ocupaciones_esco"] = 2
            with self.subTest(campo=campo):
                self.assertEqual(len(self.comparar(despues).alarmas), 2)

    def test_orden_de_catalogo_y_relaciones_no_se_silencia(self) -> None:
        """Los desempates y relaciones conservan su orden original."""
        despues = copy.deepcopy(self.antes)
        despues["especialidades"] = dict(reversed(list(despues["especialidades"].items())))
        self.assertEqual(len(self.comparar(despues).alarmas), 2)
        self.antes["ocupaciones"]["esco"].append(["87654321", "amplia", "Otra"])
        despues = copy.deepcopy(self.antes)
        despues["ocupaciones"]["esco"].reverse()
        self.assertEqual(len(self.comparar(despues).alarmas), 2)

    def test_campos_futuros_no_reciben_excepcion(self) -> None:
        """Las ampliaciones de raíz, cobertura o curso exigen revisar el contrato."""
        for sitio in ("raiz", "cobertura", "curso"):
            despues = copy.deepcopy(self.antes)
            destino = (
                despues if sitio == "raiz" else despues["cobertura"] if sitio == "cobertura" else despues["cursos"][0]
            )
            destino["futuro"] = "nuevo"
            with self.subTest(sitio=sitio):
                self.assertEqual(len(self.comparar(despues).alarmas), 2)

    def test_formas_invalidas_no_reciben_excepcion(self) -> None:
        """Una fecha, contador, curso o catálogo inválidos conservan las alarmas."""
        casos = []
        for campo, valor in (("fecha_cursos", "2026-02-30"), ("cursos", []), ("ocupaciones", [])):
            despues = copy.deepcopy(self.antes)
            despues[campo] = valor
            casos.append(despues)
        for campo, valor in (("inicio", "2026-02-30"), ("destinatarios", "otro"), ("horas", 20), ("id", [])):
            despues = copy.deepcopy(self.antes)
            despues["cursos"][0][campo] = valor
            casos.append(despues)
        despues = copy.deepcopy(self.antes)
        despues["cobertura"]["cursos"] = True
        casos.append(despues)
        despues = copy.deepcopy(self.antes)
        despues["cobertura"]["cursos_con_relacion_oficial"] = 0
        casos.append(despues)
        despues = copy.deepcopy(self.antes)
        despues["cursos"][1]["id"] = despues["cursos"][0]["id"]
        casos.append(despues)
        despues = copy.deepcopy(self.antes)
        del despues["cursos"][0]["inicio"]
        casos.append(despues)
        despues = copy.deepcopy(self.antes)
        despues["especialidades"]["ABC"]["ocupaciones"] = "12345678"
        casos.append(despues)
        for caso in casos:
            with self.subTest(caso=caso):
                self.assertEqual(len(self.comparar(caso).alarmas), 2)

    def test_claves_json_repetidas_no_reciben_excepcion(self) -> None:
        """Una clave duplicada no equivale al último valor que conserve el lector permisivo."""
        despues = copy.deepcopy(self.antes)
        despues["cursos"][0]["nombre"] = "Nueva"
        self.comparar(despues)
        carpeta = self.area / piezas.PAQUETE_RELATIVO
        ruta = carpeta / "formacion.json"
        texto = ruta.read_text(encoding="utf-8").replace('"nombre": "Nueva"', '"nombre": "Otra", "nombre": "Nueva"')
        ruta.write_text(texto, encoding="utf-8")
        (carpeta / "manifiesto.json").write_text(
            json.dumps({"formacion.json": {"sha256": hashlib.sha256(texto.encode()).hexdigest()}}), encoding="utf-8"
        )
        self.assertEqual(len(piezas.comparar(self.raiz, self.area).alarmas), 2)

    def test_perdida_de_entradas_sigue_avisando(self) -> None:
        """La excepción de catálogo no deshabilita el aviso de pérdida mayor del veinte por ciento."""
        self.antes["cursos"] *= 4
        for i, curso in enumerate(self.antes["cursos"]):
            self.antes["cursos"][i] = {**curso, "id": str(i)}
        self.antes["cobertura"].update(cursos=12, cursos_con_relacion_oficial=12)
        despues = copy.deepcopy(self.antes)
        despues["cursos"] = despues["cursos"][:3]
        despues["cobertura"].update(cursos=3, cursos_con_relacion_oficial=3)
        resultado = self.comparar(despues)
        self.assertEqual(resultado.alarmas, [])
        # La raíz tiene seis claves: entradas() toma ese tamaño cuando solo quedan tres cursos.
        self.assertEqual(
            [piezas.texto_de_perdida(perdida) for perdida in resultado.perdidas],
            [
                "formacion.json pierde más del 20 % de sus cursos SOC (12 → 3)",
                "formacion.json pierde más del 20 % de sus entradas (12 → 6)",
            ],
        )

    def test_catalogo_mayor_no_oculta_perdida_de_cursos(self) -> None:
        """Una caída del 75 % de cursos avisa aunque el catálogo domine ambos recuentos generales."""
        self.antes["especialidades"] = {str(i): self.antes["especialidades"]["ABC"] for i in range(100)}
        self.antes["cursos"] *= 4
        for i, curso in enumerate(self.antes["cursos"]):
            self.antes["cursos"][i] = {**curso, "id": str(i), "especialidades": ["0"]}
        self.antes["cobertura"].update(cursos=12, cursos_con_relacion_oficial=12)
        despues = copy.deepcopy(self.antes)
        despues["cursos"] = despues["cursos"][:3]
        despues["cobertura"].update(cursos=3, cursos_con_relacion_oficial=3)
        resultado = self.comparar(despues)
        self.assertEqual(resultado.paquete[0]["antes"]["entradas"], 100)
        self.assertEqual(resultado.paquete[0]["despues"]["entradas"], 100)
        self.assertEqual(resultado.alarmas, [])
        self.assertEqual(
            resultado.perdidas, ({"archivo": "formacion.json", "medida": "cursos SOC", "antes": 12, "despues": 3},)
        )

    def test_sin_documentos_no_hay_permiso_y_oit_sigue_protegida(self) -> None:
        """Los llamadores sin evidencia y los cambios OIT conservan las guardas."""
        filas = [{"archivo": "formacion.json", "estado": "cambia", "antes": None, "despues": None}]
        self.assertEqual(len(list(piezas.alarmas_del_paquete(filas))), 2)
        self.escribir(self.raiz, {"tarea": "Antes"}, "oit.json")
        self.escribir(self.area, {"tarea": "Nueva"}, "oit.json")
        self.assertEqual(len(piezas.comparar(self.raiz, self.area).alarmas), 1)

    def test_politica_automatica_solo_describe_oferta_soc(self) -> None:
        """La etiqueta habilita descarga sin atribuir renovación automática al catálogo manual."""
        fuente = piezas.FUENTES["formacion"]
        self.assertEqual(fuente.politica, piezas.MENSUAL)
        self.assertTrue(fuente.red)
        self.assertEqual(fuente.frecuencia, "oferta SOC diaria; catálogos por edición")
        self.assertEqual(fuente.renovar_dias, 90)

    def metadatos_catalogos(self) -> tuple[dict, dict]:
        """Obtiene procedencias sintéticas con oferta reciente y catálogo SEPE más antiguo.

        Returns:
            Procedencias de formación y del SEPE, sin contenidos de sus originales.
        """
        archivos = [
            {"archivo": nombre, "descargado": "2026-09-27"}
            for nombre in (
                "eures-esco-cosispe-es.csv",
                "soc-especialidades.json",
                "digcomp-3.0.jsonld",
                "digcomp-3.0.xlsx",
                "digcomp-copyright.txt",
            )
        ]
        archivos.append({"archivo": "soc-cursos-2027-01-01.json", "descargado": "2027-01-01"})
        return {"archivos": archivos, "descargado": "2027-01-01"}, {"descargado": "2026-08-01"}

    def fila_catalogos(self, metadatos: tuple[dict, dict]) -> piezas.FilaManual:
        """Consulta la fila manual desde las procedencias sintéticas.

        Returns:
            La fila de los catálogos de formación, que debe seguir presente.
        """
        for nombre, documento in zip(("formacion", "sepe"), metadatos, strict=True):
            ruta = self.raiz / piezas.DATOS_RELATIVOS / "originales" / nombre / "procedencia.json"
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_text(json.dumps(documento), encoding="utf-8")
        return next(
            fila for fila in piezas.estado_de_las_manuales(self.raiz, date(2027, 1, 1)) if fila["fuente"] == "formacion"
        )

    def test_oferta_reciente_no_rejuvenece_catalogos_manuales(self) -> None:
        """La fila continúa presente y el SEPE más viejo determina la antigüedad conservadora."""
        fila = self.fila_catalogos(self.metadatos_catalogos())
        self.assertEqual(fila["fecha"], "2026-08-01")
        self.assertEqual(fila["dias"], (date(2027, 1, 1) - date(2026, 8, 1)).days)
        self.assertTrue(fila["renovar"])
        self.assertIn("revisión manual", fila["frecuencia"])
        self.assertIn("excluye oferta SOC diaria", fila["frecuencia"])

    def test_catalogo_sin_evidencia_completa_no_inventa_fecha(self) -> None:
        """Ausencias, fechas imposibles, duplicados y originales desconocidos dejan fecha desconocida."""
        for caso in ("ausente", "sin_fecha", "invalida", "duplicado", "desconocido", "sepe_sin_fecha", "tipo"):
            formacion_meta, sepe = self.metadatos_catalogos()
            archivos = formacion_meta["archivos"]
            if caso == "ausente":
                archivos.pop(0)
            elif caso == "sin_fecha":
                del archivos[0]["descargado"]
            elif caso == "invalida":
                archivos[0]["descargado"] = "2026-02-30"
            elif caso == "duplicado":
                archivos.append(archivos[0].copy())
            elif caso == "desconocido":
                archivos.append({"archivo": "otro-catalogo.json", "descargado": "2026-09-27"})
            elif caso == "sepe_sin_fecha":
                del sepe["descargado"]
            else:
                archivos[0]["descargado"] = 20260927
            with self.subTest(caso=caso):
                fila = self.fila_catalogos((formacion_meta, sepe))
                self.assertIsNone(fila["fecha"])
                self.assertIsNone(fila["dias"])

    def test_procedencia_manual_con_clave_duplicada_es_desconocida(self) -> None:
        """Una clave JSON duplicada no sustituye silenciosamente la fecha de catálogo."""
        self.fila_catalogos(self.metadatos_catalogos())
        ruta = self.raiz / piezas.DATOS_RELATIVOS / "originales" / "sepe" / "procedencia.json"
        ruta.write_text('{"descargado":"2026-08-01","descargado":"2027-01-01"}', encoding="utf-8")
        fila = next(f for f in piezas.estado_de_las_manuales(self.raiz) if f["fuente"] == "formacion")
        self.assertIsNone(fila["fecha"])


if __name__ == "__main__":
    unittest.main()
