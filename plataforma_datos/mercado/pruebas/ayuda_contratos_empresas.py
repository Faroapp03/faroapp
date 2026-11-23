"""Instalación sintética de Empresas con sus contratos y un validado propio, para pruebas de cualquier paquete."""

import hashlib
import json
import tempfile
from pathlib import Path
from unittest import mock

import plataforma_datos.mercado.fuentes.empresas.piezas.contrato_eticce as contrato_eticce
import plataforma_datos.mercado.fuentes.empresas.piezas.correspondencia_cnae as correspondencia_cnae
from plataforma_datos.comun import entrada_salida

RUTA_ETICCE = "plataforma_datos/mercado/fuentes/empresas/contratos/empresas-eticce2026.json"
RUTA_CNAE = "plataforma_datos/mercado/fuentes/empresas/contratos/empresas-cnae2025.json"


class InstalacionContratosEmpresas:
    """Monta en una raíz temporal los contratos de Empresas y su admisión, y apunta a ellos los módulos de Mercado.

    Ofrece `raiz`, `eticce`, `cnae` (los dos contratos), `carpeta`, `informe`, `conjunto` y `validacion` (el
    informe admitido en memoria). Cambiar los bytes de un contrato invalida la admisión, como en una instalación real.
    Se combina con `unittest.TestCase`.
    """

    def setUp(self) -> None:
        """Crea contratos y validado propios; ninguna prueba escribe en el producto o sus datos compartidos."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.eticce = self.raiz / RUTA_ETICCE
        self.cnae = self.raiz / RUTA_CNAE
        self.eticce.parent.mkdir(parents=True)
        self.eticce.write_bytes(contrato_eticce.RUTA_CONTRATO.read_bytes())
        self.cnae.write_bytes(correspondencia_cnae._CONTRATO.read_bytes())
        for parche in [
            mock.patch.object(contrato_eticce, "RUTA_CONTRATO", self.eticce),
            mock.patch.object(correspondencia_cnae, "_CONTRATO", self.cnae),
            mock.patch.object(entrada_salida, "VALIDADOS", self.raiz / "var/actualizacion/validados"),
        ]:
            parche.start()
            self.addCleanup(parche.stop)
        self.carpeta = self.raiz / "var/actualizacion/validados/empresas"
        self.carpeta.mkdir(parents=True)
        self.informe = self.carpeta / "validacion.json"
        self.conjunto = self.carpeta / "empresas.json"
        self.validacion = {
            "estado": "Admitido",
            "cobertura": {"edicion": "2025–1T2026"},
            "controles": [{"control": "datos propios de la prueba", "resultado": "correcto"}],
            "recursos_de_validacion": {
                RUTA_ETICCE: hashlib.sha256(self.eticce.read_bytes()).hexdigest(),
                RUTA_CNAE: hashlib.sha256(self.cnae.read_bytes()).hexdigest(),
            },
        }
        self.informe.write_text(json.dumps(self.validacion), encoding="utf-8")
        self.conjunto.write_text(
            json.dumps(
                {"encuesta": {"edicion": "2025–1T2026", "clasificacion": "CNAE-2025"}, "espana": {"total": 33.6}}
            ),
            encoding="utf-8",
        )
