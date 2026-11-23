"""La selección de temario se admite y sustituye con la misma instantánea Academy."""

import hashlib
import json
import sqlite3
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import contenido_academy, registro_vigencia
from plataforma_datos.cursos import contenido_aprendizaje as contenido
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.fuentes.claude_academy import control_actual
from plataforma_datos.cursos.pruebas import test_academy_actualizacion as flujo


class ContenidoAcademyPruebas(unittest.TestCase):
    """Recepciones sintéticas y admisión/publicación productivas, sin tráfico."""

    def setUp(self) -> None:
        """Prepara dos programas y selecciona sus recepciones actuales por el ciclo común."""
        self.caso = flujo.AcademyActualizacionPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.componer()
        self.area = self.caso.raiz / almacen.RUTA

    def leer(self) -> dict:
        """Lee por el mismo hook que usa el publicador.

        Returns:
            Temario actual del ID solicitado, si conserva todos sus vínculos.
        """
        return contenido.contenidos_actuales(almacen.solicitud(self.area), [flujo.ID])

    def test_control_compacto_actual_coincide_con_snapshot_y_replay_no_renueva(self) -> None:
        """El control referencia cuerpos conservados y repetir no escribe ni cambia fechas."""
        actual = self.leer()[flujo.ID]
        control = json.loads((self.area / almacen.CONTROL).read_bytes())
        seleccion = almacen.leer_documento(self.area, control["procedencia"]["control-academy"])
        self.assertTrue(
            all(
                set(r) == {"id", "observacion_id", "cuerpo_sha256", "recibo_sha256", "metadatos_sha256"}
                for r in seleccion["recepciones"]
            )
        )
        self.assertEqual(actual.ficha.id, "nuevo")
        estado = registro_vigencia.consultar_unidad(self.area / "catalogo.sqlite3", tipo="recurso", id=flujo.ID)
        previo = estado["evaluacion"]["resultado"]
        antes = self.caso.inventario()
        self.caso.componer("2026-10-23T10:06:00Z")
        self.assertEqual(self.caso.inventario(), antes)
        self.assertEqual(self.leer()[flujo.ID], actual)
        despues = registro_vigencia.consultar_unidad(self.area / "catalogo.sqlite3", tipo="recurso", id=flujo.ID)
        self.assertEqual(despues["evaluacion"]["resultado"], previo)

    def test_referencia_alterada_no_se_sustituye_por_cuerpo_historico(self) -> None:
        """Ni un SHA inventado ni una observación ajena seleccionan otra captura."""
        solicitud = almacen.solicitud(self.area)
        control = json.loads((self.area / almacen.CONTROL).read_bytes())
        original = almacen.leer_documento(self.area, control["procedencia"]["control-academy"])
        for campo, valor in (("cuerpo_sha256", "f" * 64), ("metadatos_sha256", "f" * 64), ("observacion_id", "otra")):
            with self.subTest(campo=campo):
                dato = json.loads(json.dumps(original))
                next(r for r in dato["recepciones"] if r["id"] == flujo.ID)[campo] = valor
                ruta = self.area / "seleccion-forjada.json"
                ruta.write_text(json.dumps(dato))
                ref = replace(
                    solicitud.procedencia["control-academy"],
                    ruta=ruta,
                    sha256=hashlib.sha256(ruta.read_bytes()).hexdigest(),
                )
                forjada = replace(solicitud, procedencia={**solicitud.procedencia, "control-academy": ref})
                if campo == "observacion_id":
                    self.assertEqual(contenido.contenidos_actuales(forjada, [flujo.ID]), {})
                else:
                    with self.assertRaises(ErrorEntregaCatalogo):
                        contenido.contenidos_actuales(forjada, [flujo.ID])

    def test_conexion_cerrada_al_rechazar_metadatos(self) -> None:
        """El rechazo dentro de la lectura no deja la conexión SQLite abierta."""
        solicitud = almacen.solicitud(self.area)
        control = json.loads((self.area / almacen.CONTROL).read_bytes())
        dato = almacen.leer_documento(self.area, control["procedencia"]["control-academy"])
        next(r for r in dato["recepciones"] if r["id"] == flujo.ID)["metadatos_sha256"] = "f" * 64
        ruta = self.area / "control-metadatos-ajenos.json"
        ruta.write_text(json.dumps(dato))
        ref = replace(
            solicitud.procedencia["control-academy"], ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest()
        )
        solicitud = replace(solicitud, procedencia={**solicitud.procedencia, "control-academy": ref})
        conectar = sqlite3.connect
        conexiones = []

        def abrir(*args: object, **kwargs: object) -> sqlite3.Connection:
            conexion = conectar(*args, **kwargs)
            conexiones.append(conexion)
            return conexion

        with (
            patch.object(contenido_academy.sqlite3, "connect", side_effect=abrir),
            self.assertRaises(ErrorEntregaCatalogo),
        ):
            contenido.contenidos_actuales(solicitud, [flujo.ID])
        self.assertEqual(len(conexiones), 2)  # HP y Academy atraviesan el hook común.
        for conexion in conexiones:
            with self.assertRaises(sqlite3.ProgrammingError):
                conexion.execute("SELECT 1")

    def test_control_cerrado_rechaza_booleano_tipos_campos_y_sha_antes_de_sqlite(self) -> None:
        """La versión True, filas opacas y extensiones no pertenecen al contrato."""
        control = json.loads((self.area / almacen.CONTROL).read_bytes())
        original = almacen.leer_documento(self.area, control["procedencia"]["control-academy"])
        invalidos = [
            {**original, "schema_version": True},
            {**original, "recepciones": {}},
            {**original, "recepciones": []},
            {**original, "extra": None},
            {**original, "recepciones": [True]},
        ]
        for campo, valor in (
            ("id", True),
            ("id", "otro:curso"),
            ("observacion_id", None),
            ("cuerpo_sha256", "../archivo"),
            ("metadatos_sha256", 1),
            ("extra", None),
        ):
            fila = {**original["recepciones"][0], campo: valor}
            invalidos.append({**original, "recepciones": [fila]})
        invalidos.append({**original, "recepciones": [original["recepciones"][0]] * 2})
        for dato in invalidos:
            with self.subTest(dato=dato), self.assertRaises(ErrorEntregaCatalogo):
                control_actual.validar(dato)

    def test_texto_nativo_distinto_retiene_aprendizaje(self) -> None:
        """No acepta una captura histórica aunque sea íntegra y sus referencias existan."""
        with sqlite3.connect(self.area / "catalogo.sqlite3") as conexion:
            datos = json.loads(conexion.execute("SELECT datos FROM programas WHERE id=?", (flujo.ID,)).fetchone()[0])
            datos["contenido_publicado"] = "Contenido distinto"
            conexion.execute("UPDATE programas SET datos=? WHERE id=?", (json.dumps(datos), flujo.ID))
        self.assertEqual(self.leer(), {})

    def test_corte_entre_renombrados_restaura_snapshot_y_control_juntos(self) -> None:
        """La sustitución real recupera ambos por el diario común ante fallo capturable."""
        antes = {p.relative_to(self.area).as_posix(): p.read_bytes() for p in self.area.rglob("*") if p.is_file()}
        self.caso.rx.ciclo()
        renombrar = Path.rename
        cortado = False

        def cortar(ruta: Path, destino: Path) -> Path:
            nonlocal cortado
            if ruta == self.area and not cortado:
                cortado = True
                renombrar(ruta, destino)
                raise OSError("Interrupción controlada después de apartar lo vigente")
            return renombrar(ruta, destino)

        with patch.object(Path, "rename", cortar), self.assertRaises(OSError):
            self.caso.componer("2026-10-23T10:06:00Z")
        self.assertTrue(cortado)
        self.assertEqual(
            {p.relative_to(self.area).as_posix(): p.read_bytes() for p in self.area.rglob("*") if p.is_file()}, antes
        )
        self.assertIn(flujo.ID, self.leer())
        self.caso.componer("2026-10-23T10:06:00Z")
        self.assertIn(flujo.ID, self.leer())


if __name__ == "__main__":
    unittest.main()
