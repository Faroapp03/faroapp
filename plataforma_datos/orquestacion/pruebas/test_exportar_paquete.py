"""Exportación en destinos aislados: nominales, huellas, opcionales y recuperación ante errores del disco."""

import io
import json
import tempfile
import unittest
import zipfile
from datetime import datetime
from pathlib import Path
from unittest import mock

import plataforma_datos.ia_y_trabajo.fuentes.tic_llars.lector as tic_llars
import plataforma_datos.ocupaciones.fuentes.esco.exportacion as esco
from plataforma_datos.comun import entrada_salida
from plataforma_datos.comun.entrada_salida import carpetas, leer_json, sha256
from plataforma_datos.comun.nucleo import (
    ARCHIVO_DE_PROCEDENCIA,
    PAQUETE,
    ArchivoFaltante,
    Carpetas,
    Controles,
    ErrorFuente,
    FormatoInesperado,
    ValidacionFallida,
)
from plataforma_datos.ia_y_trabajo.fuentes.tich import edicion as estado_tich
from plataforma_datos.orquestacion import admision, exportar_paquete

# Un archivo que escribe una herramienta y está versionado en datos/.
DE_UNA_HERRAMIENTA = "vectores-oit.json"


class PruebaDestino(unittest.TestCase):
    """Lo que escriben las herramientas acompaña al paquete exportado en otra carpeta."""

    def test_lo_de_una_herramienta_se_copia_a_otra_carpeta_con_su_huella(self) -> None:
        """En otra carpeta, el archivo de la herramienta se copia y el manifiesto lleva su huella de datos/."""
        with tempfile.TemporaryDirectory() as carpeta:
            destino = Path(carpeta)
            entrada = exportar_paquete.entrada_escrita_por_herramienta(DE_UNA_HERRAMIENTA, destino)
            self.assertEqual(entrada, leer_json(PAQUETE / "manifiesto.json")[DE_UNA_HERRAMIENTA])
            self.assertEqual(sha256(destino / DE_UNA_HERRAMIENTA), sha256(PAQUETE / DE_UNA_HERRAMIENTA))

    def test_no_se_pierden_origenes_con_entradas_defectuosas(self) -> None:
        """Cambiar bytes, vaciar orígenes o perder una fuente impide exportar antes de copiar."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            paquete = raiz / "datos"
            paquete.mkdir()
            archivo = paquete / "vectores-movil.json"
            archivo.write_text('{"formato": 1}', encoding="utf-8")
            fuente = raiz / "entrada.bin"
            fuente.write_bytes(b"entrada")
            vigente = {"origenes": {"entrada.bin": sha256(fuente)}, "sha256": sha256(archivo)}
            manifiesto = paquete / "manifiesto.json"

            def guardar(entrada: object) -> None:
                manifiesto.write_text(json.dumps({archivo.name: entrada}), encoding="utf-8")

            with (
                mock.patch.object(exportar_paquete, "PAQUETE", paquete),
                mock.patch.object(exportar_paquete, "RAIZ", raiz),
            ):
                guardar(vigente)
                self.assertEqual(exportar_paquete.entrada_escrita_por_herramienta(archivo.name, paquete), vigente)
                for origenes in (
                    {},
                    {"entrada.bin": "alterada"},
                    {"ausente": "abc"},
                    {"datos/vectores-movil.json": sha256(archivo)},
                    {"../fuera": "abc"},
                ):
                    guardar({**vigente, "origenes": origenes})
                    with self.assertRaises(ValidacionFallida):
                        exportar_paquete.entrada_escrita_por_herramienta(archivo.name, paquete)
                guardar(vigente)
                archivo.write_text('{"formato": 2}', encoding="utf-8")
                with self.assertRaises(ValidacionFallida):
                    exportar_paquete.entrada_escrita_por_herramienta(archivo.name, paquete)

    def test_en_motor_paquete_no_se_copia_nada(self) -> None:
        """En su carpeta de siempre, el archivo de la herramienta ya está: solo se registra su huella."""
        with mock.patch.object(exportar_paquete.shutil, "copyfile") as copiar:
            exportar_paquete.entrada_escrita_por_herramienta(DE_UNA_HERRAMIENTA)
        copiar.assert_not_called()


class PruebaCaptura(unittest.TestCase):
    """La entrada histórica debe conservar sus propios bytes, no solo los de la salida."""

    def test_captura_ausente_alterada_o_con_otro_registro(self) -> None:
        """El control compara el miembro de la captura y su huella individual."""
        with tempfile.TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            fuentes = raiz / "datos/fuentes/recursos-fijados"
            fuentes.mkdir(parents=True)
            nombre = "vectores-oit.json"
            salida = raiz / nombre
            salida.write_bytes(b"entrada")
            huella = sha256(salida)
            registro = fuentes / "registro.json"
            registro.write_text(json.dumps({nombre: {"sha256": huella}}), encoding="utf-8")
            with mock.patch.object(exportar_paquete, "RAIZ", raiz):
                with self.assertRaises(FileNotFoundError):
                    exportar_paquete._comprobar_captura(nombre, huella)
                for contenido, correcto in ((b"entrada", True), (b"alterada", False)):
                    with zipfile.ZipFile(fuentes / "captura.zip", "w") as captura:
                        captura.writestr(nombre, contenido)
                    if correcto:
                        exportar_paquete._comprobar_captura(nombre, huella)
                    else:
                        with self.assertRaises(ValidacionFallida):
                            exportar_paquete._comprobar_captura(nombre, huella)
                registro.write_text("{}", encoding="utf-8")
                with self.assertRaises(ValidacionFallida):
                    exportar_paquete._comprobar_captura(nombre, huella)


BIBLIOTECA_ADMITIDA = b'{"fixture": "biblioteca validada"}'


def exportar_biblioteca_de_prueba(destino: Path) -> Path:
    """Sustituye solo el productor editorial en pruebas del exportador común.

    Returns:
        Destino preparado con bytes conocidos; el productor real tiene su ensayo de integración.
    """
    destino.write_bytes(BIBLIOTECA_ADMITIDA)
    return destino


class PruebaExportacion(unittest.TestCase):
    """La exportación escribe aparte, sustituye, registra cada huella y quita lo que ya no se exporta."""

    def exportar(self, carpeta: Path, construidos: dict[str, exportar_paquete.Paquete]) -> dict[str, object]:
        """Exporta en `carpeta` unos paquetes dados, sin leer datos/ ni lo de las herramientas.

        Returns:
            El manifiesto que devuelve `exportar`.
        """
        with (
            mock.patch.object(exportar_paquete, "paquetes", return_value=construidos),
            mock.patch.object(exportar_paquete, "exportar_lecturas", side_effect=exportar_biblioteca_de_prueba),
            mock.patch.object(
                exportar_paquete, "exportar_observaciones_lecturas", side_effect=exportar_biblioteca_de_prueba
            ),
            mock.patch.object(exportar_paquete, "entrada_escrita_por_herramienta", return_value=None),
            mock.patch.object(exportar_paquete, "enlaces_publicados", return_value=None),
        ):
            return exportar_paquete.exportar(carpeta)

    def test_manifiesto_con_huellas_y_sin_lo_obsoleto(self) -> None:
        """Cada archivo escrito tiene su huella en el manifiesto; lo de PREPARADOS_SIN_USO desaparece."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "paquete"
            carpeta.mkdir()
            (carpeta / "accidentes.json").write_text("{}", encoding="utf-8")
            manifiesto = self.exportar(carpeta, {"oit.json": exportar_paquete.Paquete({"a": 1}, [])})
            self.assertEqual(manifiesto, {"oit.json": {"origenes": {}, "sha256": sha256(carpeta / "oit.json")}})
            self.assertEqual(leer_json(carpeta / "manifiesto.json"), manifiesto)
            self.assertEqual(
                sorted(ruta.name for ruta in carpeta.iterdir()),
                ["lecturas.json", "manifiesto.json", "observaciones-lecturas.json", "oit.json"],
            )
            self.assertEqual(sorted(ruta.name for ruta in Path(temporal).iterdir()), ["paquete"])

    def test_el_selector_retirado_no_se_copia_ni_permanece_en_otro_destino(self) -> None:
        """Una copia anterior no vuelve a registrar ni conservar el recurso retirado."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            origen, destino = raiz / "datos", raiz / "destino"
            origen.mkdir()
            destino.mkdir()
            nombre = "formacion-faro.json"
            (origen / nombre).write_bytes(b"recurso anterior")
            (destino / nombre).write_bytes(b"recurso anterior")
            fuente = raiz / "entrada.bin"
            fuente.write_bytes(b"entrada anterior")
            entrada_salida.guardar_json(
                origen / "manifiesto.json",
                {nombre: {"origenes": {"entrada.bin": sha256(fuente)}, "sha256": sha256(origen / nombre)}},
            )
            with (
                mock.patch.object(exportar_paquete, "PAQUETE", origen),
                mock.patch.object(exportar_paquete, "RAIZ", raiz),
                mock.patch.object(
                    exportar_paquete, "paquetes", return_value={"oit.json": exportar_paquete.Paquete({"a": 1}, [])}
                ),
                mock.patch.object(exportar_paquete, "exportar_lecturas", side_effect=exportar_biblioteca_de_prueba),
                mock.patch.object(
                    exportar_paquete, "exportar_observaciones_lecturas", side_effect=exportar_biblioteca_de_prueba
                ),
            ):
                manifiesto = exportar_paquete.exportar(destino)
            self.assertNotIn(nombre, manifiesto)
            self.assertFalse((destino / nombre).exists())
            self.assertEqual(leer_json(destino / "oit.json"), {"a": 1})

    def test_un_fallo_al_escribir_deja_el_paquete_como_estaba(self) -> None:
        """Si un paquete no se puede escribir (un NaN), ningún archivo del paquete vigente cambia ni desaparece."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal) / "paquete"
            carpeta.mkdir()
            for nombre in ("oit.json", "accidentes.json", "manifiesto.json"):
                (carpeta / nombre).write_text('"vigente"', encoding="utf-8")
            construidos = {
                "oit.json": exportar_paquete.Paquete({"a": 1}, []),
                "cambra.json": exportar_paquete.Paquete({"a": float("nan")}, []),
            }
            with self.assertRaises(ValueError):
                self.exportar(carpeta, construidos)
            contenido = {ruta.name: ruta.read_text(encoding="utf-8") for ruta in carpeta.iterdir()}
            self.assertEqual(contenido, dict.fromkeys(("oit.json", "accidentes.json", "manifiesto.json"), '"vigente"'))
            self.assertEqual(sorted(ruta.name for ruta in Path(temporal).iterdir()), ["paquete"])

    def _paquete_con_enlaces_publicados(
        self, raiz: Path, contenido: dict[str, object]
    ) -> tuple[Path, Path, dict[str, object]]:
        """Un datos/ con su enlaces-comprobados.json y su manifiesto vigente, y un destino vacío.

        Returns:
            La carpeta publicada, el destino y la entrada del manifiesto del archivo.
        """
        origen, destino = raiz / "datos", raiz / "destino"
        origen.mkdir()
        destino.mkdir()
        archivo = origen / "enlaces-comprobados.json"
        archivo.write_text(json.dumps(contenido), encoding="utf-8")
        entrada = {"origenes": {"datos/fuentes/recursos-fijados/captura.zip": "a" * 64}, "sha256": sha256(archivo)}
        entrada_salida.guardar_json(origen / "manifiesto.json", {archivo.name: entrada})
        return origen, destino, entrada

    def test_sin_conjunto_validado_de_enlaces_se_conserva_el_archivo_publicado(self) -> None:
        """Sin validado admitido (ausente o en rojo) la exportación no se detiene: conserva el archivo anterior."""
        for contenido in ({"programas": {}, "webs": {}, "cursos": {}}, {"version": 2, "programas": {}}):
            for fallo in (ArchivoFaltante("falta"), ValidacionFallida("enlaces: validación con errores")):
                with self.subTest(forma=sorted(contenido), fallo=type(fallo).__name__):
                    self._exportar_sin_validado_de_enlaces(contenido, fallo)

    def _exportar_sin_validado_de_enlaces(self, contenido: dict[str, object], fallo: Exception) -> None:
        """Exporta con `paquete_validado` fallando y comprueba que el archivo anterior pasa tal cual."""
        with tempfile.TemporaryDirectory() as temporal:
            origen, destino, entrada = self._paquete_con_enlaces_publicados(Path(temporal), contenido)
            con_oit = {"oit.json": exportar_paquete.Paquete({"a": 1}, [])}
            with (
                mock.patch.object(exportar_paquete, "PAQUETE", origen),
                mock.patch.object(exportar_paquete, "paquete_validado", side_effect=fallo),
                mock.patch.object(exportar_paquete, "exportar_lecturas", side_effect=exportar_biblioteca_de_prueba),
                mock.patch.object(
                    exportar_paquete, "exportar_observaciones_lecturas", side_effect=exportar_biblioteca_de_prueba
                ),
                mock.patch.object(exportar_paquete, "paquetes", return_value=con_oit),
                mock.patch.object(exportar_paquete, "entrada_escrita_por_herramienta", return_value=None),
                mock.patch("sys.stderr", new=io.StringIO()),
            ):
                self.assertEqual(exportar_paquete._enlaces_comprobados(), {})
                manifiesto = exportar_paquete.exportar(destino)
            self.assertEqual(manifiesto["enlaces-comprobados.json"], entrada)
            self.assertEqual(leer_json(destino / "enlaces-comprobados.json"), contenido)
            self.assertEqual(leer_json(destino / "oit.json"), {"a": 1})

    def test_un_conjunto_admitido_que_no_se_puede_leer_detiene_la_exportacion(self) -> None:
        """Un JSON inválido o una validación ilegible no se tratan como «falta»: la exportación se detiene."""
        for error in (
            FormatoInesperado("enlaces.json no es JSON válido"),
            FormatoInesperado("validacion.json ilegible"),
        ):
            with (
                self.subTest(error=str(error)),
                mock.patch.object(exportar_paquete, "paquete_validado", side_effect=error),
                self.assertRaises(FormatoInesperado),
            ):
                exportar_paquete._enlaces_comprobados()

    def test_sin_archivo_publicado_ni_conjunto_el_paquete_sale_sin_enlaces(self) -> None:
        """Sin nada que conservar, la exportación sigue y el archivo no figura en el manifiesto."""
        with tempfile.TemporaryDirectory() as temporal:
            raiz = Path(temporal)
            origen, destino = raiz / "datos", raiz / "destino"
            origen.mkdir()
            destino.mkdir()
            with (
                mock.patch.object(exportar_paquete, "PAQUETE", origen),
                mock.patch.object(exportar_paquete, "exportar_lecturas", side_effect=exportar_biblioteca_de_prueba),
                mock.patch.object(
                    exportar_paquete, "exportar_observaciones_lecturas", side_effect=exportar_biblioteca_de_prueba
                ),
                mock.patch.object(
                    exportar_paquete, "paquetes", return_value={"oit.json": exportar_paquete.Paquete({"a": 1}, [])}
                ),
                mock.patch.object(exportar_paquete, "entrada_escrita_por_herramienta", return_value=None),
            ):
                manifiesto = exportar_paquete.exportar(destino)
            self.assertNotIn("enlaces-comprobados.json", manifiesto)

    def test_unos_bytes_publicados_distintos_de_su_procedencia_detienen_la_exportacion(self) -> None:
        """Conservar lo anterior no admite un archivo que ya no coincide con su manifiesto."""
        with tempfile.TemporaryDirectory() as temporal:
            origen, destino, _entrada = self._paquete_con_enlaces_publicados(Path(temporal), {"programas": {}})
            (origen / "enlaces-comprobados.json").write_text("{}", encoding="utf-8")
            with mock.patch.object(exportar_paquete, "PAQUETE", origen), self.assertRaises(ValidacionFallida):
                exportar_paquete.enlaces_publicados(destino)

    def test_la_cita_de_esco_lleva_la_version_de_la_fuente(self) -> None:
        """El paquete exportado cita la versión que define constantes_esco, no una copia a mano."""
        self.assertEqual(leer_json(PAQUETE / "esco.json")["fuente"], f"Comisión Europea, ESCO {esco.VERSION_ESCO}")
        self.assertEqual(esco.CIFRAS_DEL_GRUPO_CIUO, 4)


