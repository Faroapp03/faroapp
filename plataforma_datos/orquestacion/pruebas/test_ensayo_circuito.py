"""Ensayo del circuito completo de actualización: de la orden hasta el catálogo que lee la web, en varios ciclos.

Cada ronda es un proceso real de actualización (`capturas_controladas/orden.py`) sobre una instalación temporal con su
propia copia del código: cerrojo, área, órdenes reales de los lectores, seguimiento remoto, estado, composición del
catálogo, sustitución de la entrega y panel. Solo se sustituyen las respuestas externas (`red.abrir_peticion`) y las
órdenes de construcción y verificación del producto completo. La web se comprueba con su cargador real
(`cargarCatalogo`).

HP LIFE recorre el circuito entero con tres cursos; FUNDAE y Cibernàrium comprueban que sus órdenes de descarga se
admiten y llegan a consultar, y que el panel procesa sus marcas reales de consulta parcial. Los ciclos se encadenan
como en una instalación real: actualización con cambios, repetición sin cambios, cambio pequeño en una ficha grande,
respuesta parcial, fallo remoto y recomposición local, cierre confirmado, corte del proceso, recuperación al día
siguiente y cambio del código que admite el catálogo.
"""

import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente, sembrar_almacen, trozos_catalogo
from plataforma_datos.cursos.fuentes.hp_life import gratuidad, indice
from plataforma_datos.cursos.pruebas import ayuda_indice_hp as indice_hp
from plataforma_datos.cursos.pruebas import test_cibernarium_paginas_fallidas as cibernarium
from plataforma_datos.cursos.pruebas import test_fundae_fallos_por_unidad as fundae
from plataforma_datos.cursos.pruebas import test_hp_life_fallos_por_unidad as hp
from plataforma_datos.cursos.pruebas.test_abierta import documento as fichas_de_ejemplo
from plataforma_datos.orquestacion import actualizar, comprobaciones_remotas, estado_panel
from plataforma_datos.orquestacion.contrato_comprobaciones_panel import CLAVE_REVISION_PENDIENTE
from plataforma_datos.orquestacion.estado_de_la_actualizacion import leer_estado
from plataforma_datos.orquestacion.pruebas.capturas_controladas import sitecustomize as capturas

CODIGO = Path(__file__).resolve().parents[3]
PYTHON = sys.executable
NODE = shutil.which("node")
TERCERA = "hp-life:433:es"
UNIDADES = {**hp.UNIDADES, TERCERA: ("https://www.life-global.org/es/course/433", 433)}
A, B, C = UNIDADES
URL = {id: url for id, (url, _numero) in UNIDADES.items()}
HTML = "text/html; charset=utf-8"
CURSOS_EN_RONDA = ("hp_life", "fundae", "barcelonactiva")
CRECIMIENTO_MAXIMO_SIN_CAMBIOS = 256 * 1024  # recibos e intentos de una consulta; nunca otra copia de los cuerpos
# Una ficha de 5 MiB (por encima del umbral de trozos) que cambia en una palabra solo añade los trozos que cambian.
FICHA_GRANDE = 5 * 1024 * 1024
CRECIMIENTO_MAXIMO_CAMBIO_PEQUENO = 1024 * 1024
TITULO_A = "Curso renovado 431"
VERSION_DEL_CODIGO = ("plataforma_datos", "config")
RAIZ_SIN_ESTADO = ("__pycache__", "pruebas")
FICHAS_ABIERTA = Path("var/actualizacion/preparados/abierta/fichas.json")
# Las fichas sintéticas se comprueban un día fijo, sin fin publicado: el panel real calcula con cualquier reloj el
# mismo aviso, 91 días después, cuando la primera ficha admitida pasa de 90 días sin revisar.
FICHAS_COMPROBADAS_EL = "2026-10-06"
REVISION_PENDIENTE = "2027-01-05"


def _sha(contenido: bytes) -> str:
    return hashlib.sha256(contenido).hexdigest()


def _texto_grande() -> str:
    """Texto determinista de FICHA_GRANDE bytes, variado para que los cortes por contenido sean reales.

    Returns:
        Palabras al azar con semilla fija.
    """
    azar = random.Random(7)
    palabras = ("formación", "digital", "curso", "datos", "empleo", "competencia", "práctica", "módulo", "ritmo")
    partes, total = [], 0
    while total < FICHA_GRANDE:
        palabra = azar.choice(palabras) + str(azar.randrange(1000))
        partes.append(palabra)
        total += len(palabra.encode()) + 1
    return " ".join(partes)


