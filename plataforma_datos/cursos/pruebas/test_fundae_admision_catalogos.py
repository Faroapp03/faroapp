"""Admisión FUNDAE sintética: presencia no cambia negocio ni autoridades directas."""

import hashlib
import json
import sqlite3
import unittest
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, politicas_vigencia
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos.fuentes.fundae import actualizacion as fundae
from plataforma_datos.cursos.fuentes.fundae import adquisicion, conocidos, digitalizate
from plataforma_datos.cursos.pruebas import test_adaptador_digitalizate as legadas
from plataforma_datos.cursos.pruebas import test_fundae_operacion_catalogos as indices


class AdmisionFundaePruebas(unittest.TestCase):
    """Usa admisión y SQLite reales sobre una muestra sintética identificada."""

    def setUp(self) -> None:
        """Crea dos recursos admitidos por el adaptador existente, sin red."""
        self.rx = indices.CatalogosFundaePruebas()
        self.rx.setUp()
        self.addCleanup(self.rx.doCleanups)
        self.raiz = self.rx.raiz
        self.original = self.raiz
        historicas = self.raiz / "historicas"
        legadas.fixture(historicas)
        self.base = self.raiz / "entrada.sqlite3"
        digitalizate.importar_captura(self.base, historicas)
        preparado = digitalizate.preparar_importacion(historicas)
        indice = historicas / "indice.json"
        guardar_json(
            indice,
            {
                "schema_version": 1,
                "archivos_conservados": [
                    {"archivo": p["archivo"], "sha256": p["sha256"]} for p in preparado["control"]["evidencias_control"]
                ],
            },
        )
        solicitud = admision.SolicitudAdmision(
            snapshot=self.ref(self.base),
            procedencia={"captura": self.ref(indice)},
            indices_evidencias={"captura-fundae": admision.IndiceEvidencias(archivo=self.ref(indice), raiz=historicas)},
            validacion_destino=self.raiz / "validacion.json",
        )
        admision.admitir_snapshot(solicitud)
        self.entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
        )
        guardar_json(self.original / "procedencia.json", self.rx.documento)
        self.conjunto = adquisicion.calcular(self.original, self.rx.documento, conocidos.leer(self.entrada))
        politica = Path(fundae.__file__).with_name("politica_vigencia_v1.json")
        self.assertEqual(
            politicas_vigencia.POLITICAS[("fundae", "1")],
            ("fuentes/fundae/politica_vigencia_v1.json", self.ref(politica).sha256),
        )

    def ref(self, ruta: Path) -> admision.ReferenciaArchivo:
        """Referencia de bytes de la prueba.

        Returns:
            Ruta y SHA coherentes, sin modificar fechas o contenido.
        """
        return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())

    def test_admite_presencia_sin_oferta_y_preserva_entrada_y_negocio(self) -> None:
        """La candidata incorpora evidencia sin tocar los hechos nativos o la entrada."""
        antes = self.ref(self.base).sha256
        destino = self.raiz / "candidata"
        fundae.aplicar(
            self.entrada, conjunto=self.conjunto, original=self.original, destino=destino, corte="2026-10-23T10:01:00Z"
        )
        self.assertEqual(self.ref(self.base).sha256, antes)
        with sqlite3.connect(self.base) as a, sqlite3.connect(destino / "catalogo.sqlite3") as b:
            for tabla in ("programas", "variantes", "anuncios", "ediciones"):
                self.assertEqual(
                    a.execute("SELECT * FROM " + tabla).fetchall(), b.execute("SELECT * FROM " + tabla).fetchall()
                )
        for id in ("fundae:1:1", "fundae:1:2"):
            estado = registro.consultar_unidad(destino / "catalogo.sqlite3", tipo="recurso", id=id)
            self.assertEqual(estado["evaluacion"]["resultado"]["estado"], "sin-confirmar")
        solicitud = almacen.solicitud(destino)
        admision.exigir_snapshot_admitido(solicitud, sha256_validacion=self.ref(solicitud.validacion_destino).sha256)

    def test_programa_con_edicion_conserva_presencia_sin_evaluarlo_como_recurso(self) -> None:
        """Añadir una edición no permite renovar esa edición por la presencia del programa."""
        prueba = digitalizate.preparar_importacion(self.raiz / "historicas")["control"]["evidencias_control"][0]
        lote = {
            "schema_version": 1,
            "observado_utc": prueba["capturado_utc"],
            "fuente_lote": "edicion-sintetica",
            "proveedores": [],
            "programas": [],
            "ediciones": [
                {
                    "id": "edicion-prueba",
                    "programa_id": "fundae:1:1",
                    "datos": {},
                    "evidencias": [prueba],
                }
            ],
        }
        catalogo.cargar_lote(self.base, lote, True, self.raiz / "historicas")
        programa = {"id": "fundae:1:1", "url": "https://ejemplo.org/misma-portada"}
        observacion = next(
            f["observacion"] for f in self.conjunto["observaciones_catalogo"] if f["id"] == programa["id"]
        )
        antes = self.ref(self.base).sha256
        resultado = fundae._registrar(self.base, programa, observacion, "2026-10-23T10:01:00Z")
        self.assertEqual(resultado["tipo_presencia"], "programa_con_ediciones")
        self.assertIsNone(resultado["evaluacion"])
        self.assertEqual(self.ref(self.base).sha256, antes)
        with sqlite3.connect(self.base) as conexion:
            self.assertEqual(conexion.execute("SELECT count(*) FROM ediciones").fetchone()[0], 1)
            self.assertEqual(conexion.execute("SELECT count(*) FROM evaluaciones_vigencia").fetchone()[0], 0)
            self.assertEqual(
                conexion.execute(
                    "SELECT count(*) FROM unidades_vigencia WHERE tipo='recurso' AND programa_id='fundae:1:1'"
                ).fetchone()[0],
                0,
            )
        otra = next(f for f in self.conjunto["observaciones_catalogo"] if f["id"] == "fundae:1:2")
        resultado_otro = fundae._registrar(
            self.base,
            {"id": otra["id"], "url": "https://ejemplo.org/misma-portada"},
            otra["observacion"],
            "2026-10-23T10:01:00Z",
        )
        self.assertTrue(resultado_otro["evaluacion"]["actual"], "El resto del canal sigue procesándose")

    def test_resultado_de_registro_solo_conserva_referencia_local(self) -> None:
        """Las pruebas ya están en V10; el recibo de fuente no las vuelve a expandir."""
        fila = self.conjunto["observaciones_catalogo"][0]
        programa = next(p for p in conocidos.leer(self.entrada)["programas"] if p["id"] == fila["id"])
        resultado = fundae._registrar(self.base, programa, fila["observacion"], "2026-10-23T10:01:00Z")
        self.assertEqual(set(resultado["evaluacion"]), {"evaluacion_id", "repetida", "actual"})
        self.assertIsInstance(resultado["evaluacion"]["evaluacion_id"], int)
        self.assertNotIn("entradas", resultado["evaluacion"])
        self.assertNotIn("resultado", resultado["evaluacion"])

    def test_conjunto_manipulado_no_crea_candidata(self) -> None:
        """El aplicador exige reproducir el conjunto desde recibos, no solo confiar en JSON."""
        alterado = json.loads(json.dumps(self.conjunto))
        alterado["observaciones_catalogo"][0]["observacion"]["detalle"]["lectura_completa"] = True
        destino = self.raiz / "rechazada"
        with self.assertRaisesRegex(ValueError, "no reproducido"):
            fundae.aplicar(
                self.entrada, conjunto=alterado, original=self.original, destino=destino, corte="2026-10-23T10:01:00Z"
            )
        self.assertFalse(destino.exists())

    def test_replay_conserva_observaciones_evaluacion_y_negocio(self) -> None:
        """Una recepción repetida no crea una comprobación nueva ni duplica unidades."""
        a, b = self.raiz / "primera", self.raiz / "segunda"
        fundae.aplicar(
            self.entrada, conjunto=self.conjunto, original=self.original, destino=a, corte="2026-10-23T10:01:00Z"
        )
        solicitud = almacen.solicitud(a)
        entrada = almacen.EntradaCatalogo(
            admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
        )
        fundae.aplicar(entrada, conjunto=self.conjunto, original=self.original, destino=b, corte="2026-10-23T10:01:00Z")
        with sqlite3.connect(a / "catalogo.sqlite3") as c, sqlite3.connect(b / "catalogo.sqlite3") as d:
            for tabla in ("programas", "observaciones_vigencia", "evaluaciones_vigencia"):
                self.assertEqual(
                    c.execute("SELECT * FROM " + tabla).fetchall(), d.execute("SELECT * FROM " + tabla).fetchall()
                )


if __name__ == "__main__":
    unittest.main()
