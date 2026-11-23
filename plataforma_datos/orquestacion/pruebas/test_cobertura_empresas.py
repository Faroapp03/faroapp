"""Cobertura de la edición descubierta y sus tablas, con cuerpos propios y sin red."""

import copy
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.empresas.lector as empresas
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.mercado.fuentes.empresas.piezas import calendario_ine
from plataforma_datos.mercado.pruebas import ayuda_calendario
from plataforma_datos.orquestacion import cobertura_empresas as cobertura
from plataforma_datos.orquestacion import cobertura_originales

INSTANTE = "2026-10-17T08:00:00Z"


def sha(contenido: bytes) -> str:
    """Calcula la huella de un cuerpo de prueba.

    Returns:
        SHA256 hexadecimal.
    """
    return hashlib.sha256(contenido).hexdigest()


class PruebaCoberturaEmpresas(unittest.TestCase):
    """Ni la edición declarada ni seis tablas sustituyen el descubrimiento HTTP vinculado."""

    def setUp(self) -> None:
        """Construye doce originales independientes del paquete y de las capturas operativas."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.carpeta = self.raiz / "var/actualizacion/originales/empresas"
        self.carpeta.mkdir(parents=True)
        self.procedencia: dict = {"edicion": {}, "descubrimiento": [], "archivos": []}
        self.evidencia = {
            "version": 2,
            "fuente": "empresas",
            "intento": "empresas_92",
            "comienzo_utc": INSTANTE,
            "fin_utc": "2026-10-17T08:02:00Z",
            "peticiones": [],
        }
        titulos = (
            "Las TIC en las empresas (primer trimestre de 2025) por agrupación de actividad",
            "Las TIC en las empresas (primer trimestre de 2025)",
            "Las TIC en las empresas con 10 o más empleados (primer trimestre de 2025) por sectores de actividad",
            "Errores de muestreo",
        )
        indice = "".join(
            f'<a href="/capitulo?capsel={numero}">{titulo}</a>' for numero, titulo in enumerate(titulos)
        ).encode()
        self.registrar(cobertura.INDICE, empresas.RESULTADOS, indice, "descubrimiento")
        anio, direcciones = empresas.capitulos(indice.decode())
        tablas = {}
        for numero, (parte, direccion) in enumerate(direcciones.items(), start=100):
            tabla = str(numero)
            tablas[parte] = tabla
            cuerpo = f'<a href="/jaxi/Tabla.htm?tpx={tabla}">{empresas.CAPITULOS[parte][1]}</a>'.encode()
            self.registrar(f"ine-eticce-capitulo-{parte}.html", direccion, cuerpo, "descubrimiento")
        self.procedencia["edicion"] = {
            "anio": anio,
            "nombre": "2024–1T2025",
            "tablas": tablas,
            "encontrada_en": empresas.RESULTADOS,
        }
        archivos = [
            *empresas.archivos_del_ine(self.procedencia["edicion"]),
            empresas.archivo_de_eurostat(anio),
            empresas.archivo_de_eurostat_cataluna(anio),
        ]
        for archivo in archivos:
            self.registrar(archivo["archivo"], archivo["url"], b'{"captura":"completa"}', "archivos")
        self.registrar(calendario_ine.ARCHIVO, calendario_ine.URL, ayuda_calendario.CUERPO, "archivos")
        self.guardar()

    def registrar(self, nombre: str, url: str, cuerpo: bytes, grupo: str) -> None:
        """Conserva una respuesta propia y su vínculo con el recibo sintético."""
        final = url.replace("/js/", "/jsCache/", 1) if "/DATOS_TABLA/" in url else url
        (self.carpeta / nombre).write_bytes(cuerpo)
        self.procedencia[grupo].append(
            {
                "archivo": nombre,
                "url": url,
                "url_final": final,
                "sha256": sha(cuerpo),
                "bytes": len(cuerpo),
                "descargado_utc": "2026-10-06T08:00:00Z",
            }
        )
        self.evidencia["peticiones"].append(
            {
                "recurso_sha256": identidad_recurso(url),
                "url_final_sha256": sha(final.encode()),
                "respuesta_sha256": sha(cuerpo),
                "bytes": len(cuerpo),
                "original_sha256": sha(cuerpo),
                "original_bytes": len(cuerpo),
                "completado_utc": INSTANTE,
            }
        )

    def guardar(self) -> None:
        """Escribe solo la procedencia de la fixture."""
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")

    def sustituir(self, grupo: str, indice: int, cuerpo: bytes) -> None:
        """Simula otra respuesta íntegra, con hashes coherentes, para probar el contenido del descubrimiento."""
        registro = self.procedencia[grupo][indice]
        (self.carpeta / registro["archivo"]).write_bytes(cuerpo)
        registro.update(sha256=sha(cuerpo), bytes=len(cuerpo))
        peticion = next(
            p for p in self.evidencia["peticiones"] if p["recurso_sha256"] == identidad_recurso(registro["url"])
        )
        peticion.update(
            respuesta_sha256=sha(cuerpo), original_sha256=sha(cuerpo), bytes=len(cuerpo), original_bytes=len(cuerpo)
        )
        self.guardar()

    def test_doce_recursos_exactos_con_js_cache_sin_renovar_fechas(self) -> None:
        """Las doce respuestas y sus originales acreditan la consulta aunque sus bytes ya estuvieran conservados."""
        self.evidencia["peticiones"].reverse()
        previo = (self.carpeta / "procedencia.json").read_bytes()
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        self.assertEqual((self.carpeta / "procedencia.json").read_bytes(), previo)

    def test_cero_v1_otra_fuente_y_legacy_no_acreditan(self) -> None:
        """Una reconstrucción previa sin descubrimiento no recibe fecha de consulta nueva."""
        for cambio in ({"version": 1}, {"version": True}, {"fuente": "observatori"}, {"peticiones": []}):
            with self.subTest(cambio=cambio):
                self.assertFalse(cobertura.comprobada(self.raiz, {**self.evidencia, **cambio}))
        self.procedencia.pop("descubrimiento")
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_cada_consulta_es_necesaria_sin_duplicados_ni_extra(self) -> None:
        """Índice, capítulos y tablas tienen la misma exigencia de completitud."""
        for indice in range(len(self.evidencia["peticiones"])):
            caso = copy.deepcopy(self.evidencia)
            caso["peticiones"].pop(indice)
            with self.subTest(omitida=indice):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))
        for cambio in ("duplicado", "extra", "otro_metodo", "otro_cuerpo", "otro_filtro"):
            caso = copy.deepcopy(self.evidencia)
            if cambio == "duplicado":
                caso["peticiones"][-1] = caso["peticiones"][0]
            elif cambio == "extra":
                caso["peticiones"].append(caso["peticiones"][0])
            else:
                url = empresas.RESULTADOS
                identidad = {
                    "otro_metodo": identidad_recurso(url, "POST"),
                    "otro_cuerpo": identidad_recurso(url, cuerpo=b""),
                    "otro_filtro": identidad_recurso(url + "&time=2025"),
                }[cambio]
                caso["peticiones"][0]["recurso_sha256"] = identidad
            with self.subTest(cambio=cambio):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_hash_tamano_puente_y_url_final_de_cada_recurso(self) -> None:
        """El recibo debe corresponder con el cuerpo completo conservado y el redirect admitido."""
        for indice in range(len(self.evidencia["peticiones"])):
            for campo, valor in (
                ("respuesta_sha256", "0" * 64),
                ("original_sha256", None),
                ("original_bytes", 1),
                ("bytes", 1),
                ("url_final_sha256", "0" * 64),
            ):
                caso = copy.deepcopy(self.evidencia)
                caso["peticiones"][indice][campo] = valor
                with self.subTest(indice=indice, campo=campo):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_descubrimiento_recalculado_no_confia_en_la_edicion_declarada(self) -> None:
        """Un índice íntegro de 2026 tampoco acredita los archivos conservados de 2025."""
        self.procedencia["edicion"]["anio"] = 2026
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        indice = (self.carpeta / cobertura.INDICE).read_bytes().replace(b"2025", b"2026")
        self.sustituir("descubrimiento", 0, indice)
        self.procedencia["edicion"]["nombre"] = "2025–1T2026"
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_otra_tabla_en_capitulo_integro_no_acredita_la_anterior(self) -> None:
        """Se extrae el identificador del capítulo observado, sin tomarlo de la procedencia."""
        registro = self.procedencia["descubrimiento"][1]
        anterior = (self.carpeta / registro["archivo"]).read_bytes()
        self.sustituir("descubrimiento", 1, anterior.replace(b"tpx=100", b"tpx=999"))
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_indice_sin_edicion_utf8_invalido_o_capitulo_sin_tabla_no_acreditan(self) -> None:
        """Los cuerpos vinculados también deben permitir recalcular el descubrimiento del productor."""
        original = (self.carpeta / cobertura.INDICE).read_bytes()
        for cuerpo in (b"sin edicion", original + b"\xff"):
            self.sustituir("descubrimiento", 0, cuerpo)
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.sustituir("descubrimiento", 0, original)
        self.sustituir("descubrimiento", 1, b"sin tabla de IA")
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_procedencia_no_admite_rutas_duplicados_o_redireccion_ajena(self) -> None:
        """Los nombres se derivan del plan y el redirect Tempus conserva tabla, host y filtros exactos."""
        original = copy.deepcopy(self.procedencia)
        for grupo in ("descubrimiento", "archivos"):
            for campo, valor in (
                ("archivo", "../ajeno"),
                ("url", "https://ajeno.test/"),
                ("url_final", "https://ajeno.test/"),
                ("bytes", True),
                ("sha256", "0" * 64),
            ):
                self.procedencia = copy.deepcopy(original)
                self.procedencia[grupo][0][campo] = valor
                self.guardar()
                with self.subTest(grupo=grupo, campo=campo):
                    self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
            self.procedencia = copy.deepcopy(original)
            self.procedencia[grupo].append(self.procedencia[grupo][0])
            self.guardar()
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_original_ausente_alterado_o_enlazado_no_acredita(self) -> None:
        """También se rechazan originales con los mismos bytes accedidos mediante symlink o hardlink."""
        for registro in (*self.procedencia["descubrimiento"], *self.procedencia["archivos"]):
            ruta = self.carpeta / registro["archivo"]
            contenido = ruta.read_bytes()
            ajeno = self.raiz / "ajeno"
            ajeno.write_bytes(contenido)
            for cambio in ("ausente", "alterado", "symlink", "hardlink"):
                ruta.unlink(missing_ok=True)
                if cambio == "alterado":
                    ruta.write_bytes(contenido + b" ")
                elif cambio == "symlink":
                    ruta.symlink_to(ajeno)
                elif cambio == "hardlink":
                    os.link(ajeno, ruta)
                with self.subTest(archivo=registro["archivo"], cambio=cambio):
                    self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
            ruta.unlink()
            ruta.write_bytes(contenido)

    def test_json_ambiguo_cota_y_carpeta_enlazada_no_acreditan(self) -> None:
        """El vínculo tampoco admite ambigüedad de procedencia ni una carpeta ajena enlazada."""
        ruta = self.carpeta / "procedencia.json"
        for cuerpo in (b'{"archivos":[],"archivos":[]}', b'{"x":NaN}', b"[]", b"{"):
            ruta.write_bytes(cuerpo)
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.guardar()
        with mock.patch.object(cobertura_originales, "MAX_DESCARGA_BYTES", 1):
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        ajena = self.raiz / "procedencia-ajena.json"
        ajena.write_bytes(ruta.read_bytes())
        for enlace in ("symlink", "hardlink"):
            ruta.unlink()
            if enlace == "symlink":
                ruta.symlink_to(ajena)
            else:
                os.link(ajena, ruta)
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        ruta.unlink()
        self.guardar()
        movida = self.carpeta.with_name("real")
        self.carpeta.rename(movida)
        self.carpeta.symlink_to(movida, target_is_directory=True)
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))


if __name__ == "__main__":
    unittest.main()
