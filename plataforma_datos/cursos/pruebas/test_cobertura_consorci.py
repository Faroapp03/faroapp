"""Cobertura completa de Consorci con originales y recibos sintéticos, sin red ni datos reales."""

import copy
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import plataforma_datos.cursos.fuentes.consorci.cobertura as cobertura
from plataforma_datos.comun.nucleo import DATOS_RELATIVOS
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.comun.socrata import archivos_de_la_copia
from plataforma_datos.cursos.fuentes.consorci.constantes import CONJUNTOS, OFERTA

FECHA = "2026-10-17"
INSTANTE = FECHA + "T08:00:00Z"


def codificar(valor: object) -> bytes:
    """Serializa el original sintético exacto que declara el recibo.

    Returns:
        Bytes UTF-8 de JSON válido.
    """
    return json.dumps(valor, ensure_ascii=False).encode()


class PruebaCoberturaConsorci(unittest.TestCase):
    """Ocho lecturas completas no bastan sin sus originales, metadatos y copia admitida."""

    def setUp(self) -> None:
        """Crea un candidato aislado y pequeño con los cuatro conjuntos y sus metadatos."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.original = self.raiz / DATOS_RELATIVOS / "originales/consorci"
        self.original.mkdir(parents=True)
        self.procedencia = {"copia": FECHA, "archivos": []}
        self.resumen = {"copia": FECHA, "conjuntos": {}}
        self.informe = {"estado": "Admitido", "copia": FECHA, "controles": [{"resultado": "correcto"}]}
        self.evidencia = {
            "version": 2,
            "fuente": "consorci",
            "intento": "intento85",
            "comienzo_utc": INSTANTE,
            "fin_utc": INSTANTE,
            "peticiones": [],
        }
        for conjunto in CONJUNTOS:
            meta = {
                "rowsUpdatedAt": 1792224000,
                "columns": [{"fieldName": "id", "cachedContents": {"non_null": "2", "null": "0"}}],
            }
            if conjunto == OFERTA:
                # Total global distinto del subconjunto CFCC, como en los originales oficiales.
                meta["columns"][0]["cachedContents"]["non_null"] = "5"
                meta["columns"].append(
                    {"fieldName": "origen", "cachedContents": {"top": [{"item": "CFCC", "count": "2"}]}}
                )
            filas = [{"id": "uno", "origen": "CFCC"}, {"id": "dos", "origen": "CFCC"}]
            for archivo, valor in zip(archivos_de_la_copia((conjunto,), FECHA), (filas, meta), strict=True):
                contenido = codificar(valor)
                huella = hashlib.sha256(contenido).hexdigest()
                nombre, url = archivo["archivo"], archivo["url"]
                (self.original / nombre).write_bytes(contenido)
                self.procedencia["archivos"].append(
                    {"archivo": nombre, "url": url, "url_final": url, "bytes": len(contenido), "sha256": huella}
                )
                self.evidencia["peticiones"].append(
                    {
                        "recurso_sha256": identidad_recurso(url),
                        "url_final_sha256": hashlib.sha256(url.encode()).hexdigest(),
                        "respuesta_sha256": huella,
                        "bytes": len(contenido),
                        "original_sha256": huella,
                        "original_bytes": len(contenido),
                        "completado_utc": INSTANTE,
                    }
                )
            self.resumen["conjuntos"][conjunto.identificador] = {
                "filas": 2,
                "actualizado": "2026-10-17",
                "filas_segun_metadatos": 5 if conjunto == OFERTA else 2,
                "filas_por_origen": {"CFCC": 2} if conjunto == OFERTA else {},
            }
        self.guardar_informes()

    def guardar_informes(self) -> None:
        """Escribe únicamente informes del candidato sintético."""
        for relativa, valor in (
            ("originales/consorci/procedencia.json", self.procedencia),
            ("preparados/consorci/resumen.json", self.resumen),
            ("validados/consorci/validacion.json", self.informe),
        ):
            ruta = self.raiz / DATOS_RELATIVOS / relativa
            ruta.parent.mkdir(parents=True, exist_ok=True)
            ruta.write_bytes(codificar(valor))

    def sustituir(self, indice: int, valor: object) -> None:
        """Modifica un original y sus huellas para probar el contenido, no solo la integridad."""
        entrada = self.procedencia["archivos"][indice]
        contenido = codificar(valor)
        (self.original / entrada["archivo"]).write_bytes(contenido)
        huella = hashlib.sha256(contenido).hexdigest()
        entrada.update(sha256=huella, bytes=len(contenido))
        self.evidencia["peticiones"][indice].update(
            respuesta_sha256=huella, bytes=len(contenido), original_sha256=huella, original_bytes=len(contenido)
        )
        self.guardar_informes()

    def test_ocho_recursos_y_subconjunto_filtrado_completos(self) -> None:
        """La totalidad CFCC se contrasta con su reparto, no con las cinco filas globales."""
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))

    def test_metadatos_equivalentes_vinculados_sin_igualdad_de_bytes_remotos(self) -> None:
        """Contadores volátiles nuevos no invalidan el puente del transporte al original admitido."""
        peticion = self.evidencia["peticiones"][1]
        peticion.update(respuesta_sha256="f" * 64, bytes=peticion["bytes"] + 9)
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))

    def test_v1_cero_http_y_puente_ausente_no_acreditan(self) -> None:
        """El legado y una descarga sin conservar no demuestran la copia admitida."""
        legado = copy.deepcopy(self.evidencia)
        legado["version"] = 1
        for peticion in legado["peticiones"]:
            peticion.pop("original_sha256")
            peticion.pop("original_bytes")
        casos = [legado, {**self.evidencia, "peticiones": []}]
        sin_puente = copy.deepcopy(self.evidencia)
        sin_puente["peticiones"][0].update(original_sha256=None, original_bytes=None)
        casos.append(sin_puente)
        for caso in casos:
            with self.subTest(caso=caso):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_cada_recurso_y_metadato_es_imprescindible(self) -> None:
        """La ausencia de cualquiera de los ocho nunca se confunde con cobertura parcial admitida."""
        for indice in range(8):
            caso = copy.deepcopy(self.evidencia)
            caso["peticiones"].pop(indice)
            with self.subTest(indice=indice):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_recurso_repetido_ajeno_filtro_incorrecto_o_redireccion(self) -> None:
        """El número de peticiones no sustituye sus identidades exactas."""
        for campo, valor in (
            ("recurso_sha256", self.evidencia["peticiones"][0]["recurso_sha256"]),
            ("recurso_sha256", identidad_recurso("https://ejemplo.invalid/otra")),
            ("recurso_sha256", identidad_recurso("https://analisi.transparenciacatalunya.cat/resource/7vig-4syr.json")),
            ("url_final_sha256", "a" * 64),
        ):
            caso = copy.deepcopy(self.evidencia)
            caso["peticiones"][4][campo] = valor
            with self.subTest(campo=campo, valor=valor):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_filas_no_admiten_equivalencia_y_puente_debe_coincidir(self) -> None:
        """Datos diferentes, originales ajenos y tamaños incorrectos se rechazan aunque los conteos coincidan."""
        for indice, campo, valor in (
            (0, "respuesta_sha256", "f" * 64),
            (1, "original_sha256", "f" * 64),
            (0, "original_bytes", 1),
            (0, "bytes", 1),
        ):
            caso = copy.deepcopy(self.evidencia)
            caso["peticiones"][indice][campo] = valor
            with self.subTest(indice=indice, campo=campo):
                self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_conteo_truncado_y_tope_sin_paginacion_se_rechazan(self) -> None:
        """Los hashes pueden ser íntegros y aun así representar solo parte del conjunto."""
        self.sustituir(0, [{"id": "uno"}])
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.sustituir(0, [{"id": "uno"}, {"id": "dos"}])
        # Un límite bajo simula alcanzar la página máxima sin generar cincuenta mil filas.
        with patch.object(cobertura, "LIMITE_FILAS", 2):
            self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_metadatos_ambiguos_no_acreditan_reparto(self) -> None:
        """Origen duplicado y columnas repetidas no son una declaración inequívoca de totalidad."""
        nombre = self.procedencia["archivos"][5]["archivo"]
        original = json.loads((self.original / nombre).read_bytes())
        for duplicar_columna in (False, True):
            meta = copy.deepcopy(original)
            if duplicar_columna:
                meta["columns"].append(copy.deepcopy(meta["columns"][1]))
            else:
                meta["columns"][1]["cachedContents"]["top"].insert(0, {"item": "CFCC", "count": "99"})
            self.sustituir(5, meta)
            with self.subTest(columna=duplicar_columna):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_procedencia_resumen_y_admision_deben_ser_coherentes(self) -> None:
        """Una copia local obsoleta o no admitida no hereda una consulta nueva."""
        for documento, campo, valor in (
            (self.procedencia, "copia", "2026-10-16"),
            (self.resumen, "copia", "2026-10-16"),
            (self.informe, "copia", "2026-10-16"),
            (self.informe, "estado", "Con errores"),
            (self.informe, "controles", [{"resultado": "ERROR"}]),
        ):
            previo = documento[campo]
            documento[campo] = valor
            self.guardar_informes()
            with self.subTest(campo=campo, valor=valor):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
            documento[campo] = previo
        self.guardar_informes()

    def test_archivos_ausentes_alterados_enlazados_y_json_ambiguo(self) -> None:
        """Entradas presentes no verificables fallan sin leer por enlaces ni admitir JSON duplicado."""
        ruta = self.original / self.procedencia["archivos"][0]["archivo"]
        previo = ruta.read_bytes()
        ruta.unlink()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        ruta.write_bytes(previo + b" ")
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        ruta.unlink()
        ajeno = self.original / "ajeno"
        ajeno.write_bytes(previo)
        ruta.symlink_to(ajeno)
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        ruta.unlink()
        os.link(ajeno, ruta)
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        ruta.unlink()
        ruta.write_bytes(previo)
        (self.original / "procedencia.json").write_bytes(b'{"copia":"a","copia":"b"}')
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))


if __name__ == "__main__":
    unittest.main()
