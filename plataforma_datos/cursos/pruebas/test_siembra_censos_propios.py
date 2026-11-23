"""Alta desde cero de Cibernàrium y Cibervoluntarios sobre un almacén sembrado, con su evidencia y sin duplicar."""

import json
import shutil
import sqlite3
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import sembrar_almacen
from plataforma_datos.cursos.fuentes.barcelonactiva import adquisicion
from plataforma_datos.cursos.fuentes.cibervoluntarios import actualizacion as ciber
from plataforma_datos.cursos.fuentes.cibervoluntarios import metodo_interfaz
from plataforma_datos.cursos.pruebas import test_ciber_actualizacion as caso_ciber
from plataforma_datos.cursos.pruebas import test_cibernarium_paginas_fallidas as caso_cibernarium


def _programas(base: Path) -> list[tuple[str, str]]:
    with sqlite3.connect(base / "catalogo.sqlite3") as conexion:
        return conexion.execute("SELECT id, proveedor_id FROM programas ORDER BY id").fetchall()


class CibernariumDesdeCero(caso_cibernarium.PaginasFallidasCibernariumPruebas):
    """Censo sintético de dos actividades consultado por la operación real sobre un almacén sembrado."""

    def test_censo_completo_da_de_alta_sus_ediciones_con_evidencia_y_repetir_no_duplica(self) -> None:
        """Sin identidades previas, la consulta da de alta el proveedor, las actividades y sus ediciones."""
        shutil.move(self.raiz / almacen.RUTA, self.trabajo / "almacen-perdido")
        sembrar_almacen.sembrar(self.raiz)
        self.assertEqual(fuente.conocidos("barcelonactiva", self.raiz), [])
        # Las fichas HTML no intervienen en el alta: se omiten para no simular otro transporte.
        with patch.object(adquisicion, "MAX_FICHAS_NUEVAS", 0):
            self.assertTrue(self.consultar_fuente("21:10", {0: "normal", 1: "normal"}))
        self.assertIs(fuente.leer_validado("barcelonactiva", self.raiz)["censo_completo"], True)
        ofertas = self.componer("2026-10-23T21:40:00Z")
        self.assertEqual(set(ofertas), {caso_cibernarium.PRIMERA, caso_cibernarium.SEGUNDA})
        self.assertTrue(all(o["comprobado_el"] == "2026-10-23T21:10:01Z" for o in ofertas.values()))
        programas = _programas(self.raiz / almacen.RUTA)
        self.assertEqual(programas, [("cibernarium:123", "cibernarium"), ("cibernarium:124", "cibernarium")])
        with patch.object(adquisicion, "MAX_FICHAS_NUEVAS", 0):
            self.assertTrue(self.consultar_fuente("22:00", {0: "normal", 1: "normal"}))
        self.componer("2026-10-23T22:30:00Z")
        self.assertEqual(_programas(self.raiz / almacen.RUTA), programas)


class CibervoluntariosDesdeCero(caso_ciber.ActualizacionCiberPruebas):
    """Censo sintético con método revisado aplicado a un almacén sembrado."""

    def test_censo_da_de_alta_los_materiales_acreditados_y_repetir_no_duplica(self) -> None:
        """Sin identidades previas, el material acreditado se da de alta; el familiar sigue rechazado."""
        raiz = self.raiz / "Instalación sembrada"
        sembrar_almacen.sembrar(raiz)
        sembrado = almacen.solicitud(raiz / almacen.RUTA)
        entrada = almacen.EntradaCatalogo(
            admision=sembrado, sha256_admision=self.ref(sembrado.validacion_destino).sha256
        )
        nuevo = {**self.material.material_publicado, "id": 21, "slug": "curso-nuevo", "title": "Python"}
        familiar = {**nuevo, "id": 22, "slug": "para-familias", "paraTiContent": "<li>Convives con menores.</li>"}
        cuerpo = json.dumps(
            {
                "hydra:totalItems": 2,
                "hydra:member": [
                    {"id": 10 + i, "title": "Actividad", "type": "Taller", "activityCatalogMaterials": [m]}
                    for i, m in enumerate((nuevo, familiar))
                ],
            }
        ).encode()
        conjunto = self.rx.calcular([self.rx.captura(caso_ciber.adquisicion.url_pagina(1), cuerpo)])
        aux = self.rx.auxiliares
        # Solo se revisa el código sintético del fixture, como en su prueba de alta.
        with patch.multiple(
            metodo_interfaz,
            VERSIONES_REVISADAS={(aux["declaraciones"]["cuerpo"]["sha256"], aux["componente"]["cuerpo"]["sha256"])},
            IDIOMA_SHA256=aux["idioma"]["cuerpo"]["sha256"],
        ):
            primera = self.raiz / "alta"
            ciber.aplicar(entrada, conjunto=conjunto, original=self.raiz, destino=primera, corte="2026-10-23T18:30:00Z")
            programas = _programas(primera)
            self.assertEqual(programas, [("cibervoluntarios:material:21", "cibervoluntarios")])
            solicitud = almacen.solicitud(primera)
            segunda = self.raiz / "alta-repetida"
            ciber.aplicar(
                almacen.EntradaCatalogo(
                    admision=solicitud, sha256_admision=self.ref(solicitud.validacion_destino).sha256
                ),
                conjunto=conjunto,
                original=self.raiz,
                destino=segunda,
                corte="2026-10-23T18:30:00Z",
            )
            self.assertEqual(_programas(segunda), programas)


# Las pruebas heredadas ya se ejecutan en sus propios módulos.
for _clase, _base in (
    (CibernariumDesdeCero, caso_cibernarium.PaginasFallidasCibernariumPruebas),
    (CibervoluntariosDesdeCero, caso_ciber.ActualizacionCiberPruebas),
):
    for _nombre in [n for n in dir(_base) if n.startswith("test_")]:
        setattr(_clase, _nombre, None)
del _clase, _base, _nombre