class PruebaTich(unittest.TestCase):
    """tich.json lleva, de quienes no saben usar la IA, la cifra de Cataluña del Idescat, no la de España del INE."""

    def setUp(self) -> None:
        """Monta una fixture de proyección a partir del paquete versionado, sin datos operativos de instalación.

        No reconstruye los productores TIC-H: la integración real ejecuta estos mismos cuerpos con sus entradas.
        """
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        publicado = leer_json(PAQUETE / "tich.json")
        self.publicado = publicado
        motivos = publicado["motivos_no_uso"]
        descargado = motivos["consultado"] + "T00:00:00+00:00"
        tabla = {"url": motivos["url"], "sha256": motivos["sha256"], "descargado_utc": descargado}
        llars = {
            "cita": motivos["fuente"],
            "cifras": {
                "ia-generativa-no-sabe-usarla-trabajador-manual": {
                    "valor": motivos["no_sabia_como_utilizarlas"]["manual"],
                    "anio": int(motivos["anio"]),
                },
                "ia-generativa-no-sabe-usarla-trabajador-no-manual": {
                    "valor": motivos["no_sabia_como_utilizarlas"]["no_manual"],
                    "anio": int(motivos["anio"]),
                },
            },
            "tablas": {tic_llars.TABLA_NO_SABE: tabla},
        }
        for fuente, datos in (
            ("tich", {k: v for k, v in publicado.items() if k != "motivos_no_uso"}),
            (tic_llars.FUENTE, llars),
        ):
            carpeta = self.carpetas(fuente)
            carpeta.validado.mkdir(parents=True)
            (carpeta.validado / f"{fuente}.json").write_text(json.dumps(datos), encoding="utf-8")
            controles = Controles()
            controles.comprobar(
                json.loads((carpeta.validado / f"{fuente}.json").read_bytes()) == datos,
                "proyección sintética del paquete TIC-H conservada",
            )
            carpeta.validacion.write_text(
                json.dumps({"estado": controles.estado, "controles": controles.lista}), encoding="utf-8"
            )
        edicion = {
            **estado_tich.primera(),
            "anio": publicado["anio"],
            "anios_medidos": publicado.get("anios_medidos", [publicado["anio"]]),
        }
        estado_tich.guardar(edicion, self.carpetas("tich").validado / estado_tich.ESTADO.name)
        procedencia = self.carpetas(tic_llars.FUENTE).original / ARCHIVO_DE_PROCEDENCIA
        procedencia.parent.mkdir(parents=True)
        procedencia.write_text(
            json.dumps({"archivos": [{"archivo": "idescat-ticll25-3.4.2.html", **tabla}]}), encoding="utf-8"
        )
        for modulo in (entrada_salida, admision):
            parche = mock.patch.object(modulo, "carpetas", side_effect=self.carpetas)
            parche.start()
            self.addCleanup(parche.stop)

        parche = mock.patch(__name__ + ".carpetas", side_effect=self.carpetas)
        parche.start()
        self.addCleanup(parche.stop)

    def carpetas(self, fuente: str) -> Carpetas:
        """Rutas exclusivas de la fixture temporal.

        Returns:
            Las tres etapas de la fuente dentro del temporal.
        """
        return Carpetas(
            self.raiz / "originales" / fuente, self.raiz / "preparados" / fuente, self.raiz / "validados" / fuente
        )

    def test_quienes_no_saben_usarla_vienen_del_idescat_con_su_procedencia(self) -> None:
        """El motivo por clase sale de lo validado de tic_llars (tabla 3.4.2), con su URL, su huella y su fecha."""
        tabla = {
            "url": "https://www.idescat.cat/pub/?id=ticll25&n=3.4.2&lang=es",
            "sha256": "a" * 64,
            "descargado_utc": "2026-10-11T23:30:00-04:00",
        }
        llars = {
            "cita": "Idescat, encuesta sintética",
            "cifras": {
                "ia-generativa-no-sabe-usarla-trabajador-manual": {"valor": 45.8, "anio": 2025},
                "ia-generativa-no-sabe-usarla-trabajador-no-manual": {"valor": 33.5, "anio": 2025},
            },
            "tablas": {tic_llars.TABLA_NO_SABE: tabla},
        }
        ruta = self.carpetas(tic_llars.FUENTE).validado / f"{tic_llars.FUENTE}.json"
        ruta.write_text(json.dumps(llars), encoding="utf-8")
        procedencia = self.carpetas(tic_llars.FUENTE).original / ARCHIVO_DE_PROCEDENCIA
        procedencia.write_text(
            json.dumps({"archivos": [{"archivo": "idescat-ticll25-3.4.2.html", **tabla}]}), encoding="utf-8"
        )
        paquete = exportar_paquete.paquete_tich()
        motivos = paquete.datos["motivos_no_uso"]
        self.assertEqual(motivos["no_sabia_como_utilizarlas"], {"manual": 45.8, "no_manual": 33.5})
        self.assertEqual(motivos["url"], "https://www.idescat.cat/pub/?id=ticll25&n=3.4.2&lang=es")
        original = next(
            (
                archivo
                for archivo in leer_json(carpetas(tic_llars.FUENTE).original / ARCHIVO_DE_PROCEDENCIA)["archivos"]
                if archivo["archivo"] == "idescat-ticll25-3.4.2.html"
            ),
            None,
        )
        self.assertIsNotNone(original, "idescat-ticll25-3.4.2.html no está registrado en la procedencia de tic_llars")
        self.assertEqual(
            (motivos["sha256"], motivos["consultado"]),
            (original["sha256"], datetime.fromisoformat(original["descargado_utc"]).date().isoformat()),
        )
        self.assertEqual(
            (motivos["sha256"], motivos["consultado"], motivos["anio"]),
            ("a" * 64, "2026-10-11", "2025"),
        )
        self.assertEqual(motivos["fuente"], "Idescat, encuesta sintética")
        self.assertEqual(motivos["tabla"], "3.4.2")
        self.assertEqual(
            paquete.origenes,
            [self.carpetas(fuente).validado / f"{fuente}.json" for fuente in ("tich", tic_llars.FUENTE)],
        )

    def test_el_paquete_del_motor_es_el_que_se_compone(self) -> None:
        """datos/tich.json es lo que compone paquete_tich: nadie lo escribe a mano."""
        self.assertEqual(self.publicado, exportar_paquete.paquete_tich().datos)


