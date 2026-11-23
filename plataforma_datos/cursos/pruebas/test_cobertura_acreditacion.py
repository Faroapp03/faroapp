"""Consulta exacta del corpus BOE/INE, con SOC local y revisión manual fuera de la recepción remota."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import plataforma_datos.cursos.fuentes.acreditacion.cobertura as cobertura
import plataforma_datos.cursos.fuentes.acreditacion.piezas.descarga as descarga
from plataforma_datos.comun import boe
from plataforma_datos.comun.observacion_remota import identidad_recurso
from plataforma_datos.cursos.fuentes.acreditacion.piezas.constantes import Pagina

INSTANTE = "2026-10-17T08:00:30Z"
INDICE = b"""<p>Referencias anteriores</p>
<p>los apartados III y IV de los anexos del Real Decreto 645/2011, de 9 de mayo (Ref. BOE-A-2011-9930)</p>
<p>los apartados III y IV de los anexos del Real Decreto 1379/2008, de 1 de agosto (Ref. BOE-A-2008-15378)</p>
<p>Materias</p>"""
ANEXO = "<p>Código: ADGD0308</p><p>Ocupaciones o puestos de trabajo relacionados</p><p>Administración</p>".encode()
PDF = "https://www.boe.es/eli/es/rd/2008/08/01/1379/dof/spa/pdf"


class PruebaCoberturaAcreditacion(unittest.TestCase):
    """El productor se simula sin red; omisiones y alteraciones nunca reciben cobertura del corpus."""

    def setUp(self) -> None:
        """Crea la copia local SOC y los recursos del mismo recorrido que ejecuta la descarga."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.carpeta = self.raiz / "var/actualizacion/originales/acreditacion"
        self.carpeta.mkdir(parents=True)
        self.soc = self.raiz / "var/actualizacion/originales/formacion"
        self.soc.mkdir()
        filas = [{"codiespecialitat": "ADGD0308", "certprof": "RD 645/2011"}]
        contenido = json.dumps(filas).encode()
        (self.soc / cobertura.ARCHIVO_SOC).write_bytes(contenido)
        self.procedencia_soc = {
            "archivos": [
                {
                    "archivo": cobertura.ARCHIVO_SOC,
                    "sha256": hashlib.sha256(contenido).hexdigest(),
                    "tamano_bytes": len(contenido),
                }
            ]
        }
        self.procedencia: dict = {"archivos": [], "robots": {}}
        self.evidencia = {
            "version": 2,
            "fuente": "acreditacion",
            "intento": "corpus-declarado",
            "comienzo_utc": "2026-10-17T08:00:00Z",
            "fin_utc": "2026-10-17T08:01:00Z",
            "peticiones": [],
        }
        self.agregar(descarga.pagina_del_indice(), INDICE)
        indice = boe.referencias_anteriores(INDICE)
        self.assertEqual(set(indice), {"645/2011", "1379/2008"})
        for pagina in descarga.paginas_consolidadas(indice, descarga.certificados_del_soc(filas)):
            cuerpo = f'<link resource="{PDF}">'.encode() if "2008-1379" in pagina.archivo else ANEXO
            final = pagina.url.replace("/act.php?", "/doc.php?") if "2008-1379" in pagina.archivo else pagina.url
            self.agregar(pagina, cuerpo, final)
        self.agregar(Pagina("boe-rd-2008-1379.pdf", PDF, "PDF original"), b"PDF de prueba")
        for pagina in descarga.complementarias():
            self.agregar(pagina, pagina.archivo.encode())
        for host in ("www.boe.es", "www.ine.es"):
            url = f"https://{host}/robots.txt"
            cuerpo = b"User-agent: *\nAllow: /\n"
            self.procedencia["robots"][host] = {
                "url": url,
                "sha256": hashlib.sha256(cuerpo).hexdigest(),
                "consultado_utc": INSTANTE,
            }
            self.evidencia["peticiones"].append(self.peticion(url, cuerpo, url, vinculado=False))
        self.guardar()

    def peticion(self, url: str, cuerpo: bytes, final: str, *, vinculado: bool = True) -> dict:
        """Representa una recepción v2 sin abrir ninguna conexión.

        Returns:
            Recibo con método GET sin cuerpo y vínculo opcional al original.
        """
        huella = hashlib.sha256(cuerpo).hexdigest()
        return {
            "recurso_sha256": identidad_recurso(url),
            "url_final_sha256": hashlib.sha256(final.encode()).hexdigest(),
            "respuesta_sha256": huella,
            "bytes": len(cuerpo),
            "completado_utc": INSTANTE,
            "original_sha256": huella if vinculado else None,
            "original_bytes": len(cuerpo) if vinculado else None,
        }

    def agregar(self, pagina: Pagina, cuerpo: bytes, final: str | None = None) -> None:
        """Conserva un recurso y sus dos descripciones independientes: procedencia y recepción."""
        final = pagina.url if final is None else final
        (self.carpeta / pagina.archivo).write_bytes(cuerpo)
        self.procedencia["archivos"].append(
            {
                "archivo": pagina.archivo,
                "url": pagina.url,
                "url_final": final,
                "sha256": hashlib.sha256(cuerpo).hexdigest(),
                "bytes": len(cuerpo),
            }
        )
        self.evidencia["peticiones"].append(self.peticion(pagina.url, cuerpo, final))

    def guardar(self) -> None:
        """Guarda solamente los manifiestos de la prueba aislada."""
        for carpeta, documento in ((self.carpeta, self.procedencia), (self.soc, self.procedencia_soc)):
            (carpeta / "procedencia.json").write_text(json.dumps(documento), encoding="utf-8")

    def test_corpus_completo_sin_promover_soc_ni_paginas_manuales(self) -> None:
        """42 originales y dos robots prueban el corpus finito; no requieren recibos del SOC ni Gencat."""
        previo = (self.carpeta / "procedencia.json").read_bytes()
        self.assertEqual(len(self.procedencia["archivos"]), 42)
        self.assertEqual(len(self.evidencia["peticiones"]), 44)
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))
        self.assertEqual((self.carpeta / "procedencia.json").read_bytes(), previo)

    def test_cada_peticion_exacta_es_necesaria(self) -> None:
        """Ausencias, duplicados, método, cuerpo y originales sin vínculo invalidan cualquier recurso."""
        for indice in range(len(self.evidencia["peticiones"])):
            for cambio in ("ausente", "duplicada", "metodo", "cuerpo", "respuesta", "vinculo", "final"):
                caso = copy.deepcopy(self.evidencia)
                peticion = caso["peticiones"][indice]
                if cambio == "ausente":
                    caso["peticiones"].pop(indice)
                elif cambio == "duplicada":
                    caso["peticiones"].append(copy.deepcopy(peticion))
                elif cambio in ("metodo", "cuerpo"):
                    registros = self.procedencia["archivos"]
                    url = (
                        registros[indice]["url"]
                        if indice < len(registros)
                        else list(self.procedencia["robots"].values())[indice - len(registros)]["url"]
                    )
                    peticion["recurso_sha256"] = (
                        identidad_recurso(url, "POST") if cambio == "metodo" else identidad_recurso(url, cuerpo=b"")
                    )
                elif cambio == "vinculo":
                    peticion["original_sha256"] = None if peticion["original_sha256"] else "0" * 64
                    peticion["original_bytes"] = None if peticion["original_sha256"] is None else peticion["bytes"]
                else:
                    clave = {"respuesta": "respuesta_sha256", "final": "url_final_sha256"}[cambio]
                    peticion[clave] = "0" * 64
                with self.subTest(indice=indice, cambio=cambio):
                    self.assertFalse(cobertura.comprobada(self.raiz, caso))

    def test_manifiesto_no_puede_omitir_ni_agregar_recursos(self) -> None:
        """La lista declarada se reconstruye desde el índice y HTML, no desde el manifiesto recibido."""
        original = copy.deepcopy(self.procedencia)
        for cambio in ("ausente", "extra", "duplicado", "pdf_extra", "robots_extra"):
            self.procedencia = copy.deepcopy(original)
            registros = self.procedencia["archivos"]
            if cambio == "ausente":
                registros.pop()
            elif cambio == "robots_extra":
                self.procedencia["robots"]["ajeno.example"] = {}
            else:
                registro = copy.deepcopy(registros[0])
                if cambio != "duplicado":
                    registro["archivo"] = "boe-rd-2011-645.pdf" if cambio == "pdf_extra" else "extra.html"
                registros.append(registro)
            self.guardar()
            with self.subTest(cambio=cambio):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_el_indice_vinculado_amplia_el_corpus_exigido(self) -> None:
        """Un decreto añadido al índice remoto se exige aunque no constara en el manifiesto anterior."""
        ampliado = INDICE.replace(
            b"<p>Materias</p>",
            b"<p>los anexos del Real Decreto 646/2011, de 9 de mayo (Ref. BOE-A-2011-9931)</p><p>Materias</p>",
        )
        registro = self.procedencia["archivos"][0]
        registro["sha256"] = hashlib.sha256(ampliado).hexdigest()
        registro["bytes"] = len(ampliado)
        (self.carpeta / registro["archivo"]).write_bytes(ampliado)
        self.evidencia["peticiones"][0] = self.peticion(registro["url"], ampliado, registro["url_final"])
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.agregar(
            Pagina("boe-rd-2011-646.html", "https://www.boe.es/buscar/act.php?id=BOE-A-2011-9931", "RD 646/2011"),
            ANEXO,
        )
        self.guardar()
        self.assertTrue(cobertura.comprobada(self.raiz, self.evidencia))

    def test_originales_y_catalogo_soc_deben_seguir_integros(self) -> None:
        """La copia SOC determina el plan pero solo recibe control local de integridad."""
        rutas = [self.carpeta / r["archivo"] for r in self.procedencia["archivos"]]
        rutas.append(self.soc / cobertura.ARCHIVO_SOC)
        for ruta in rutas:
            previo = ruta.read_bytes()
            ruta.write_bytes(previo + b" ")
            with self.subTest(archivo=ruta.name):
                self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
            ruta.write_bytes(previo)

    def test_soc_sin_procedencia_o_con_enlace_no_acredita_el_plan(self) -> None:
        """Una entrada local ausente, ambigua o enlazada impide derivar el corpus remoto con confianza."""
        (self.soc / "procedencia.json").unlink()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.procedencia_soc["archivos"] *= 2
        self.guardar()
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))
        self.procedencia_soc["archivos"].pop()
        self.guardar()
        ruta = self.soc / cobertura.ARCHIVO_SOC
        copia = self.soc / "copia.json"
        ruta.rename(copia)
        ruta.symlink_to(copia)
        self.assertFalse(cobertura.comprobada(self.raiz, self.evidencia))

    def test_recepcion_antigua_ajena_o_invalida_no_acredita(self) -> None:
        """El contrato de entrada se valida antes de interpretar la recepción."""
        for cambios in ({"version": 1}, {"version": True}, {"fuente": "derechos"}, {"peticiones": []}):
            with self.subTest(cambios=cambios):
                self.assertFalse(cobertura.comprobada(self.raiz, {**self.evidencia, **cambios}))


if __name__ == "__main__":
    unittest.main()
