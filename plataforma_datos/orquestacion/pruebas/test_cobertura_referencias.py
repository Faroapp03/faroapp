"""Inventario y vínculo exacto de referencias fijas, sin inferir vigencia del estándar."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import plataforma_datos.comun.fuentes.territorios.lector as territorios
import plataforma_datos.ocupaciones.fuentes.oit.piezas.constantes_oit as constantes_oit
from plataforma_datos.comun.observacion_remota import identidad_recurso, validar_recepcion
from plataforma_datos.orquestacion import cobertura_referencias as cobertura

INSTANTE = "2026-10-17T08:00:00Z"


def sha(contenido: bytes) -> str:
    """Devuelve la huella de un cuerpo completo.

    Returns:
        SHA-256 hexadecimal.
    """
    return hashlib.sha256(contenido).hexdigest()


class PruebaCoberturaReferencias(unittest.TestCase):
    """Cada referencia requiere exactamente todos sus recursos y ninguna consulta ajena."""

    def crear(self, fuente: str) -> None:
        """Prepara cuerpos y recibo v2 sintéticos; no abre originales operativos ni la red."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        nombre, archivos = cobertura.CONTRATOS[fuente]
        self.carpeta = self.raiz / "var/actualizacion/originales" / nombre
        self.carpeta.mkdir(parents=True)
        self.procedencia = {"archivos": []}
        self.evidencia = {
            "version": 2,
            "fuente": fuente,
            "intento": "referencias",
            "comienzo_utc": INSTANTE,
            "fin_utc": INSTANTE,
            "peticiones": [],
        }
        for indice, archivo in enumerate(archivos):
            contenido = f"original {indice}".encode()
            if fuente == "territorios" and archivo["archivo"] == territorios.CODIGOS:
                contenido = json.dumps({"supplemental": {"version": {"_cldrVersion": "48"}}}).encode()
            url = archivo["url"]
            final = url.replace("www.ilo.org", "webapps.ilo.org", 1) if url in cobertura.URLS_FINALES else url
            (self.carpeta / archivo["archivo"]).write_bytes(contenido)
            self.procedencia["archivos"].append(
                {
                    "archivo": archivo["archivo"],
                    "url": url,
                    "url_final": final,
                    "bytes": len(contenido),
                    "sha256": sha(contenido),
                    "descargado_utc": "2020-01-01T00:00:00Z",
                }
            )
            self.evidencia["peticiones"].append(
                {
                    "recurso_sha256": identidad_recurso(url),
                    "url_final_sha256": sha(final.encode()),
                    "respuesta_sha256": sha(contenido),
                    "bytes": len(contenido),
                    "original_sha256": sha(contenido),
                    "original_bytes": len(contenido),
                    "completado_utc": INSTANTE,
                }
            )
        self.guardar()
        validar_recepcion(self.evidencia, fuente, "referencias")

    def guardar(self) -> None:
        """Guarda solo la procedencia temporal de este caso."""
        (self.carpeta / "procedencia.json").write_text(json.dumps(self.procedencia), encoding="utf-8")

    def test_cinco_inventarios_completos_sin_reescribir_fechas(self) -> None:
        """Una consulta íntegra de la referencia conocida no declara que sea la última edición."""
        self.assertEqual(
            {fuente: len(contrato[1]) for fuente, contrato in cobertura.CONTRATOS.items()},
            {"clasificaciones": 3, "idescat": 3, "territorios": 4, "decada_digital": 1, "oit": 4},
        )
        for fuente in cobertura.CONTRATOS:
            with self.subTest(fuente=fuente):
                self.crear(fuente)
                antes = {ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}
                self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
                self.assertEqual({ruta.name: ruta.read_bytes() for ruta in self.carpeta.iterdir()}, antes)

    def test_cada_recurso_necesita_peticion_y_vinculo_integros(self) -> None:
        """La omisión de cualquier recurso o cualquier huella discordante impide acreditar el conjunto."""
        for fuente in cobertura.CONTRATOS:
            self.crear(fuente)
            for indice in range(len(self.evidencia["peticiones"])):
                for campo in (None, "recurso_sha256", "url_final_sha256", "respuesta_sha256", "original_sha256"):
                    archivo = cobertura.CONTRATOS[fuente][1][indice]["archivo"]
                    if fuente == "oit" and archivo == constantes_oit.DOCUMENTO and campo == "respuesta_sha256":
                        # El productor vincula WP140 después de comprobar su equivalencia documentaria.
                        continue
                    caso = copy.deepcopy(self.evidencia)
                    if campo is None:
                        caso["peticiones"].pop(indice)
                    else:
                        caso["peticiones"][indice][campo] = "0" * 64
                    with self.subTest(fuente=fuente, indice=indice, campo=campo):
                        self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_recibo_exacto_sin_extras_duplicados_post_o_version_antigua(self) -> None:
        """La mera presencia de alguna petición no prueba la descarga de toda la referencia."""
        for fuente in cobertura.CONTRATOS:
            self.crear(fuente)
            for variante in ("duplicado", "reemplazo", "extra", "post", "v1", "booleano", "sin-vinculo", "tamano"):
                caso = copy.deepcopy(self.evidencia)
                peticion = caso["peticiones"][0]
                if variante == "duplicado":
                    caso["peticiones"] = [peticion] * len(caso["peticiones"]) + [peticion]
                elif variante == "reemplazo":
                    if len(caso["peticiones"]) == 1:
                        continue
                    caso["peticiones"][-1] = peticion
                elif variante == "extra":
                    caso["peticiones"].append(
                        {**peticion, "recurso_sha256": identidad_recurso("https://ajeno.example/")}
                    )
                elif variante == "post":
                    url = cobertura.CONTRATOS[fuente][1][0]["url"]
                    peticion["recurso_sha256"] = identidad_recurso(url, "POST")
                elif variante in ("v1", "booleano"):
                    caso["version"] = 1 if variante == "v1" else True
                elif variante == "sin-vinculo":
                    peticion.update(original_sha256=None, original_bytes=None)
                else:
                    peticion["original_bytes"] = True
                with self.subTest(fuente=fuente, variante=variante):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_procedencia_exacta(self) -> None:
        """Un inventario parcial, repetido o ajeno no se acepta aunque sus archivos existan."""
        for fuente in cobertura.CONTRATOS:
            self.crear(fuente)
            base = copy.deepcopy(self.procedencia)
            for variante in ("ausente", "extra", "duplicado", "ruta", "url", "bytes"):
                self.procedencia = copy.deepcopy(base)
                registros = self.procedencia["archivos"]
                if variante == "ausente":
                    registros.pop()
                elif variante == "extra":
                    registros.append({**registros[0], "archivo": "ajeno"})
                elif variante == "duplicado":
                    registros.append(registros[0])
                elif variante == "ruta":
                    registros[0]["archivo"] = "../ajeno"
                elif variante == "url":
                    registros[0]["url"] += "?otra"
                else:
                    registros[0]["bytes"] += 1
                self.guardar()
                with self.subTest(fuente=fuente, variante=variante):
                    self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_originales_ausentes_truncados_o_enlazados(self) -> None:
        """Se leen cuerpos completos regulares de un solo enlace, sin seguir symlinks."""
        for fuente in cobertura.CONTRATOS:
            self.crear(fuente)
            for registro in self.procedencia["archivos"]:
                ruta = self.carpeta / registro["archivo"]
                contenido = ruta.read_bytes()
                for variante in ("ausente", "truncado", "enlace"):
                    ruta.unlink()
                    if variante == "truncado":
                        ruta.write_bytes(contenido[:-1])
                    elif variante == "enlace":
                        destino = self.raiz / "cuerpo"
                        destino.write_bytes(contenido)
                        ruta.symlink_to(destino)
                    with self.subTest(fuente=fuente, archivo=ruta.name, variante=variante):
                        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
                    ruta.unlink(missing_ok=True)
                    ruta.write_bytes(contenido)

    def test_redirecciones_solo_las_oficiales_identificadas(self) -> None:
        """Ni siquiera un recibo coherente permite una dirección final ajena."""
        for fuente in cobertura.CONTRATOS:
            self.crear(fuente)
            for indice, registro in enumerate(self.procedencia["archivos"]):
                final = registro["url_final"]
                registro["url_final"] = "https://ajeno.example/recurso"
                self.evidencia["peticiones"][indice]["url_final_sha256"] = sha(registro["url_final"].encode())
                self.guardar()
                with self.subTest(fuente=fuente, indice=indice):
                    self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
                registro["url_final"] = final
                self.evidencia["peticiones"][indice]["url_final_sha256"] = sha(final.encode())
            self.guardar()
        self.crear("clasificaciones")
        for indice, registro in enumerate(self.procedencia["archivos"]):
            if registro["url"] == cobertura.URL_CIUO_ES:
                registro["url_final"] = registro["url"]
                self.evidencia["peticiones"][indice]["url_final_sha256"] = sha(registro["url"].encode())
        self.guardar()
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))

    def test_cldr_sucesor_no_acredita_la_version_admitida(self) -> None:
        """Cuerpos y recibos coherentes con otra versión no satisfacen el contrato CLDR 48."""
        self.crear("territorios")
        for indice, registro in enumerate(self.procedencia["archivos"]):
            if registro["archivo"] == territorios.CODIGOS:
                contenido = b'{"supplemental":{"version":{"_cldrVersion":"49"}}}'
                (self.carpeta / registro["archivo"]).write_bytes(contenido)
                registro.update(bytes=len(contenido), sha256=sha(contenido))
                self.evidencia["peticiones"][indice].update(
                    bytes=len(contenido),
                    original_bytes=len(contenido),
                    respuesta_sha256=sha(contenido),
                    original_sha256=sha(contenido),
                )
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_solo_wp140_admite_cuerpo_http_distinto_del_original(self) -> None:
        """La equivalencia vinculada del WP140 no se extiende a tablas ni a la política histórica."""
        self.crear("oit")
        for indice, archivo in enumerate(constantes_oit.ARCHIVOS):
            caso = copy.deepcopy(self.evidencia)
            caso["peticiones"][indice].update(respuesta_sha256=sha(b"respuesta distinta"), bytes=1234)
            validar_recepcion(caso, "oit", "referencias")
            with self.subTest(archivo=archivo["archivo"]):
                self.assertEqual(cobertura.comprobada(self.raiz, caso), archivo["archivo"] == constantes_oit.DOCUMENTO)

    def test_redireccion_inglesa_admite_solo_el_mismo_recurso_oficial(self) -> None:
        """La estructura inglesa permite www o webapps; nunca otra ruta dentro de esos hosts."""
        self.crear("oit")
        for indice, registro in enumerate(self.procedencia["archivos"]):
            if registro["url"] != cobertura.URL_ISCO_EN:
                continue
            for final, admitida in (
                (registro["url"], True),
                (registro["url"].replace("www.ilo.org", "webapps.ilo.org", 1), True),
                (registro["url"].replace("www.ilo.org", "webapps.ilo.org", 1) + "?otro", False),
            ):
                registro["url_final"] = final
                self.evidencia["peticiones"][indice]["url_final_sha256"] = sha(final.encode())
                self.guardar()
                with self.subTest(final=final):
                    self.assertEqual(cobertura.comprobada(self.raiz, self.evidencia), admitida)


if __name__ == "__main__":
    unittest.main()
