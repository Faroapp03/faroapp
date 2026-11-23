"""Activa el recibo v3 que emite el candidato real, con estado v5 y catálogo, sin relajar sus vínculos."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import almacen_catalogo
from plataforma_datos.orquestacion import actualizar, candidato
from plataforma_datos.orquestacion import almacen_trabajos as trabajos
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import VERSION_PANEL_REVISION_PENDIENTE
from plataforma_datos.orquestacion.pruebas import test_activacion as activacion
from plataforma_datos.orquestacion.pruebas import test_recibos_catalogo_compactos as catalogos
from plataforma_datos.orquestacion.pruebas.test_candidato import EjecutorCandidato, preparar


def serializar(objeto: object) -> bytes:
    """Representa el recibo con el mismo formato que su productor.

    Returns:
        JSON UTF-8 sin espacios, con caracteres Unicode literales.
    """
    return json.dumps(objeto, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def recibo_del_candidato(caso: unittest.TestCase, catalogo: catalogos.RecibosCatalogoCompactos) -> dict:
    """Ejecuta el candidato real sobre una instalación con el catálogo admitido conservado.

    Solo los procesos externos son dobles; estado del panel, catálogo y recibo salen de sus productores.

    Returns:
        Recibo validado, completado con la reserva igual que lo hace el ejecutor operativo.
    """
    temporal = tempfile.TemporaryDirectory()
    caso.addCleanup(temporal.cleanup)
    raiz = Path(temporal.name).resolve() / "Mis documentos" / "Año 2026"
    preparar(raiz)
    almacen_catalogo.conservar(
        almacen_catalogo.EntradaCatalogo(
            admision=catalogo.solicitud,
            sha256_admision=catalogo.hp.ref(catalogo.solicitud.validacion_destino).sha256,
        ),
        destino=raiz / almacen_catalogo.RUTA,
    )
    with patch.object(actualizar.time, "sleep"), patch.dict(os.environ, {"FARO_AVISO": ""}):
        cuerpo = candidato.ejecutar_candidato(raiz, "actualizar-datos", EjecutorCandidato())
    caso.assertEqual(cuerpo["version"], trabajos.VERSION_RECIBO_CONSERVADOS)
    caso.assertEqual(cuerpo["resultado"], "validado")
    caso.assertEqual(cuerpo["estado"]["version"], VERSION_PANEL_REVISION_PENDIENTE)
    caso.assertIsNotNone(cuerpo["catalogo"])
    cuerpo.update(solicitudId=activacion.SOLICITUD, revisionReserva=1)
    return cuerpo


class ActivacionCatalogoCompacto(unittest.TestCase):
    """Recorre productor, almacenamiento y activación reales con proveedor remoto interceptado."""

    def setUp(self) -> None:
        """Conserva el recibo del candidato y su artefacto en almacenamiento sintético."""
        catalogo = catalogos.RecibosCatalogoCompactos()
        self.addCleanup(catalogo.doCleanups)
        catalogo.setUp()
        self.producido = recibo_del_candidato(self, catalogo)
        # El artefacto de la prueba es sintético: su huella sustituye a la del paquete que no se exporta.
        self.caso = activacion.ActivacionTest()
        self.addCleanup(self.caso.doCleanups)
        with (
            patch.object(activacion, "recibo", lambda: serializar(self.producido)),
            patch.object(activacion, "serializar", serializar),
        ):
            self.caso.setUp()
        guardado = trabajos.recuperar_trabajo(activacion.SOLICITUD, 1, "123", self.caso.almacen)
        self.assertIsNotNone(guardado)
        self.indice, cuerpo = guardado
        self.assertEqual(self.indice["version"], trabajos.VERSION_INDICE_COMPACTO)
        self.assertEqual(cuerpo, self.caso.recibo)
        conservado = json.loads(cuerpo)
        self.assertEqual({**conservado, "huellaPaquete": None}, {**self.producido, "huellaPaquete": None})

    def test_activa_catalogo_compacto_y_repetir_no_duplica_efectos(self) -> None:
        """La forma compacta conserva el mismo artefacto y la misma autoridad CAS."""
        antes = dict(self.caso.almacen.objetos)
        self.assertEqual(self.caso.ejecutar()["fase"], "confirmada")
        self.assertEqual(self.caso.ejecutar()["fase"], "confirmada")
        self.assertEqual(self.caso.efectos, ["subir", "desplegar"])
        self.assertEqual(self.caso.almacen.objetos, antes)
        self.caso.cliente.comprobar_manifiesto_web.assert_called_with("https://publico.example", self.caso.web_sha)

    def test_pieza_alterada_no_llega_al_proveedor(self) -> None:
        """Una pieza conservada bajo otra huella impide reservar o publicar."""
        sobre_sha = self.indice["recibo"]["composicion"]["sha256"]
        sobre = json.loads(self.caso.almacen.objetos[f"blobs/{sobre_sha}"])
        clave = f"blobs/{sobre['catalogo']['sha256']}"
        self.caso.almacen.objetos[clave] += b" "
        with self.assertRaises(ValueError):
            self.caso.ejecutar()
        self.assertEqual(self.caso.efectos, [])

    def test_huella_autorizada_distinta_no_activa(self) -> None:
        """Aceptar el índice compacto no permite sustituir el recibo autorizado."""
        self.caso.cliente.trabajo["huellaRecibo"] = "0" * 64
        with self.assertRaises(activacion.modulo.CandidatoNoVerificable):
            self.caso.ejecutar()
        self.assertEqual(self.caso.efectos, [])

    def test_reconcilia_subida_incierta_sin_repetirla(self) -> None:
        """Un recibo compacto conserva la recuperación segura del intento original."""
        self.caso.perder = "subir"
        with self.assertRaises(OSError):
            self.caso.ejecutar()
        self.caso.versiones = [
            {
                "versionId": activacion.NUEVA,
                "tag": activacion.SOLICITUD,
                "message": self.caso.artefacto["sha256Artefacto"],
            }
        ]
        self.caso.perder = None
        self.assertEqual(self.caso.recuperar()["fase"], "confirmada")
        self.assertEqual(self.caso.efectos, ["subir", "desplegar"])
