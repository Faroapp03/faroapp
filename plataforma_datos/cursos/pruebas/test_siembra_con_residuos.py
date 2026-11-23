"""Siembra en una instalación real: siguen los conjuntos admitidos de HP LIFE y FUNDAE aunque se pierda el almacén."""

import hashlib
import json
import shutil
import sqlite3
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import componer_catalogo as componer
from plataforma_datos.cursos import operacion_fuente as fuente
from plataforma_datos.cursos import sembrar_almacen
from plataforma_datos.cursos.pruebas import test_componer_catalogo as hp
from plataforma_datos.cursos.pruebas import test_fundae_fallos_por_unidad as fundae
from plataforma_datos.orquestacion import estado_panel


def _programas(raiz: object) -> list[tuple[str, str]]:
    with sqlite3.connect(raiz / almacen.RUTA / "catalogo.sqlite3") as conexion:  # type: ignore[operator]
        return conexion.execute("SELECT id, proveedor_id FROM programas").fetchall()


# La huella de cada archivo de una carpeta de conjuntos admitidos, por su ruta relativa.
def _huellas(carpeta: Path) -> dict[str, str]:
    return {
        archivo.relative_to(carpeta).as_posix(): hashlib.sha256(archivo.read_bytes()).hexdigest()
        for archivo in sorted(carpeta.rglob("*"))
        if archivo.is_file()
    }


class SiembraConValidadoDeHpLife(hp.ComponerCatalogoPruebas):
    """El validado anterior de HP LIFE sigue en la instalación cuando se siembra un almacén nuevo."""

    def test_hp_life_no_se_aplica_sin_identidades_y_conserva_su_evidencia(self) -> None:
        """Sin identidades HP en el almacén, su conjunto no da altas ni tumba el paso; el validado sigue intacto."""
        validado = fuente.leer_validado("hp_life", self.raiz)
        self.assertIsNotNone(validado)
        shutil.move(self.raiz / almacen.RUTA, self.caso.raiz / "almacen-perdido")
        sembrar_almacen.sembrar(self.raiz)
        with self.assertRaises(componer.AlmacenNoDisponible) as fallo:
            componer.componer(raiz=self.raiz, corte_utc="2026-10-23T04:00:00Z")
        self.assertEqual(fallo.exception.codigo, componer.VACIO)
        self.assertIn("hp_life", str(fallo.exception))
        self.assertEqual(_programas(self.raiz), [])
        self.assertEqual(fuente.leer_validado("hp_life", self.raiz), validado)


class SiembraConPendientesDeFundae(fundae.PendientesFundaePruebas):
    """El validado y los pendientes de FUNDAE siguen en la instalación cuando se siembra un almacén nuevo."""

    def test_fundae_no_se_aplica_sin_identidades_y_conserva_sus_pendientes(self) -> None:
        """Sin altas de un censo completo, ni el validado ni los pendientes de FUNDAE se aplican tras una siembra."""
        self.ciclo("10:00")
        self.componer(self.raiz, "2026-10-23T10:05:00Z")
        self.ciclo("10:30")
        self.ciclo("11:00", digitalizate=503)
        _original, _preparado, validados = fuente.rutas_de_la_fuente("fundae", self.raiz)
        pendientes = sorted(p.name for p in (validados / "pendientes").glob("*.json"))
        self.assertTrue(pendientes)
        # Tras sembrar, el conjunto de FUNDAE no se puede leer con sus identidades (el almacén no tiene ninguna):
        # que sigue intacto se comprueba por los bytes de sus archivos.
        validado = _huellas(validados)
        self.assertTrue(validado)
        # Con identidades en el almacén, uno calculado con otras tampoco se aplica: se conserva y el panel lo dice.
        de_otras = {"censo": {"altas": [1880], "identidades_sha256": "0" * 64}}
        con_identidades = componer.fundae_retenido(self.raiz, self.raiz / almacen.RUTA, de_otras)
        self.assertEqual(con_identidades, "calculado-con-otras-identidades")
        shutil.move(self.raiz / almacen.RUTA, self.caso.raiz / "almacen-perdido")
        sembrar_almacen.sembrar(self.raiz)
        base = self.raiz / almacen.RUTA
        self.assertEqual(componer.fundae_retenido(self.raiz, base), "sin-altas-del-censo")
        # Uno con altas, pero calculado con las identidades de antes de la siembra, tampoco se aplica.
        de_antes = {"censo": {"altas": [1880], "identidades_sha256": "0" * 64}}
        self.assertEqual(componer.fundae_retenido(self.raiz, base, de_antes), "calculado-con-otras-identidades")
        self.assertTrue(estado_panel._fundae_sin_aplicar(self.raiz))
        with self.assertRaises(componer.AlmacenNoDisponible) as fallo:
            componer.componer(raiz=self.raiz, corte_utc="2026-10-23T11:30:00Z")
        self.assertEqual(fallo.exception.codigo, componer.VACIO)
        self.assertEqual(_programas(self.raiz), [])
        self.assertEqual(sorted(p.name for p in (validados / "pendientes").glob("*.json")), pendientes)
        self.assertEqual(_huellas(validados), validado)


