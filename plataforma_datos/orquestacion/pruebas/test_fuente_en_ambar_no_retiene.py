"""Una fuente que no se puede leer no retiene a las demás: el paquete se publica y la generación del intento queda.

Recorre el motor real del candidato (módulos, publicación, comparación, cuarentena, estado e informe) y después el
exportador real de la generación sobre la misma instalación. Citilab falla en su descarga, como en producción; Cataluña
publica una versión nueva con originales nuevos, y el paquete nuevo los cita por huella. Solo se sustituyen las órdenes
externas: las etapas de las fuentes, la exportación del paquete (escribe `datos/` con un manifiesto que cita los
originales nuevos), la composición del catálogo, el ensamblado, el cotejo de la web y las comprobaciones con Node.
"""

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import guardar_json, sha256
from plataforma_datos.orquestacion import actualizar, candidato
from plataforma_datos.orquestacion import generacion_operativa as generacion
from plataforma_datos.orquestacion.pruebas.test_generacion_operativa import REVISION, preparar

CATALUNA = "var/actualizacion/originales/cataluna"
CITILAB = "var/actualizacion/originales/citilab"
POR_LECTOR = {lector.__name__: fuente for fuente, lector in actualizar.FUENTES_EN_ORDEN}


class EjecutorDelDia(list):
    """Órdenes externas de un día con Citilab inaccesible; anota cada una."""

    def __call__(self, orden: list[str], area: Path) -> actualizar.Resultado:
        """Responde como cada orden real de la ronda.

        Returns:
            El resultado sintético de la orden.
        """
        self.append(list(orden))
        if tuple(orden) == candidato.ORDEN_IDENTIDAD:
            huella = hashlib.sha256((area / "datos/manifiesto.json").read_bytes()).hexdigest()[:16]
            return actualizar.Resultado(0, json.dumps({"version": huella}))
        if "plataforma_datos.orquestacion.exportar_paquete" in orden:
            self.exportar(area)
            return actualizar.Resultado(0, "")
        fuente, etapa = (POR_LECTOR.get(orden[2]), orden[3]) if len(orden) > 3 else (None, None)  # noqa: PLR2004
        if fuente == "citilab" and etapa == "descargar":
            return actualizar.Resultado(
                1, "✗ citilab: la fuente responde con una página de comprobación y no con datos"
            )
        if fuente == "cataluna":
            self.cataluna(area, etapa)
        return actualizar.Resultado(0, "")

    @staticmethod
    def cataluna(area: Path, etapa: str) -> None:
        """Cataluña descarga una edición nueva y valida su conjunto nuevo."""
        if etapa == "descargar":
            guardar_json(area / CATALUNA / "edición.json", {"edicion": "nueva"})
            huella = sha256(area / CATALUNA / "edición.json")
            guardar_json(
                area / CATALUNA / "procedencia.json", {"archivos": [{"archivo": "edición.json", "sha256": huella}]}
            )
        if etapa in ("preparar", "validar"):
            carpeta = "preparados" if etapa == "preparar" else "validados"
            guardar_json(area / f"var/actualizacion/{carpeta}/cataluna/conjunto.json", {"fixture": "nueva"})

    @staticmethod
    def exportar(area: Path) -> None:
        """El paquete nuevo cambia un archivo y cita por huella el original nuevo de Cataluña."""
        guardar_json(area / "datos/uno.json", {"dato": 2})
        origenes = {f"{CATALUNA}/edición.json": sha256(area / CATALUNA / "edición.json")}
        manifiesto = {"uno.json": {"sha256": sha256(area / "datos/uno.json"), "origenes": origenes}}
        guardar_json(area / "datos/manifiesto.json", manifiesto)


class PruebaFuenteEnAmbar(unittest.TestCase):
    """Citilab en ámbar con su versión validada, el resto al día: se publica y se puede conservar."""

    def setUp(self) -> None:
        """Instalación sintética completa, publicada una vez y con su generación exportable."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.carpeta = Path(temporal.name).resolve()
        self.raiz = self.carpeta / "candidato"
        preparar(self.raiz)
        origenes = {f"{CATALUNA}/edición.json": sha256(self.raiz / CATALUNA / "edición.json")}
        guardar_json(
            self.raiz / "datos/manifiesto.json",
            {"uno.json": {"sha256": sha256(self.raiz / "datos/uno.json"), "origenes": origenes}},
        )
        generacion.exportar_generacion(self.raiz, self.carpeta / "base", REVISION)
        for parche in (mock.patch.object(actualizar.time, "sleep"), mock.patch.dict(os.environ, {"FARO_AVISO": ""})):
            parche.start()
            self.addCleanup(parche.stop)

    def test_el_paquete_se_publica_y_la_generacion_del_intento_se_conserva(self) -> None:
        """Paquete en verde, candidato validado con Citilab conservado y generación exportable con su versión."""
        citilab_antes = actualizar.huella(self.raiz, (CITILAB, "var/actualizacion/validados/citilab"))
        ejecutor = EjecutorDelDia()
        recibo = candidato.ejecutar_candidato(self.raiz, "actualizar-datos", ejecutor)
        modulos = {modulo["id"]: modulo for modulo in recibo["estado"]["modulos"]}
        descargas = [o for o in ejecutor if len(o) > 3 and POR_LECTOR.get(o[2]) == "citilab" and o[3] == "descargar"]  # noqa: PLR2004
        self.assertEqual(len(descargas), 2)  # el intento y su único reintento, sin más
        self.assertEqual((recibo["resultado"], recibo["veredicto"]), ("validado", "ámbar"))
        self.assertEqual(modulos["paquete"]["veredicto"], "verde")
        self.assertEqual(modulos["citilab"]["veredicto"], "ámbar")
        self.assertEqual([fila["id"] for fila in recibo["conservados"]], ["citilab"])
        self.assertEqual(json.loads((self.raiz / "datos/uno.json").read_bytes()), {"dato": 2})
        # Citilab conserva su versión entera: originales y validados de antes, que la generación traslada tal cual.
        self.assertEqual(actualizar.huella(self.raiz, (CITILAB, "var/actualizacion/validados/citilab")), citilab_antes)
        resumen = generacion.exportar_generacion(self.raiz, self.carpeta / "intento", REVISION)
        manifiesto = json.loads((self.carpeta / "intento/manifiesto.json").read_bytes())
        rutas = {registro["ruta"] for registro in manifiesto["archivos"]}
        self.assertIn(f"{CITILAB}/procedencia.json", rutas)
        self.assertIn(f"{CATALUNA}/edición.json", rutas)
        self.assertEqual(manifiesto["manifiestoPaqueteSha256"], sha256(self.raiz / "datos/manifiesto.json"))
        restaurada = self.carpeta / "restaurada"
        generacion.restaurar_generacion(self.carpeta / "intento", restaurada, REVISION, resumen["sha256Manifiesto"])
        self.assertEqual(json.loads((restaurada / f"{CATALUNA}/edición.json").read_bytes()), {"edicion": "nueva"})


if __name__ == "__main__":
    unittest.main()