TEXTO_GRANDE = _texto_grande()


class EnsayoCircuitoCompleto(unittest.TestCase):
    """Una instalación por ensayo; los ciclos se encadenan y cada uno comprueba lo que debe conservar."""

    def setUp(self) -> None:
        """Instala el catálogo admitido de tres cursos HP y lo publica en la web de la instalación."""
        if NODE is None:
            self.skipTest("el ensayo lee la web con Node")
        temporal = tempfile.TemporaryDirectory(prefix="Ensayo circuito Año ")
        self.addCleanup(temporal.cleanup)
        self.trabajo = Path(temporal.name)
        self.raiz = self.trabajo / "Instalación ñ"
        self.capturas = self.trabajo / "capturas"
        self.capturas.mkdir()
        self.temporales = self.trabajo / "temporales"
        self.temporales.mkdir()
        for nombre in VERSION_DEL_CODIGO:
            shutil.copytree(CODIGO / nombre, self.raiz / nombre, ignore=shutil.ignore_patterns(*RAIZ_SIN_ESTADO))
        indicadores = self.raiz / "src/catalogo-cursos"
        indicadores.mkdir(parents=True)
        for nombre in ("indicadores-tema.json", "indicadores-objetivos.json"):
            shutil.copyfile(CODIGO / "src/catalogo-cursos" / nombre, indicadores / nombre)
        (self.raiz / "datos").mkdir()
        # El panel exige las fichas preparadas de formación abierta, presentes en toda instalación: aquí, las sintéticas
        # de las pruebas de su lector, nunca las operativas de quien ejecuta el ensayo.
        fichas = fichas_de_ejemplo()
        for ficha in fichas["fichas"]:
            ficha["comprobado"] = FICHAS_COMPROBADAS_EL
        (self.raiz / FICHAS_ABIERTA).parent.mkdir(parents=True)
        (self.raiz / FICHAS_ABIERTA).write_text(json.dumps(fichas, ensure_ascii=False), encoding="utf-8")
        # El almacén admitido de partida es el de las pruebas de fallos por unidad, con un tercer curso.
        with patch.dict(hp.UNIDADES, {TERCERA: UNIDADES[TERCERA]}):
            caso = hp.FallosPorUnidadHpPruebas("test_url_fallida_conserva_su_confirmacion_y_las_demas_se_confirman")
            caso.setUp()
            try:
                shutil.copytree(caso.raiz / almacen.RUTA, self.raiz / almacen.RUTA)
            finally:
                caso.doCleanups()
        self.ronda = 0
        self.servidas: dict[str, bytes] = {}
        plan = self.plan(dict.fromkeys(UNIDADES, "Published"), version_a=None)
        for orden in actualizar.ordenes_de_la_fuente("hp_life"):
            self.ejecutar_en_la_raiz(orden.orden, plan)
        self.ejecutar_en_la_raiz([PYTHON, "-m", "plataforma_datos.cursos.componer_catalogo"], plan)

    # -- Respuestas externas y procesos -------------------------------------------------------------------------------

    def plan(
        self, respuestas: dict[str, str | int | dict], *, version_a: int | None = 1, cortar_en: str | None = None
    ) -> Path:
        """Escribe el plan de respuestas de una ronda: estado publicado, código HTTP de error o respuesta especial.

        Con `version_a`, la ficha de A es la renovada: otro título y una página de más de 5 MiB que cambia en una
        palabra según la versión. Sin ella, A conserva la ficha de partida.

        Returns:
            Ruta del plan para `FARO_CAPTURAS_CONTROLADAS`.
        """
        self.ronda += 1
        carpeta = self.capturas / f"ronda-{self.ronda}"
        carpeta.mkdir()
        plan: dict[str, object] = {
            "registro": str(carpeta / "consultas.jsonl"),
            "respuestas": {},
            "cortar_en": cortar_en,
        }
        for id, respuesta in respuestas.items():
            numero = UNIDADES[id][1]
            if isinstance(respuesta, dict):
                dato = dict(respuesta)
                if "estado" in dato:
                    cuerpo = carpeta / f"{numero}.html"
                    cuerpo.write_bytes(hp.cuerpo_sintetico(numero))
                    dato.update(cuerpo=str(cuerpo), tipo=HTML)
            elif isinstance(respuesta, int):
                cuerpo = carpeta / f"{numero}-error.html"
                cuerpo.write_bytes(b"<html>Error</html>")
                dato = {"estado": respuesta, "cuerpo": str(cuerpo), "tipo": HTML}
            else:
                negocio = hp.negocio_sintetico(numero)
                negocio["status"] = respuesta
                if id == A and version_a is not None:
                    negocio["name"] = TITULO_A
                contenido = hp.fixtures.recepcion(negocio)[0]
                if id == A and version_a is not None:
                    # El volumen de una ficha real viene de la página (guiones, datos de la aplicación), no del curso.
                    contenido += f"<!-- Versión {version_a}. {TEXTO_GRANDE} -->".encode()
                cuerpo = carpeta / f"{numero}.html"
                cuerpo.write_bytes(contenido)
                self.servidas[_sha(contenido)] = contenido
                dato = {"estado": 200, "cuerpo": str(cuerpo), "tipo": HTML}
            plan["respuestas"][URL[id]] = dato
        self.servir_indice_y_ayuda(carpeta, plan["respuestas"])
        ruta = carpeta / "plan.json"
        ruta.write_text(json.dumps(plan), encoding="utf-8")
        return ruta

    @staticmethod
    def servir_indice_y_ayuda(carpeta: Path, respuestas: dict[str, object]) -> None:
        """Añade al plan el índice público de HP LIFE con los cursos del ensayo y su página de ayuda.

        El índice cuadra con los cursos instalados, de modo que el censo es completo, y la ayuda trae la declaración
        de gratuidad.
        """
        paginas = {indice.url_pagina(n): c for n, c in indice_hp.paginas([n for _u, n in UNIDADES.values()]).items()}
        paginas[gratuidad.URL_AYUDA] = indice_hp.cuerpo_de_ayuda()
        for numero, (url, cuerpo) in enumerate(paginas.items()):
            archivo = carpeta / f"indice-{numero}.html"
            archivo.write_bytes(cuerpo)
            respuestas.setdefault(url, {"estado": 200, "cuerpo": str(archivo), "tipo": HTML})

    def plan_con_b_archivado(self, *, cortar_en: str | None = None) -> Path:
        """Plan de las rondas posteriores al cierre: A y C publicados, B archivado en su ficha.

        Returns:
            Ruta del plan.
        """
        return self.plan({A: "Published", B: "Archived", C: "Published"}, version_a=2, cortar_en=cortar_en)

    def consultas(self) -> list[str]:
        """Devuelve las URL que pidieron los procesos en la última ronda.

        Returns:
            URL en orden de petición.
        """
        registro = self.capturas / f"ronda-{self.ronda}" / "consultas.jsonl"
        if not registro.exists():
            return []
        return [json.loads(linea)["url"] for linea in registro.read_text(encoding="utf-8").splitlines()]

    def entorno(self, plan: Path) -> dict[str, str]:
        """Entorno de los procesos del ensayo: respuestas controladas y guardia de red.

        Returns:
            Variables del proceso con el sustituto del transporte al principio de PYTHONPATH.
        """
        # Un proceso cortado deja su área y su recepción para revisión: que queden dentro del temporal del ensayo.
        return {
            **os.environ,
            "PYTHONPATH": str(Path(capturas.__file__).parent),
            capturas.VARIABLE: str(plan),
            "TMPDIR": str(self.temporales),
        }

    def ejecutar_en_la_raiz(self, orden: list[str], plan: Path) -> None:
        """Instala la versión de partida con las órdenes reales de la fuente, en la propia raíz."""
        hecho = subprocess.run(
            orden, cwd=self.raiz, env=self.entorno(plan), capture_output=True, text=True, check=False
        )
        self.assertEqual(
            hecho.returncode, 0, f"instalación de partida: {' '.join(orden[2:])}\n{hecho.stdout}{hecho.stderr}"
        )

    def actualizar(self, plan: Path, *opciones: str) -> tuple[int, dict]:
        """Lanza una ronda real de actualización como proceso aparte.

        Returns:
            Código de salida y veredicto de cada módulo (vacío si el proceso murió).
        """
        hecho = subprocess.run(
            [
                PYTHON,
                "-m",
                "plataforma_datos.orquestacion.pruebas.capturas_controladas.orden",
                "--raiz",
                str(self.raiz),
                "--plan",
                str(plan),
                *opciones,
            ],
            cwd=CODIGO,
            env=self.entorno(plan),
            capture_output=True,
            text=True,
            check=False,
        )
        self.salida = hecho.stdout + hecho.stderr + self.lo_que_fallo()
        resumen = [linea for linea in hecho.stdout.splitlines() if linea.startswith("RESUMEN ")]
        return hecho.returncode, json.loads(resumen[-1].removeprefix("RESUMEN "))["modulos"] if resumen else {}

    def lo_que_fallo(self) -> str:
        """Extrae del último informe real de la actualización los pasos fallidos, para explicar un fallo.

        Returns:
            Las secciones «Lo que falló» del informe Markdown más reciente, o nada.
        """
        informes = sorted((self.raiz / "var/actualizacion/ejecuciones").glob("*.md"))
        if not informes:
            return ""
        texto = informes[-1].read_text(encoding="utf-8")
        return "".join(
            "\n### Lo que falló" + parte.split("\n## ", 1)[0] for parte in texto.split("### Lo que falló")[1:]
        )

    # -- Lo que se observa --------------------------------------------------------------------------------------------

    def web(self) -> dict[str, dict]:
        """Lee la web publicada con el cargador real del navegador.

        Returns:
            Ofertas vigentes por URL.
        """
        hecho = subprocess.run(
            [
                NODE,
                "--import",
                "./pruebas/ayudas/sin-red.ts",
                "pruebas/ayudas/leer-catalogo-publicado.ts",
                str(self.raiz / "web"),
                str(int(time.time() * 1000)),
            ],
            cwd=CODIGO,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(hecho.returncode, 0, hecho.stderr)
        return {oferta["url"]: oferta for oferta in json.loads(hecho.stdout)["ofertas"]}

    def publicado(self) -> dict[str, str]:
        """Huellas de la entrega publicada (web y almacén del catálogo).

        Returns:
            SHA por ruta relativa.
        """
        return {
            p.relative_to(self.raiz).as_posix(): _sha(p.read_bytes())
            for carpeta in (self.raiz / "web", self.raiz / almacen.RUTA)
            for p in sorted(carpeta.rglob("*"))
            if p.is_file()
        }

    def bytes_conservados(self) -> int:
        """Ocupación de originales, preparados y validados (sin informes de ejecución).

        Returns:
            Bytes en disco.
        """
        datos = self.raiz / "var/actualizacion"
        return sum(
            p.stat().st_size for p in datos.rglob("*") if p.is_file() and not p.is_relative_to(datos / "ejecuciones")
        )

    def cuerpos_conservados(self) -> dict[str, bytes]:
        """Reconstruye byte a byte cada cuerpo HP conservado, entero o por trozos, verificando su huella.

        Returns:
            Bytes por huella declarada en su nombre.
        """
        cuerpos = {}
        for ruta in (self.raiz / "var/actualizacion/originales/hp_life").rglob("*.body"):
            cuerpos[ruta.stem] = trozos_catalogo.leer(ruta, ruta.stem, limite=trozos_catalogo.MAX_CUERPO)
        return cuerpos

    def registro_remoto(self) -> dict:
        """Registro privado de comprobaciones remotas de la instalación.

        Returns:
            El registro validado por su lector real.
        """
        return comprobaciones_remotas.leer_registro(self.raiz)

    def intentos_abiertos(self, fuente: str) -> list[dict]:
        """Intentos técnicos de descarga de la fuente que no llegaron a cerrarse.

        Returns:
            Documentos de intento con fin nulo.
        """
        intentos = self.raiz / "var/actualizacion/ejecuciones/intentos"
        documentos = [json.loads(p.read_bytes()) for p in intentos.glob("*/intento.json")]
        return [d for d in documentos if d["fuente"] == fuente and d["etapa"] == "descargar" and d["fin_utc"] is None]

    def panel(self, raiz: Path | None = None) -> dict[str, dict]:
        """Lee el estado del panel con la pieza real, sobre las marcas que dejó la ronda.

        Returns:
            Seguimiento remoto por fuente.
        """
        with redirect_stdout(StringIO()):
            snapshot = estado_panel.estado_panel(raiz or self.raiz, datetime.now(UTC))
        # El panel ha leído las fichas de la instalación con su lector real.
        self.assertEqual(snapshot[CLAVE_REVISION_PENDIENTE], REVISION_PENDIENTE)
        return {fila["fuente"]: fila for fila in snapshot["seguimientoRemoto"]}

    def comprobar_evidencia(self) -> None:
        """Toda respuesta servida con cuerpo se puede reconstruir byte a byte desde lo conservado."""
        conservados = self.cuerpos_conservados()
        for huella, contenido in self.servidas.items():
            self.assertIn(huella, conservados, "falta una captura servida")
            self.assertEqual(conservados[huella], contenido)

    # -- Los ciclos ---------------------------------------------------------------------------------------------------

    def actualizacion_con_cambios(self) -> dict[str, dict]:
        """1. Un cambio publicado llega hasta la web; solo consta comprobación remota de lo consultado.

        Returns:
            La web tras el ciclo.
        """
        inicio = datetime.now(UTC).isoformat()
        codigo, modulos = self.actualizar(self.plan(dict.fromkeys(UNIDADES, "Published")), "--solo", *CURSOS_EN_RONDA)
        # FUNDAE y Cibernàrium no tienen capturas en este ensayo: su descarga debe admitirse y llegar a consultar,
        # y su fallo de consulta las deja en ámbar, nunca en rojo por una orden rechazada.
        for fuente in ("fundae", "barcelonactiva"):
            self.assertNotEqual(modulos[fuente][0], actualizar.ROJO, f"{fuente}: {modulos[fuente][1]}")
            self.assertTrue(self.registro_remoto()["fuentes"][fuente]["ultimo_intento_remoto_utc"], fuente)
        self.assertNotEqual(codigo, actualizar.CODIGO_ROJO, self.salida)
        self.assertEqual(modulos["hp_life"][0], actualizar.VERDE, modulos["hp_life"][1])
        self.assertEqual(modulos[actualizar.PAQUETE][0], actualizar.VERDE, self.salida)
        # Cibernàrium tiene censo propio: sin identidades suyas en el almacén, también consulta su censo.
        consultas = self.consultas()
        self.assertTrue(any(url.startswith("https://cibernarium.barcelonactiva.cat") for url in consultas))
        self.assertEqual(sorted([url for url in consultas if url in URL.values()][:3]), sorted(URL.values()))
        web = self.web()
        self.assertEqual(web[URL[A]]["titulo"], TITULO_A)
        for id in UNIDADES:
            self.assertGreater(web[URL[id]]["comprobadoEl"], inicio, id)
        self.comprobar_evidencia()
        consultadas = {f for f, fila in self.registro_remoto()["fuentes"].items() if fila["ultimo_intento_remoto_utc"]}
        self.assertEqual(consultadas, set(CURSOS_EN_RONDA))
        return web

    def repeticion_sin_cambios(self, anterior: dict[str, dict]) -> None:
        """2. Las mismas respuestas: ningún cuerpo nuevo, crecimiento acotado y la comprobación no retrocede."""
        antes, cuerpos = self.bytes_conservados(), set(self.cuerpos_conservados())
        codigo, _modulos = self.actualizar(self.plan(dict.fromkeys(UNIDADES, "Published")), "--solo", "hp_life")
        self.assertEqual(codigo, 0, self.salida)
        self.assertEqual(set(self.cuerpos_conservados()), cuerpos)
        self.assertLess(self.bytes_conservados() - antes, CRECIMIENTO_MAXIMO_SIN_CAMBIOS)
        repetida = self.web()
        for id in UNIDADES:
            self.assertGreaterEqual(repetida[URL[id]]["comprobadoEl"], anterior[URL[id]]["comprobadoEl"], id)

    def cambio_pequeno_en_ficha_grande(self) -> dict[str, dict]:
        """2b. Una palabra cambia en la ficha grande: solo se guardan sus trozos nuevos, no otra copia entera.

        Returns:
            La web tras el ciclo.
        """
        antes = self.bytes_conservados()
        codigo, _modulos = self.actualizar(
            self.plan(dict.fromkeys(UNIDADES, "Published"), version_a=2), "--solo", "hp_life"
        )
        self.assertEqual(codigo, 0, self.salida)
        self.assertLess(self.bytes_conservados() - antes, CRECIMIENTO_MAXIMO_CAMBIO_PEQUENO)
        self.comprobar_evidencia()
        return self.web()

    def respuesta_parcial(self, anterior: dict[str, dict]) -> dict[str, dict]:
        """3. Un 503 y un cuerpo cortado no retiran nada ni rejuvenecen su comprobación; el panel lo cuenta.

        Returns:
            La web tras el ciclo.
        """
        codigo, _modulos = self.actualizar(
            self.plan({A: "Published", B: 503, C: {"estado": 200, "cortada": True}}, version_a=2), "--solo", "hp_life"
        )
        self.assertNotEqual(codigo, actualizar.CODIGO_ROJO, self.salida)
        parcial = self.web()
        self.assertEqual(set(parcial), set(URL.values()), "un fallo de consulta no es un cierre")
        for id in (B, C):
            self.assertEqual(parcial[URL[id]]["comprobadoEl"], anterior[URL[id]]["comprobadoEl"], id)
        self.assertGreaterEqual(parcial[URL[A]]["comprobadoEl"], anterior[URL[A]]["comprobadoEl"])
        self.assertEqual(self.registro_remoto()["fuentes"]["hp_life"]["resultado"], "parcial")
        fila = self.panel()["hp_life"]
        self.assertEqual(fila["consultaParcial"], {"unidadesFallidas": 2, "unidadesEsperadas": 3})
        self.comprobar_evidencia()
        return parcial

    def fallo_remoto_y_recomposicion_local(self, anterior: dict[str, dict]) -> None:
        """3b. Ninguna ficha responde: ámbar con reintento. 3c. Recomponer sin descargar no borra ese reintento."""
        sin_respuesta = dict.fromkeys(UNIDADES, {"fallo": "tiempo"})
        _codigo, modulos = self.actualizar(self.plan(sin_respuesta, version_a=2), "--solo", "hp_life")
        self.assertEqual(modulos["hp_life"][0], actualizar.AMBAR, modulos["hp_life"][1])
        self.assertEqual(self.web(), anterior, "un fallo de consulta no retira ni renueva nada")
        estado = leer_estado(self.raiz)["hp_life"]
        self.assertGreater(estado["fallos_seguidos"], 0)
        self.assertIsNotNone(estado["proximo_reintento_utc"])
        fallos = comprobaciones_remotas.fallos_registrados(self.registro_remoto(), "hp_life")
        self.assertGreater(fallos, 0)

        _codigo, modulos = self.actualizar(
            self.plan(dict.fromkeys(UNIDADES, "Published"), version_a=2),
            "--solo",
            "hp_life",
            "--sin-descargar",
            "hp_life",
        )
        self.assertIn("hp_life", modulos, self.salida)
        self.assertEqual(self.consultas(), [], "una recomposición local no consulta la fuente")
        recompuesto = leer_estado(self.raiz)["hp_life"]
        for campo in ("fallos_seguidos", "proximo_reintento_utc"):
            self.assertEqual(recompuesto[campo], estado[campo], f"la recomposición local borró {campo}")
        self.assertEqual(comprobaciones_remotas.fallos_registrados(self.registro_remoto(), "hp_life"), fallos)
        self.assertEqual(self.web(), anterior)

    def cierre_confirmado(self, anterior: dict[str, dict]) -> dict[str, dict]:
        """4. La ficha publicada declara el curso archivado: solo entonces sale de la web.

        Returns:
            La web tras el ciclo.
        """
        codigo, _modulos = self.actualizar(self.plan_con_b_archivado(), "--solo", "hp_life")
        self.assertNotEqual(codigo, actualizar.CODIGO_ROJO, self.salida)
        cierre = self.web()
        self.assertEqual(set(cierre), {URL[A], URL[C]})
        self.assertGreater(cierre[URL[C]]["comprobadoEl"], anterior[URL[C]]["comprobadoEl"])
        self.comprobar_evidencia()
        return cierre

    def corte_del_proceso(self) -> None:
        """5. La máquina se corta a mitad de la consulta: lo publicado sigue entero y el intento queda abierto."""
        entregado = self.publicado()
        codigo, modulos = self.actualizar(self.plan_con_b_archivado(cortar_en=URL[C]), "--solo", "hp_life")
        self.assertLess(codigo, 0, f"el proceso debía morir en el corte\n{self.salida}")
        self.assertEqual(modulos, {})
        self.assertEqual(self.publicado(), entregado)
        self.assertEqual(self.registro_remoto()["fuentes"]["hp_life"]["resultado"], "en-curso")
        self.assertEqual(len(self.intentos_abiertos("hp_life")), 1)

    def recuperacion_al_dia_siguiente(self, anterior: dict[str, dict]) -> dict[str, dict]:
        """6. Los pendientes recogen el intento cortado como fallo y lo reintentan con red.

        Returns:
            La web tras el ciclo.
        """
        codigo, modulos = self.actualizar(self.plan_con_b_archivado(), "--pendientes", "--dias-adelante", "1")
        self.assertIn("hp_life", modulos, f"el corte no contó como intento fallido\n{self.salida}")
        self.assertEqual(modulos["hp_life"][0], actualizar.VERDE, modulos["hp_life"][1])
        self.assertNotEqual(codigo, actualizar.CODIGO_ROJO, self.salida)
        self.assertTrue(self.consultas(), "el reintento debía consultar la fuente")
        recuperada = self.web()
        self.assertEqual(set(recuperada), {URL[A], URL[C]})
        self.assertGreater(recuperada[URL[C]]["comprobadoEl"], anterior[URL[C]]["comprobadoEl"])
        self.assertEqual(self.registro_remoto()["fuentes"]["hp_life"]["resultado"], "comprobada")
        # El intento cortado sigue constando tal cual: nadie le inventa un final ni una respuesta.
        self.assertEqual(len(self.intentos_abiertos("hp_life")), 1)
        self.comprobar_evidencia()
        return recuperada

    def marcas_parciales_de_cibernarium_y_fundae(self) -> None:
        """7. El panel procesa las marcas reales de consulta parcial de Cibernàrium (páginas) y FUNDAE (índices).

        El almacén de este ensayo no tiene identidades de esas fuentes y el producto no admite un conjunto ajeno a su
        almacén. Por eso su consulta parcial se produce con sus lectores reales en las instalaciones de sus propias
        pruebas (página 1 y Digitalízate con 503), y el panel real se lee allí con el registro remoto y el estado
        que dejaron las rondas de este ensayo.
        """
        caso = cibernarium.PaginasFallidasCibernariumPruebas(
            "test_respuesta_503_es_fallo_de_consulta_como_el_transporte"
        )
        caso.setUp()
        try:
            self.assertTrue(caso.consultar_fuente("21:10", {0: "normal", 1: "normal"}))
            self.assertTrue(caso.consultar_fuente("22:00", {0: "normal", 1: 503}))
            panel = self.panel(self.con_registro_del_ensayo(caso.raiz))
        finally:
            caso.doCleanups()
        self.assertEqual(panel["barcelonactiva"]["consultaParcial"], {"unidadesFallidas": 1, "unidadesEsperadas": 2})
        caso = fundae.PendientesFundaePruebas("test_paquete_fallido_el_ciclo_siguiente_evalua_lo_pendiente")
        caso.setUp()
        try:
            caso.ciclo("10:00")
            caso.ciclo("11:00", digitalizate=503)
            admitido = operacion_fuente.leer_validado("fundae", caso.raiz)
            panel = self.panel(self.con_registro_del_ensayo(caso.raiz))
        finally:
            caso.doCleanups()
        self.assertEqual(admitido["consulta_parcial"]["canales_fallidos"], ["digitalizate"])
        esperadas = 1 + len(admitido["cobertura"])
        self.assertEqual(panel["fundae"]["consultaParcial"], {"unidadesFallidas": 1, "unidadesEsperadas": esperadas})

    def cambio_del_codigo_que_admite(self, anterior: dict[str, dict]) -> None:
        """8. Cambia el código que admite el catálogo: la ronda revalida el catálogo instalado y vuelve a componer.

        El cambio es real (una línea de comentario en un archivo de `firma_codigo()`), en la copia del código de la
        instalación, que es la que ejecutan las órdenes en el área.
        """
        archivo = self.raiz / "plataforma_datos/cursos/catalogo.py"
        archivo.write_text(
            archivo.read_text(encoding="utf-8") + "# Revisión del ensayo del circuito.\n", encoding="utf-8"
        )
        codigo, modulos = self.actualizar(self.plan_con_b_archivado(), "--solo", "hp_life")
        self.assertEqual(modulos["hp_life"][0], actualizar.VERDE, f"{modulos['hp_life'][1]}\n{self.salida}")
        self.assertEqual(modulos[actualizar.PAQUETE][0], actualizar.VERDE, self.salida)
        self.assertNotEqual(codigo, actualizar.CODIGO_ROJO, self.salida)
        web = self.web()
        self.assertEqual(set(web), {URL[A], URL[C]})
        self.assertGreater(web[URL[C]]["comprobadoEl"], anterior[URL[C]]["comprobadoEl"])

    def con_registro_del_ensayo(self, destino: Path) -> Path:
        """Lleva a otra instalación de prueba el registro remoto, el estado y las fichas de esta.

        Returns:
            La instalación de destino.
        """
        for relativa in (
            Path("var/actualizacion/ejecuciones/comprobaciones.json"),
            Path("var/actualizacion/ejecuciones/estado.json"),
            FICHAS_ABIERTA,
        ):
            (destino / relativa).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(self.raiz / relativa, destino / relativa)
        return destino

    def test_circuito_en_ciclos_con_parcial_cierre_y_corte(self) -> None:
        """Cada ciclo deja la web, el registro y la evidencia que le corresponden, y solo eso."""
        self.assertEqual(set(self.web()), set(URL.values()))
        web = self.actualizacion_con_cambios()
        self.repeticion_sin_cambios(web)
        web = self.cambio_pequeno_en_ficha_grande()
        web = self.respuesta_parcial(web)
        self.fallo_remoto_y_recomposicion_local(web)
        web = self.cierre_confirmado(web)
        self.corte_del_proceso()
        web = self.recuperacion_al_dia_siguiente(web)
        self.marcas_parciales_de_cibernarium_y_fundae()
        self.cambio_del_codigo_que_admite(web)

    def almacen_que_no_sirve(self, codigo: str) -> None:
        """Un ciclo real con el almacén en ese estado: paso en rojo, paquete sin publicar, `web/` intacta y código."""
        web = {
            p.relative_to(self.raiz).as_posix(): _sha(p.read_bytes())
            for p in (self.raiz / "web").rglob("*")
            if p.is_file()
        }
        codigo_de_salida, modulos = self.actualizar(
            self.plan(dict.fromkeys(UNIDADES, "Published")), "--solo", "hp_life"
        )
        self.assertEqual(codigo_de_salida, actualizar.CODIGO_AMBAR, self.salida)
        veredicto, motivo, publicado = modulos[actualizar.PAQUETE]
        self.assertNotEqual(veredicto, actualizar.VERDE, self.salida)
        self.assertFalse(publicado, self.salida)
        self.assertIn(f"Componer el catálogo admitido de Cursos en rojo (código 1): {codigo}", motivo)
        self.assertEqual(
            {
                p.relative_to(self.raiz).as_posix(): _sha(p.read_bytes())
                for p in (self.raiz / "web").rglob("*")
                if p.is_file()
            },
            web,
            "un paquete cuyo almacén no sirve no publica nada",
        )
        with redirect_stdout(StringIO()):
            snapshot = estado_panel.estado_panel(self.raiz, datetime.now(UTC))
        fila = next(f for f in snapshot["modulos"] if f["id"] == actualizar.PAQUETE)
        self.assertEqual(fila["motivoAlmacen"], codigo)

    def test_almacen_retirado_deja_el_paquete_sin_publicar_y_lo_dice_el_panel(self) -> None:
        """Sin almacén de Cursos, la composición falla y el panel recibe «almacen-ausente»."""
        shutil.move(self.raiz / almacen.RUTA, self.trabajo / "almacen-retirado")
        self.almacen_que_no_sirve("almacen-ausente")
        self.assertFalse((self.raiz / almacen.RUTA).exists())

    def test_almacen_ilegible_deja_el_paquete_sin_publicar_y_lo_dice_el_panel(self) -> None:
        """Con el control del almacén dañado, la composición falla y el panel recibe «almacen-ilegible»."""
        (self.raiz / almacen.RUTA / almacen.CONTROL).write_text("{", encoding="utf-8")
        self.almacen_que_no_sirve("almacen-ilegible")

    def test_almacen_sembrado_sin_altas_deja_el_paquete_sin_publicar_y_lo_dice_el_panel(self) -> None:
        """Sembrado y sin altas (HP LIFE no se aplica sin identidades), el panel recibe «almacen-vacio»."""
        shutil.move(self.raiz / almacen.RUTA, self.trabajo / "almacen-retirado")
        sembrar_almacen.sembrar(self.raiz)
        self.almacen_que_no_sirve("almacen-vacio")


if __name__ == "__main__":
    unittest.main()