class AvisoDeConjuntosRetenidosDeFundae(fundae.PendientesFundaePruebas):
    """El aviso del panel cuenta solo los pendientes retenidos, y se apaga al instalarse uno posterior."""

    def retener(self, retenido: object) -> object:
        """Hace que `fundae_retenido` retenga solo ese conjunto, en la composición y en el panel.

        Returns:
            El gestor de contexto con el parche.
        """
        real = componer.fundae_retenido

        def retiene(raiz: Path, base: Path, conjunto: dict | None = None, inicial: Path | None = None) -> str | None:
            return "calculado-con-otras-identidades" if conjunto == retenido else real(raiz, base, conjunto, inicial)

        return patch.object(componer, "fundae_retenido", retiene)

    def test_recien_instalado_un_conjunto_el_panel_no_avisa(self) -> None:
        """El validado instalado no cuenta, aunque su huella sea la de antes de sus altas."""
        self.ciclo("10:00")
        self.componer(self.raiz, "2026-10-23T10:05:00Z")
        with self.retener(fuente.leer_validado("fundae", self.raiz)):
            self.assertFalse(estado_panel._fundae_sin_aplicar(self.raiz))
            resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T10:10:00Z")
        self.assertNotIn("fundae_sin_aplicar", resultado)

    def test_un_pendiente_retenido_deja_de_avisar_al_instalarse_uno_posterior(self) -> None:
        """Se aparta como evidencia en `superados/`: ni sigue pendiente ni avisa."""
        self.ciclo("10:00")
        self.componer(self.raiz, "2026-10-23T10:05:00Z")
        self.ciclo("10:30")
        retenido = fuente.leer_validado("fundae", self.raiz)
        self.ciclo("11:00")
        _, _, validados = fuente.rutas_de_la_fuente("fundae", self.raiz)
        with self.retener(retenido):
            resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T11:30:00Z")
            self.assertEqual(resultado["fundae_sin_aplicar"], "calculado-con-otras-identidades")
            self.assertEqual([c for _, c in fuente.leer_pendientes("fundae", self.raiz)], [retenido])
            self.assertTrue(estado_panel._fundae_sin_aplicar(self.raiz))
            self.ciclo("12:00")
            self.assertEqual(fuente.leer_pendientes("fundae", self.raiz), [])
            self.assertFalse(estado_panel._fundae_sin_aplicar(self.raiz))
        self.assertEqual(list((validados / "pendientes").glob("*.json")), [])
        conservados = list((validados / "superados").glob("*.json"))
        self.assertEqual([json.loads(c.read_text(encoding="utf-8")) for c in conservados], [retenido])

    def test_el_validado_sin_instalar_avisa_y_instalado_no(self) -> None:
        """Retenido y aún sin instalar, cuenta en el panel y en la composición; instalado, ya no."""
        self.ciclo("10:00")
        validado = fuente.leer_validado("fundae", self.raiz)
        with self.retener(validado):
            self.assertTrue(estado_panel._fundae_sin_aplicar(self.raiz))
            resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T10:05:00Z")
            self.assertEqual(resultado["fundae_sin_aplicar"], "calculado-con-otras-identidades")
        resultado = componer.componer(raiz=self.raiz, corte_utc="2026-10-23T10:10:00Z")
        self.assertNotIn("fundae_sin_aplicar", resultado)
        with self.retener(validado):
            self.assertFalse(estado_panel._fundae_sin_aplicar(self.raiz))

    def retenido_con_uno_posterior_instalado(self) -> tuple[dict, Path]:
        """Un pendiente retenido y, ya instalado, el validado posterior.

        Returns:
            El conjunto retenido y la carpeta de validados de FUNDAE.
        """
        self.ciclo("10:00")
        self.componer(self.raiz, "2026-10-23T10:05:00Z")
        self.ciclo("10:30")
        retenido = fuente.leer_validado("fundae", self.raiz)
        self.ciclo("11:00")
        with self.retener(retenido):
            componer.componer(raiz=self.raiz, corte_utc="2026-10-23T11:30:00Z")
        return retenido, fuente.rutas_de_la_fuente("fundae", self.raiz)[2]

    def comprobar_que_sigue_pendiente(self, validados: Path) -> None:
        """Admite un ciclo más sin fallar y comprueba que el pendiente no se apartó."""
        self.ciclo("12:00")
        self.assertEqual(len(list((validados / "pendientes").glob("*.json"))), 1)
        self.assertFalse((validados / "superados").exists())

    def recibo_del_retenido(self, retenido: dict) -> Path:
        """El archivo del recibo de la consulta de Digitalízate de ese conjunto.

        Returns:
            Su ruta en los originales.
        """
        return self.original / retenido["auxiliares"]["digitalizate"]["recibo"]["archivo"]

    def test_un_pendiente_con_el_recibo_ausente_se_queda_donde_esta(self) -> None:
        """La admisión sigue y el pendiente no se aparta."""
        retenido, validados = self.retenido_con_uno_posterior_instalado()
        self.recibo_del_retenido(retenido).unlink()
        self.comprobar_que_sigue_pendiente(validados)

    def test_un_pendiente_con_el_recibo_ilegible_se_queda_donde_esta(self) -> None:
        """La admisión sigue y el pendiente no se aparta."""
        retenido, validados = self.retenido_con_uno_posterior_instalado()
        self.recibo_del_retenido(retenido).write_bytes(b"no es el recibo")
        self.comprobar_que_sigue_pendiente(validados)

    def test_un_pendiente_sin_capturas_se_queda_donde_esta(self) -> None:
        """Sin capturas no hay corte: la admisión sigue y el pendiente no se aparta."""
        _, validados = self.retenido_con_uno_posterior_instalado()
        for ruta in (validados / "pendientes").glob("*.json"):
            ruta.unlink()
        vacio = json.dumps({"recepciones": [], "auxiliares": {}}, sort_keys=True, separators=(",", ":"))
        (validados / "pendientes" / (hashlib.sha256(vacio.encode()).hexdigest() + ".json")).write_text(vacio)
        self.comprobar_que_sigue_pendiente(validados)


# Las pruebas heredadas ya se ejecutan en sus propios módulos.
for _clase, _base in (
    (SiembraConValidadoDeHpLife, hp.ComponerCatalogoPruebas),
    (SiembraConPendientesDeFundae, fundae.PendientesFundaePruebas),
    (AvisoDeConjuntosRetenidosDeFundae, fundae.PendientesFundaePruebas),
):
    for _nombre in [n for n in dir(_base) if n.startswith("test_")]:
        setattr(_clase, _nombre, None)
del _clase, _base, _nombre
