"""Pruebas del lote sellado, su referencia monotónica y su restauración desde una base exacta."""

import shutil
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.comun.nucleo import CORRECTO
from plataforma_datos.orquestacion import lotes_de_entradas as lotes
from plataforma_datos.orquestacion.almacen_s3 import AlmacenS3NoDisponible
from plataforma_datos.orquestacion.entradas_por_fuente import EntradaInvalida, EntradaNoDisponible, _rutas
from plataforma_datos.orquestacion.pruebas import test_entradas_por_fuente as fixture

TICH = lotes.DatosEntrada(fixture.OBSERVADO, fixture.LECTOR, fixture.DEPENDENCIAS)
CITILAB = lotes.DatosEntrada(fixture.OBSERVADO, fixture.LECTOR, {})
IDENTIDAD = fixture.IDENTIDAD


class PruebaLotesDeEntradas(unittest.TestCase):
    """Árbol combinado sin tocar el candidato ni la referencia normal de mantenimiento."""

    def setUp(self) -> None:
        """Prepara el mismo almacén privado de disco que la prueba por fuente."""
        self.caso = fixture.PruebaEntradasPorFuente()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)

    def ultimo(self) -> lotes.IdentidadEntradas | None:
        """Consulta la referencia del último lote.

        Returns:
            Identidad del último lote confirmado.
        """
        return lotes.leer_ultimo_lote(
            IDENTIDAD.revision_base,
            IDENTIDAD.sha256_base,
            IDENTIDAD.dia,
            almacen=self.caso.almacen,
        )

    def test_lote_deja_fuera_invalida_y_no_relee_por_fuente(self) -> None:
        """Una fuente inválida no impide conservar otra y sus entradas quedan aisladas."""
        original, _, validado = _rutas("citilab")
        for relativa in (original, validado):
            (self.caso.raiz / relativa).mkdir(parents=True)
        guardar_json(self.caso.raiz / original / "procedencia.json", {})
        fuentes = {"citilab": CITILAB, "tich": TICH}
        entradas = lotes.guardar_lote(IDENTIDAD, self.caso.raiz, fuentes, almacen=self.caso.almacen)
        self.assertEqual(set(entradas), {"tich"})
        self.assertEqual(self.ultimo(), IDENTIDAD)
        self.assertEqual(
            entradas,
            lotes.recuperar_lote(IDENTIDAD, self.caso.destino, almacen=self.caso.almacen),
        )
        self.assertFalse((self.caso.destino / original).exists())
        self.assertTrue((self.caso.destino / fixture.VALIDADOS / "tich.json").is_file())

    def test_puntero_nunca_retrocede_y_lote_antiguo_sigue_accesible(self) -> None:
        """Un reintento de la reserva anterior no reemplaza una más nueva confirmada."""
        anterior = replace(IDENTIDAD, revision_reserva=43, run_id="43")
        fuentes = {"tich": TICH}
        for identidad in (anterior, IDENTIDAD, anterior):
            lotes.guardar_lote(identidad, self.caso.raiz, fuentes, almacen=self.caso.almacen)
        self.assertEqual(self.ultimo(), IDENTIDAD)
        self.assertIsNotNone(lotes.recuperar_lote(anterior, self.caso.destino, almacen=self.caso.almacen))

    def test_sin_sello_completo_no_hay_ultimo_lote(self) -> None:
        """Un corte después de escribir un objeto todavía no hace visible el lote."""
        guardar = self.caso.almacen.guardar

        def cortar(clave: str, origen: Path, huella: str, tamano: int) -> None:
            guardar(clave, origen, huella, tamano)
            raise AlmacenS3NoDisponible("corte")

        with (
            mock.patch.object(self.caso.almacen, "guardar", side_effect=cortar),
            self.assertRaises(EntradaNoDisponible),
        ):
            lotes.guardar_lote(IDENTIDAD, self.caso.raiz, {"tich": TICH}, almacen=self.caso.almacen)
        self.assertIsNone(self.ultimo())
        self.assertIsNone(lotes.recuperar_lote(IDENTIDAD, self.caso.destino, almacen=self.caso.almacen))
        self.assertFalse(self.caso.destino.exists())

    def test_agrupa_dos_fuentes_bajo_un_solo_indice(self) -> None:
        """El umbral del lote agrupa los cambios compartidos sin transferir un objeto por ficha."""
        original, _, validado = _rutas("citilab")
        for relativa in (original, validado):
            (self.caso.raiz / relativa).mkdir(parents=True)
        fichas = []
        for indice in range(17):
            ruta = self.caso.raiz / original / f"ficha-{indice}.json"
            ruta.write_text(str(indice))
            fichas.append({"archivo": ruta.name, "sha256": sha256(ruta)})
        guardar_json(self.caso.raiz / original / "procedencia.json", {"archivos": fichas})
        guardar_json(self.caso.raiz / validado / "citilab.json", {})
        guardar_json(
            self.caso.raiz / validado / "validacion.json",
            {
                "estado": "Admitido",
                "controles": [{"control": "fichas", "resultado": CORRECTO}],
            },
        )
        fuentes = {"citilab": CITILAB, "tich": TICH}
        guardado = lotes.guardar_lote(IDENTIDAD, self.caso.raiz, fuentes, almacen=self.caso.almacen)
        self.assertEqual(set(guardado), set(fuentes))
        self.assertEqual(sum(k.startswith("agrupaciones/v1/entradas/") for k in self.caso.almacen.controles), 1)
        self.assertEqual(guardado, lotes.recuperar_lote(IDENTIDAD, self.caso.destino, almacen=self.caso.almacen))

    def _copia_base(self) -> tuple[Path, lotes.IdentidadEntradas]:
        base = self.caso.base / "base-sellada"
        contenido = base / "contenido"
        shutil.copytree(self.caso.raiz, contenido)
        datos = contenido / "datos"
        datos.mkdir()
        paquete = datos / "manifiesto.json"
        guardar_json(paquete, {})
        archivos = [
            {"ruta": ruta.relative_to(contenido).as_posix(), "bytes": ruta.stat().st_size, "sha256": sha256(ruta)}
            for ruta in sorted(contenido.rglob("*"))
            if ruta.is_file()
        ]
        manifiesto = base / "manifiesto.json"
        guardar_json(
            manifiesto,
            {
                "version": 3,
                "revisionCodigo": IDENTIDAD.revision_base,
                "manifiestoPaqueteSha256": sha256(paquete),
                "estadoSha256": None,
                "archivos": archivos,
                "bytesTotales": sum(a["bytes"] for a in archivos),
            },
        )
        return base, replace(IDENTIDAD, sha256_base=sha256(manifiesto))

    def test_base_exacta_solo_transfiere_el_delta_y_se_relee_su_sha(self) -> None:
        """Reutiliza los bytes de la generación firmada, rechazando cualquier mutación local."""
        base, identidad = self._copia_base()
        self.caso.conjunto.write_bytes(b'{"anio":"2027"}')
        entradas = lotes.guardar_lote(
            identidad,
            self.caso.raiz,
            {"tich": TICH},
            almacen=self.caso.almacen,
            base_sellada=base,
        )
        self.assertEqual(len(self.caso.almacen.creados), 2)  # inventario y conjunto cambiado
        with self.assertRaises(EntradaInvalida):
            lotes.recuperar_lote(identidad, self.caso.destino, almacen=self.caso.almacen)
        self.assertFalse(self.caso.destino.exists())
        self.assertEqual(
            entradas,
            lotes.recuperar_lote(
                identidad,
                self.caso.destino,
                almacen=self.caso.almacen,
                base_sellada=base,
            ),
        )
        self.assertEqual((self.caso.destino / fixture.VALIDADOS / "tich.json").read_bytes(), b'{"anio":"2027"}')
        (base / "contenido" / fixture.ORIGINALES / self.caso.original.name).write_bytes(b"copia alterada")
        destino = self.caso.base / "copia-invalida"
        with self.assertRaises(EntradaInvalida):
            lotes.recuperar_lote(identidad, destino, almacen=self.caso.almacen, base_sellada=base)
        self.assertFalse(destino.exists())