def instantanea(carpeta: Path) -> dict[str, bytes]:
    """Captura todos los archivos de un destino de prueba, incluidos los ajenos al exportador.

    Returns:
        Los bytes por ruta relativa.
    """
    return {ruta.relative_to(carpeta).as_posix(): ruta.read_bytes() for ruta in carpeta.rglob("*") if ruta.is_file()}


class PruebaRecuperacion(unittest.TestCase):
    """Un fallo observado no deja salidas nuevas mezcladas con el manifiesto anterior."""

    def setUp(self) -> None:
        """Prepara únicamente archivos propios de un destino temporal."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name)
        self.destino = self.raiz / "datos Año 2026"
        self.destino.mkdir()
        for nombre in (
            "oit.json",
            "cambra.json",
            "manifiesto.json",
            "accidentes.json",
            "catalan.json",
            "README.md",
            "lecturas.json",
        ):
            (self.destino / nombre).write_bytes((nombre + " anterior").encode())
        (self.destino / "globales").mkdir()
        (self.destino / "globales/datos-globales.json").write_bytes(b"globales ajenos")
        self.previo = instantanea(self.destino)
        self.construidos = {
            "oit.json": exportar_paquete.Paquete({"a": 1}, []),
            "cambra.json": exportar_paquete.Paquete({"b": 2}, []),
        }
        parche = mock.patch.object(exportar_paquete, "paquetes", return_value=self.construidos)
        parche.start()
        self.addCleanup(parche.stop)
        parche = mock.patch.object(exportar_paquete, "entrada_escrita_por_herramienta", return_value=None)
        self.herramienta = parche.start()
        self.addCleanup(parche.stop)
        parche = mock.patch.object(exportar_paquete, "exportar_lecturas", side_effect=exportar_biblioteca_de_prueba)
        self.biblioteca = parche.start()
        self.addCleanup(parche.stop)
        parche = mock.patch.object(
            exportar_paquete, "exportar_observaciones_lecturas", side_effect=exportar_biblioteca_de_prueba
        )
        parche.start()
        self.addCleanup(parche.stop)

    def test_fallo_de_herramienta_conserva_destino(self) -> None:
        """La copia de herramientas falla antes de sustituir archivos vigentes."""
        self.herramienta.side_effect = OSError("fallo de copia")
        with self.assertRaisesRegex(OSError, "fallo de copia"):
            exportar_paquete.exportar(self.destino)
        self.assertEqual(instantanea(self.destino), self.previo)

    def test_fallo_de_manifiesto_conserva_destino(self) -> None:
        """El manifiesto también se serializa y escribe antes de promover el conjunto."""
        guardar = exportar_paquete.guardar_json

        def fallar(ruta: Path, datos: object) -> None:
            if ruta.name == "manifiesto.json":
                raise OSError("fallo del manifiesto")
            guardar(ruta, datos)

        with (
            mock.patch.object(exportar_paquete, "guardar_json", side_effect=fallar),
            self.assertRaisesRegex(OSError, "fallo del manifiesto"),
        ):
            exportar_paquete.exportar(self.destino)
        self.assertEqual(instantanea(self.destino), self.previo)

    def test_fallo_de_promocion_restaura_anteriores(self) -> None:
        """La segunda sustitución falla tras promover la primera; ambas recuperan sus bytes."""
        sustituir = Path.replace
        fallo = False

        def fallar(ruta: Path, destino: Path) -> Path:
            nonlocal fallo
            if destino == self.destino / "cambra.json" and not fallo:
                fallo = True
                raise OSError("fallo de promoción")
            return sustituir(ruta, destino)

        with mock.patch.object(Path, "replace", fallar), self.assertRaisesRegex(OSError, "fallo de promoción"):
            exportar_paquete.exportar(self.destino)
        self.assertTrue(fallo)
        self.assertEqual(instantanea(self.destino), self.previo)

    def test_fallo_al_retirar_obsoleto_restaura_conjunto(self) -> None:
        """Una retirada fallida también restaura archivos y manifiesto previos."""
        retirar = Path.unlink

        def fallar(ruta: Path, missing_ok: bool = False) -> None:
            if ruta == self.destino / "accidentes.json":
                raise OSError("fallo al retirar")
            retirar(ruta, missing_ok=missing_ok)

        with mock.patch.object(Path, "unlink", fallar), self.assertRaisesRegex(OSError, "fallo al retirar"):
            exportar_paquete.exportar(self.destino)
        self.assertEqual(instantanea(self.destino), self.previo)

    def test_catalan_opcional_obsoleto_se_retira(self) -> None:
        """El catalán omitido no queda fuera de manifiesto; se conservan los archivos ajenos."""
        manifiesto = exportar_paquete.exportar(self.destino)
        self.assertNotIn("catalan.json", manifiesto)
        self.assertFalse((self.destino / "catalan.json").exists())
        self.assertEqual((self.destino / "lecturas.json").read_bytes(), BIBLIOTECA_ADMITIDA)
        self.assertNotIn("lecturas.json", manifiesto)
        for nombre in ("README.md", "globales/datos-globales.json"):
            self.assertEqual((self.destino / nombre).read_bytes(), self.previo[nombre])

    def test_herramienta_opcional_obsoleta_se_retira(self) -> None:
        """Otra carpeta no conserva una herramienta antigua que ya no tiene origen ni entrada."""
        ruta = self.destino / "vectores-oit.json"
        ruta.write_bytes(b"vector antiguo")
        manifiesto = exportar_paquete.exportar(self.destino)
        self.assertNotIn(ruta.name, manifiesto)
        self.assertFalse(ruta.exists())

    def test_si_restaurar_falla_se_conserva_respaldo_y_causa(self) -> None:
        """La última copia anterior no se elimina y el error original permanece como causa."""
        sustituir, copiar = Path.replace, exportar_paquete.shutil.copyfile
        original = OSError("fallo de promoción original")

        def fallar_promocion(ruta: Path, destino: Path) -> Path:
            if destino == self.destino / "cambra.json":
                raise original
            return sustituir(ruta, destino)

        def fallar_restauracion(origen: Path, destino: Path) -> str:
            if origen.parent.name == "respaldo" and destino == self.destino / "oit.json":
                raise OSError("fallo de restauración")
            return copiar(origen, destino)

        with (
            mock.patch.object(Path, "replace", fallar_promocion),
            mock.patch.object(exportar_paquete.shutil, "copyfile", side_effect=fallar_restauracion),
            self.assertRaisesRegex(ErrorFuente, "restauración incompleta.*respaldo:") as captura,
        ):
            exportar_paquete.exportar(self.destino)
        self.assertIs(captura.exception.__cause__, original)
        respaldo = Path(str(captura.exception).split("respaldo: ", 1)[1])
        self.assertTrue(respaldo.is_dir())
        self.assertEqual((respaldo / "oit.json").read_bytes(), self.previo["oit.json"])
        self.assertEqual((respaldo / "manifiesto.json").read_bytes(), self.previo["manifiesto.json"])

    def test_fallo_de_limpieza_no_oculta_error_original(self) -> None:
        """Un segundo fallo al retirar el temporal no cambia la excepción de la exportación."""
        original = OSError("fallo de copia original")
        self.herramienta.side_effect = original
        aviso = io.StringIO()
        with (
            mock.patch.object(exportar_paquete.shutil, "rmtree", side_effect=OSError("fallo de limpieza")),
            mock.patch("sys.stderr", aviso),
            self.assertRaises(OSError) as captura,
        ):
            exportar_paquete.exportar(self.destino)
        self.assertIs(captura.exception, original)
        self.assertIn("temporal", aviso.getvalue())
        self.assertIn("fallo de limpieza", aviso.getvalue())
        self.assertEqual(instantanea(self.destino), self.previo)


class PruebaHerramientas(unittest.TestCase):
    """Las herramientas son recursos opcionales; el exportador no las regenera."""

    def test_su_destino_predeterminado_registra_huella(self) -> None:
        """Se comprueba también lo que devuelve el nominal original que evita copiar."""
        entrada = exportar_paquete.entrada_escrita_por_herramienta(DE_UNA_HERRAMIENTA)
        self.assertEqual(entrada, leer_json(PAQUETE / "manifiesto.json")[DE_UNA_HERRAMIENTA])

    def test_ausencia_avisa_sin_recomendar_comando_inexistente(self) -> None:
        """Una herramienta ausente se omite con aviso local y no crea el destino."""
        with tempfile.TemporaryDirectory() as temporal:
            carpeta = Path(temporal)
            aviso = io.StringIO()
            with mock.patch.object(exportar_paquete, "PAQUETE", carpeta), mock.patch("sys.stderr", aviso):
                entrada = exportar_paquete.entrada_escrita_por_herramienta("vectores-oit.json", carpeta / "salida")
            self.assertIsNone(entrada)
            self.assertIn("vectores-oit.json", aviso.getvalue())
            self.assertNotIn("motor/", aviso.getvalue())
            self.assertFalse((carpeta / "salida").exists())


if __name__ == "__main__":
    unittest.main()
