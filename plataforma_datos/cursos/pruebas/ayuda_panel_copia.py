"""Lecturas comunes de una instalación temporal de Cursos: panel, observaciones, inventario y copia aislada."""

import contextlib
import hashlib
import io
import shutil
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.nucleo import Carpetas
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import panel_catalogo
from plataforma_datos.cursos import registro_vigencia as registro
from plataforma_datos.orquestacion import admision as admision_fuentes

CORTE_DE_LAS_OBSERVACIONES = "2026-10-24T00:00:00Z"


class InstalacionConPanel:
    """Lee el catálogo instalado en `raiz` y redirige a ella las rutas globales de las fuentes.

    Quien lo usa fija `raiz` y `trabajo`, el tipo de unidad cuyas observaciones se leen (`TIPO_OBSERVADO`) y
    `componer`, que compone el catálogo de un corte.
    """

    raiz: Path
    trabajo: Path
    TIPO_OBSERVADO: str
    componer: Callable[[str], dict]

    def _carpetas(self, id: str) -> Carpetas:
        return Carpetas(*fuente.rutas_de_la_fuente(id, self.raiz))

    def _rutas_globales(self) -> contextlib.ExitStack:
        pila = contextlib.ExitStack()
        pila.enter_context(patch.object(fuente, "RAIZ", self.raiz))
        pila.enter_context(patch.object(admision_fuentes, "carpetas", self._carpetas))
        pila.enter_context(
            patch.object(admision_fuentes, "ruta_del_conjunto", lambda id: self._carpetas(id).validado / f"{id}.json")
        )
        pila.enter_context(contextlib.redirect_stdout(io.StringIO()))
        return pila

    def panel(self, corte: str) -> dict[str, dict]:
        """Lee el panel privado del catálogo instalado.

        Returns:
            Filas del panel por unidad.
        """
        solicitud = almacen.solicitud(self.raiz / almacen.RUTA)
        sha = hashlib.sha256(solicitud.validacion_destino.read_bytes()).hexdigest()
        return {f["id"]: f for f in panel_catalogo.desde_admision(solicitud, sha, corte_utc=corte)["unidades"]}

    def panel_en_copia(self, corte: str) -> dict[str, dict]:
        """Compone sobre una copia aislada, lee su panel y restaura la raíz original.

        Returns:
            Filas del panel por unidad, leídas en la copia.
        """
        copia = self.trabajo / "copia-de-referencia"
        shutil.copytree(self.raiz, copia)
        original = self.raiz
        try:
            self.raiz = copia
            self.componer(corte)
            return self.panel(corte)
        finally:
            self.raiz = original
            shutil.rmtree(copia)

    def inventario(self) -> dict:
        """Fija bytes y fechas de la instalación y la web.

        Returns:
            SHA y mtime por ruta.
        """
        return {
            p.relative_to(self.raiz).as_posix(): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns)
            for carpeta in (self.raiz / almacen.RUTA, self.raiz / "web")
            for p in carpeta.rglob("*")
            if p.is_file()
        }

    def observaciones(self, id: str) -> list[dict]:
        """Lee las observaciones registradas de la unidad en el catálogo instalado.

        Returns:
            Observaciones únicas en su orden de registro.
        """
        ruta = almacen.solicitud(self.raiz / almacen.RUTA).snapshot.ruta
        return registro.observaciones_hasta(ruta, tipo=self.TIPO_OBSERVADO, id=id, corte=CORTE_DE_LAS_OBSERVACIONES)
