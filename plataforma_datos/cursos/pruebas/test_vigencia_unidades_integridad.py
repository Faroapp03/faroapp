"""Integridad nativa coherente entre detalle, páginas y admisión exhaustiva."""

import json
import sqlite3
import unittest
from copy import deepcopy
from unittest.mock import patch

from plataforma_datos.cursos import catalogo
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.cursos import unidades_vigencia as unidades
from plataforma_datos.cursos.pruebas import test_vigencia_unidades as casos_unidades
from plataforma_datos.cursos.pruebas.test_catalogo import lote_base


class IntegridadUnidadesPruebas(unittest.TestCase):
    """Reproduce corrupción exclusivamente en copias sintéticas temporales."""

    def setUp(self) -> None:
        """Prepara el mismo catálogo sintético V10 usado en el contrato tipado."""
        self.caso = casos_unidades.VigenciaUnidadesPruebas()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.base = self.caso.base

    def corromper(self, tabla: str, id: str = "programa-1") -> None:
        """Altera contenido nativo sin actualizar su huella para comprobar rechazo."""
        with sqlite3.connect(self.base) as conexion:
            fila = conexion.execute("SELECT datos FROM " + tabla + " WHERE id=?", (id,)).fetchone()
            datos = json.loads(fila[0])
            datos["campo_alterado"] = "cambio sin huella"
            conexion.execute("UPDATE " + tabla + " SET datos=? WHERE id=?", (json.dumps(datos), id))

    def test_detalle_lista_y_auditoria_rechazan_el_mismo_contenido_alterado(self) -> None:
        """Ninguna vía declara evaluada una entidad cuyo cuerpo ya no corresponde."""
        for tipo in ("edicion", "recurso"):
            registro.registrar_unidad(self.base, self.caso.solicitud(tipo))
        original = self.base.read_bytes()
        for tipo, tabla in (("recurso", "programas"), ("edicion", "ediciones")):
            with self.subTest(tipo=tipo):
                self.base.write_bytes(original)
                self.corromper(tabla)
                antes = self.base.read_bytes()
                with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "Contenido de unidad alterado"):
                    registro.consultar_unidad(self.base, tipo=tipo, id="programa-1")
                with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "Contenido de unidad alterado"):
                    registro.listar_unidades(self.base, tipo=tipo)
                with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "Contenido de unidad alterado"):
                    registro.auditar_unidades_vigencia(self.base)
                if tipo == "edicion":
                    with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "Contenido de unidad alterado"):
                        registro.listar_ediciones(self.base)
                self.assertEqual(self.base.read_bytes(), antes)

    def test_auditoria_incluye_nativos_sin_evaluacion_o_unidad_vinculada(self) -> None:
        """La entrega contiene también recursos nunca evaluados y exige su integridad."""
        self.corromper("programas")
        antes = self.base.read_bytes()
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "Contenido de unidad alterado"):
            registro.auditar_unidades_vigencia(self.base)
        self.assertEqual(self.base.read_bytes(), antes)

    def test_pagina_verifica_solo_los_nativos_seleccionados(self) -> None:
        """Una fila fuera de página no fuerza un barrido; se rechaza al pedir su página."""
        registro.registrar_unidad(self.base, self.caso.solicitud())
        lote = lote_base()
        lote["ediciones"] = []
        lote["programas"] = [{**deepcopy(lote["programas"][0]), "id": "programa-2"}]
        catalogo.cargar_lote(self.base, lote)
        self.corromper("programas", "programa-2")
        antes = self.base.read_bytes()
        with patch.object(
            unidades, "_verificar_contenido_nativo", wraps=unidades._verificar_contenido_nativo
        ) as comprobaciones:
            pagina = registro.listar_unidades(self.base, tipo="recurso", limite=1)
        self.assertEqual(comprobaciones.call_count, 1)
        self.assertEqual(pagina["unidades"][0]["unidad"]["id"], "programa-1")
        self.assertEqual(pagina["unidades"][0]["estado_registro"], "evaluado")
        with self.assertRaisesRegex(registro.ErrorRegistroVigencia, "Contenido de unidad alterado"):
            registro.listar_unidades(
                self.base,
                tipo="recurso",
                limite=1,
                despues_de=pagina["siguiente"],
                revision_esperada=pagina["revision"],
            )
        self.assertEqual(self.base.read_bytes(), antes)

    def test_ddl_conserva_literales_y_limites_de_tokens(self) -> None:
        """El espacio de un literal o identificador cambia el contrato, no solo el formato."""
        original = unidades.ESQUEMA
        self.assertNotEqual(
            unidades._normalizado(original), unidades._normalizado(original.replace("'edicion'", "'edi cion'"))
        )
        self.assertNotEqual(unidades._normalizado("clave TEXT"), unidades._normalizado("claveT EXT"))
        self.assertNotEqual(unidades._normalizado("CHECK(x='a'' b')"), unidades._normalizado("CHECK(x='a''b')"))
        self.assertEqual(
            unidades._normalizado("CHECK ( tipo IN ('edicion', 'recurso') )"),
            unidades._normalizado("CHECK(tipo IN('edicion','recurso'))"),
        )


if __name__ == "__main__":
    unittest.main()
