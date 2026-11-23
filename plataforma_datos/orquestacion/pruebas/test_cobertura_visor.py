"""La consulta del visor acredita el corte admitido, sin convertir el Censo local en una descarga."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import plataforma_datos.mercado.fuentes.cataluna.lector as cataluna
import plataforma_datos.mercado.fuentes.observatori.lector as observatori
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.mercado.fuentes.cataluna.piezas.captura_cataluna import CENSOS_FIJOS
from plataforma_datos.orquestacion import cobertura_visor as cobertura


class PruebaCoberturaVisor(unittest.TestCase):
    """Recibos sintéticos para aislar inventarios y vínculos; el productor prueba el transporte real."""

    def setUp(self) -> None:
        """Conserva cuerpos mínimos: la validación estadística precede a esta comprobación de cobertura."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.procedencias: dict[str, dict] = {}
        self.recibos: dict[str, dict] = {}
        for fuente, modulo in (("cataluna", cataluna), ("observatori", observatori)):
            carpeta = self.carpeta(fuente)
            carpeta.mkdir(parents=True)
            self.procedencias[fuente] = {"archivos": []}
            self.recibos[fuente] = {
                "version": 2,
                "fuente": fuente,
                "intento": "consulta-visor",
                "comienzo_utc": "2026-10-17T08:00:00Z",
                "fin_utc": "2026-10-17T08:01:00Z",
                "peticiones": [],
            }
            for archivo in modulo.archivos("2026-06"):
                cuerpo = json.dumps({"archivo": archivo["archivo"]}).encode()
                huella = hashlib.sha256(cuerpo).hexdigest()
                (carpeta / archivo["archivo"]).write_bytes(cuerpo)
                self.procedencias[fuente]["archivos"].append(
                    {**archivo, "url_final": archivo["url"], "sha256": huella, "bytes": len(cuerpo)}
                )
                self.recibos[fuente]["peticiones"].append(
                    {
                        "recurso_sha256": identidad_recurso(archivo["url"]),
                        "url_final_sha256": hashlib.sha256(archivo["url"].encode()).hexdigest(),
                        "respuesta_sha256": huella,
                        "original_sha256": huella,
                        "bytes": len(cuerpo),
                        "original_bytes": len(cuerpo),
                        "completado_utc": "2026-10-17T08:00:30Z",
                    }
                )
        for nombre in CENSOS_FIJOS:
            cuerpo = nombre.encode()
            (self.carpeta("cataluna") / nombre).write_bytes(cuerpo)
            self.procedencias["cataluna"]["archivos"].append(
                {"archivo": nombre, "sha256": hashlib.sha256(cuerpo).hexdigest(), "tamano_bytes": len(cuerpo)}
            )
        self.guardar()

    def carpeta(self, fuente: str) -> Path:
        """Localiza los originales propios de la prueba.

        Returns:
            Directorio aislado de la fuente.
        """
        return self.raiz / "var/actualizacion/originales" / fuente

    def guardar(self) -> None:
        """Guarda los manifiestos propios, sin escribir los originales de la instalación."""
        for fuente, documento in self.procedencias.items():
            (self.carpeta(fuente) / "procedencia.json").write_text(json.dumps(documento), encoding="utf-8")

    def test_solo_consultas_actuales_y_censos_locales_intactos(self) -> None:
        """Tres y seis respuestas cubren el visor; los cuatro censos no requieren recibos de red."""
        for fuente, numero in (("cataluna", 3), ("observatori", 6)):
            with self.subTest(fuente=fuente):
                previo = (self.carpeta(fuente) / "procedencia.json").read_bytes()
                self.assertEqual(len(self.recibos[fuente]["peticiones"]), numero)
                self.assertTrue(cobertura.comprobada(self.raiz, self.recibos[fuente]))
                self.assertEqual((self.carpeta(fuente) / "procedencia.json").read_bytes(), previo)

    def test_consultas_incompletas_duplicadas_ajenas_o_sin_vinculo(self) -> None:
        """Ninguna respuesta, método ni cuerpo se sustituye por el éxito de las otras consultas."""
        for fuente, recibo in self.recibos.items():
            for indice in range(len(recibo["peticiones"])):
                for cambio in ("ausente", "duplicada", "extra", "metodo", "cuerpo", "sin_vinculo", "version"):
                    caso = copy.deepcopy(recibo)
                    peticion = caso["peticiones"][indice]
                    if cambio == "ausente":
                        caso["peticiones"].pop(indice)
                    elif cambio == "duplicada":
                        caso["peticiones"][indice] = caso["peticiones"][(indice + 1) % len(caso["peticiones"])]
                    elif cambio == "extra":
                        caso["peticiones"].append(copy.deepcopy(peticion))
                    elif cambio in ("metodo", "cuerpo"):
                        url = self.procedencias[fuente]["archivos"][indice]["url"]
                        peticion["recurso_sha256"] = (
                            identidad_recurso(url, "POST") if cambio == "metodo" else identidad_recurso(url, cuerpo=b"")
                        )
                    elif cambio == "sin_vinculo":
                        peticion["original_sha256"] = None
                    else:
                        caso["version"] = 1
                    with self.subTest(fuente=fuente, indice=indice, cambio=cambio):
                        self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_cada_original_debe_coincidir_con_el_recibo(self) -> None:
        """Tampoco acredita una copia alterada después de recibir la respuesta."""
        for fuente, documento in self.procedencias.items():
            for registro in documento["archivos"]:
                ruta = self.carpeta(fuente) / registro["archivo"]
                previo = ruta.read_bytes()
                ruta.write_bytes(previo + b" ")
                with self.subTest(fuente=fuente, archivo=registro["archivo"]):
                    self.assertFalse(cobertura.comprobada(self.raiz, self.recibos[fuente]))
                    if registro["archivo"] in CENSOS_FIJOS:
                        self.assertFalse(cobertura.comprobada(self.raiz, self.recibos["observatori"]))
                ruta.write_bytes(previo)

    def test_no_admite_otros_periodos_ni_manifiesto_ambiguo(self) -> None:
        """Un archivo de otro corte, adicional o con nombre repetido impide declarar la cobertura."""
        previas = copy.deepcopy(self.procedencias)
        for fuente in self.procedencias:
            for cambio in ("periodo", "duplicado", "extra"):
                self.procedencias = copy.deepcopy(previas)
                registros = self.procedencias[fuente]["archivos"]
                if cambio == "periodo":
                    registros[0]["archivo"] = registros[0]["archivo"].replace("2026-06", "2026-09")
                else:
                    registro = copy.deepcopy(registros[0])
                    if cambio == "extra":
                        registro["archivo"] = "ajeno.json"
                    registros.append(registro)
                self.guardar()
                with self.subTest(fuente=fuente, cambio=cambio):
                    self.assertFalse(cobertura.comprobada(self.raiz, self.recibos[fuente]))


if __name__ == "__main__":
    unittest.main()
