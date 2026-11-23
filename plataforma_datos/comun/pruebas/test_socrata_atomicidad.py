"""La descarga diaria se admite completa o conserva los originales y su procedencia."""

import hashlib
import io
import json
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import date
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

from plataforma_datos.comun import red, socrata
from plataforma_datos.comun.entrada_salida import guardar_json, leer_json
from plataforma_datos.comun.nucleo import Descarga, OriginalCambiado
from plataforma_datos.orquestacion import sustitucion
from plataforma_datos.orquestacion.pruebas.ayudas import Corte

DIA = date(2026, 10, 22)
CAPTURA_PREVIA = "2026-10-22T08:00:00+00:00"
CAPTURA_NUEVA = "2026-10-22T10:00:00+00:00"
CONJUNTO = socrata.Conjunto("abcd-1234", "Conjunto sintético", "Licencia sintética")
OTRO_CONJUNTO = socrata.Conjunto("efgh-5678", "Segundo conjunto sintético", "Licencia sintética")
DATOS_PREVIOS = b'[{"id":"previo"}]'
DATOS_NUEVOS = b'[{"id":"nuevo"}]'
METADATOS_PREVIOS = json.dumps(
    {"rowsUpdatedAt": 1792656000, "columns": [{"fieldName": "id", "cachedContents": {"non_null": "1", "null": "0"}}]}
).encode()
METADATOS_NUEVOS = json.dumps(
    {"rowsUpdatedAt": 1792663200, "columns": [{"fieldName": "id", "cachedContents": {"non_null": "1", "null": "0"}}]}
).encode()


class PruebaAtomicidadSocrata(unittest.TestCase):
    """Sondas a través de registrar_copia y del transporte común sustituido."""

    def setUp(self) -> None:
        """Crea originales sintéticos con procedencia y una ruta Unicode propia."""
        self.temporal = tempfile.TemporaryDirectory(prefix="Socrata Año 2026 ")
        self.addCleanup(self.temporal.cleanup)
        self.carpeta = Path(self.temporal.name) / "originales"
        self.carpeta.mkdir()
        self.procedencia = self.carpeta / "procedencia.json"
        self.conjuntos = (CONJUNTO,)
        self._crear_previa()

    def _crear_previa(self) -> None:
        """Escribe todos los componentes de la copia sintética previa."""
        entradas = []
        for archivo in socrata.archivos_de_la_copia(self.conjuntos, DIA.isoformat()):
            contenido = METADATOS_PREVIOS if archivo["archivo"].endswith("-metadatos.json") else DATOS_PREVIOS
            (self.carpeta / archivo["archivo"]).write_bytes(contenido)
            entradas.append(
                {
                    **archivo,
                    "sha256": hashlib.sha256(contenido).hexdigest(),
                    "bytes": len(contenido),
                    "descargado_utc": CAPTURA_PREVIA,
                }
            )
        guardar_json(self.procedencia, {"fuente": "Prueba sintética", "copia": DIA.isoformat(), "archivos": entradas})

    def _estado(self) -> dict[str, bytes]:
        """Devuelve los bytes del árbol visible para comparar el conjunto entero.

        Returns:
            Archivos originales por ruta relativa, sin fechas de modificación.
        """
        return {p.relative_to(self.carpeta).as_posix(): p.read_bytes() for p in self.carpeta.rglob("*") if p.is_file()}

    def _registrar(self, respuestas: list[Descarga | Exception], aceptar: bool = True) -> None:
        """Ejecuta la operación real sustituyendo solo transporte, pausa y reloj de captura."""
        with ExitStack() as parches:
            parches.enter_context(patch.object(red, "descargar_url", side_effect=respuestas))
            parches.enter_context(patch.object(red, "ahora_utc", return_value=CAPTURA_NUEVA))
            parches.enter_context(patch.object(socrata.time, "sleep"))
            parches.enter_context(redirect_stdout(io.StringIO()))
            socrata.registrar_copia(
                self.conjuntos,
                socrata.RutasDeLaCopia(self.carpeta, self.procedencia),
                {"fuente": "Prueba sintética"},
                aceptar,
                DIA,
            )

    def _respuestas(self, datos: bytes = DATOS_NUEVOS, metadatos: bytes = METADATOS_NUEVOS) -> list[Descarga]:
        """Compone las respuestas para las URLs de cada conjunto.

        Returns:
            Una descarga por datos/metadatos y conjunto, en el orden del cliente.
        """
        return [
            Descarga(metadatos if a["archivo"].endswith("-metadatos.json") else datos, a["url"], "application/json")
            for a in socrata.archivos_de_la_copia(self.conjuntos, DIA.isoformat())
        ]

    def test_fallo_en_metadatos_conserva_datos_y_procedencia_del_mismo_dia(self) -> None:
        """El segundo HTTP no puede dejar datos nuevos ligados a la procedencia anterior."""
        antes = self._estado()
        error = URLError("fallo sintético en metadatos")
        with self.assertRaises(URLError) as captura:
            self._registrar([self._respuestas()[0], error])
        self.assertIs(captura.exception, error)
        self.assertEqual(self._estado(), antes)

    def test_fallo_tardio_no_admite_ni_el_primer_conjunto(self) -> None:
        """Los conjuntos de una copia diaria comparten una sola admisión."""
        self.conjuntos = (CONJUNTO, OTRO_CONJUNTO)
        self._crear_previa()
        antes = self._estado()
        respuestas: list[Descarga | Exception] = list(self._respuestas())
        respuestas[-1] = URLError("fallo en el segundo conjunto")
        with self.assertRaises(URLError):
            self._registrar(respuestas)
        self.assertEqual(self._estado(), antes)

    def test_primera_descarga_fallida_no_publica_original_sin_procedencia(self) -> None:
        """Sin copia previa tampoco se admiten componentes aislados."""
        for archivo in self.carpeta.iterdir():
            archivo.unlink()
        with self.assertRaises(URLError):
            self._registrar([self._respuestas()[0], URLError("sin metadatos")])
        self.assertEqual(self._estado(), {})

    def test_fallo_al_preparar_procedencia_conserva_todos_los_originales(self) -> None:
        """El JSON de procedencia se prepara antes de modificar el árbol visible."""
        antes = self._estado()
        guardar = socrata.guardar_json

        def fallo(ruta: Path, contenido: object) -> None:
            """Falla la procedencia después de recibir las respuestas, sin bloquear el diagnóstico.

            Raises:
                OSError: Al guardar la procedencia candidata.
            """
            if ruta.name == "procedencia.json":
                raise OSError("sin espacio para procedencia")
            guardar(ruta, contenido)

        with patch.object(socrata, "guardar_json", fallo), self.assertRaises(OSError):
            self._registrar(self._respuestas())
        self.assertEqual(len(self._intentos()), 1)
        intento = self._intentos()[0].parent
        self.assertEqual(len(list(intento.glob("capturas/*/cuerpo.json"))), 2)
        self.assertEqual(self._estado(), antes)

    def test_exito_admite_huellas_y_fechas_de_captura_coherentes(self) -> None:
        """La admisión correcta relaciona las nuevas respuestas con su SHA y captura."""
        self._registrar(self._respuestas())
        procedencia = leer_json(self.procedencia)
        self.assertEqual(procedencia["copia"], DIA.isoformat())
        for entrada in procedencia["archivos"]:
            self.assertEqual(
                hashlib.sha256((self.carpeta / entrada["archivo"]).read_bytes()).hexdigest(), entrada["sha256"]
            )
            self.assertEqual(entrada["descargado_utc"], CAPTURA_NUEVA)

    def test_cambio_rechazado_no_modifica_ningun_componente(self) -> None:
        """La candidata conserva la política de cambio del cliente anterior."""
        antes = self._estado()
        with self.assertRaises(OriginalCambiado):
            self._registrar(self._respuestas(), aceptar=False)
        self.assertEqual(self._estado(), antes)

    def test_fallo_de_promocion_restaura_carpeta_entera(self) -> None:
        """Fallado el renombre nuevo, vuelve el respaldo con su procedencia anterior."""
        antes = self._estado()
        renombrar = Path.rename

        def fallo(ruta: Path, destino: Path) -> Path:
            """Falla solo al colocar la candidata verificada.

            Returns:
                El resultado del renombre que no falla.

            Raises:
                OSError: Al intentar promover la candidata.
            """
            if ruta.name == "originales.nuevo":
                raise OSError("fallo sintético al promover")
            return renombrar(ruta, destino)

        with patch.object(Path, "rename", fallo), self.assertRaises(OSError):
            self._registrar(self._respuestas())
        self.assertEqual(self._estado(), antes)

    def test_corte_antes_de_hecho_recupera_al_empezar_sin_admitir_otra_copia(self) -> None:
        """El siguiente intento recupera primero aunque su primera petición vuelva a fallar."""
        antes = self._estado()
        anotar = sustitucion.anotar_diario

        def corte(*argumentos: object) -> None:
            """Simula terminar el proceso justo antes de confirmar el diario.

            Raises:
                Corte: Antes de confirmar.
            """
            if argumentos[1] == sustitucion.HECHO:
                raise Corte()
            anotar(*argumentos)

        with patch.object(sustitucion, "anotar_diario", corte), self.assertRaises(Corte):
            self._registrar(self._respuestas())
        with self.assertRaises(URLError):
            self._registrar([URLError("siguiente intento sin respuesta")])
        self.assertEqual(self._estado(), antes)
        self.assertFalse((self.carpeta.parent / ".originales-socrata" / "diario.json").exists())

    def test_corte_tras_hecho_conserva_copia_admitida_al_recuperar(self) -> None:
        """Tras confirmar, la recuperación limpia respaldos y conserva los SHA nuevos."""
        recuperar = sustitucion.recuperar
        llamadas = 0
        limpieza_final = 2

        def corte(*argumentos: object) -> str | None:
            """Corta la limpieza final, después de la recuperación inicial.

            Returns:
                El resultado real antes del corte.

            Raises:
                Corte: Después de confirmar, antes de limpiar.
            """
            nonlocal llamadas
            llamadas += 1
            if llamadas == limpieza_final:
                raise Corte()
            return recuperar(*argumentos)

        with patch.object(sustitucion, "recuperar", corte), self.assertRaises(Corte):
            self._registrar(self._respuestas())
        admitida = self._estado()
        self.assertNotEqual(admitida, {})
        with self.assertRaises(URLError):
            self._registrar([URLError("nuevo intento fallido")])
        self.assertEqual(self._estado(), admitida)
        self.assertEqual(leer_json(self.procedencia)["archivos"][0]["descargado_utc"], CAPTURA_NUEVA)

    def test_recuperacion_fallida_conserva_diario_y_respaldo(self) -> None:
        """Dos fallos no se anuncian como éxito y guardan evidencia para recuperar después."""
        antes = self._estado()
        renombrar = Path.rename

        def fallo(ruta: Path, destino: Path) -> Path:
            """Falla la promoción y la primera restauración.

            Returns:
                El renombre real cuando no se inyecta fallo.

            Raises:
                OSError: Al promover o restaurar.
            """
            if ruta.name in ("originales.nuevo", "originales.anterior"):
                raise OSError("disco temporalmente inaccesible")
            return renombrar(ruta, destino)

        with patch.object(Path, "rename", fallo), self.assertRaises(sustitucion.RecuperacionIncompleta):
            self._registrar(self._respuestas())
        self.assertTrue((self.carpeta.parent / ".originales-socrata" / "diario.json").exists())
        self.assertTrue(self.carpeta.with_name("originales.anterior").exists())
        with self.assertRaises(URLError):
            self._registrar([URLError("descarga posterior fallida")])
        self.assertEqual(self._estado(), antes)

    def test_escritores_de_la_misma_carpeta_no_se_solapan(self) -> None:
        """El segundo escritor se rechaza antes de pedir datos o cambiar originales."""
        antes = self._estado()
        control = self.carpeta.parent / ".originales-socrata"
        with (
            sustitucion.cerrojo(self.carpeta.parent, carpeta=control),
            patch.object(socrata, "descargar_copia") as descarga,
        ):
            with self.assertRaises(sustitucion.ActualizacionEnCurso):
                self._registrar(self._respuestas())
            descarga.assert_not_called()
        self.assertEqual(self._estado(), antes)

    def test_conserva_historia_y_captura_de_metadatos_equivalentes(self) -> None:
        """Copiar no convierte mtime en captura ni borra otras copias históricas."""
        historica = self.carpeta / "abcd-1234-2026-10-21.json"
        historica.write_bytes(b"historia independiente")
        metadatos = json.loads(METADATOS_PREVIOS)
        metadatos["viewCount"] = 999
        self._registrar(self._respuestas(metadatos=json.dumps(metadatos).encode()))
        self.assertEqual(historica.read_bytes(), b"historia independiente")
        entradas = leer_json(self.procedencia)["archivos"]
        self.assertEqual(entradas[0]["descargado_utc"], CAPTURA_NUEVA)
        self.assertEqual(entradas[1]["descargado_utc"], CAPTURA_PREVIA)
        self.assertEqual((self.carpeta / entradas[1]["archivo"]).read_bytes(), METADATOS_PREVIOS)
        respuestas = [leer_json(p) for p in self._intentos()[0].parent.glob("capturas/*/respuesta.json")]
        captura_meta = next(r for r in respuestas if r["archivo"].endswith("-metadatos.json"))
        self.assertEqual(captura_meta["capturado_utc"], CAPTURA_NUEVA)
        self.assertEqual(captura_meta["sha256"], hashlib.sha256(json.dumps(metadatos).encode()).hexdigest())

    def test_primera_publicacion_sin_carpeta_previa(self) -> None:
        """El destino originalmente ausente se crea solo con la copia completa."""
        for archivo in self.carpeta.iterdir():
            archivo.unlink()
        self.carpeta.rmdir()
        with self.assertRaises(URLError):
            self._registrar([self._respuestas()[0], URLError("sin metadatos")])
        self.assertFalse(self.carpeta.exists())
        self._registrar(self._respuestas())
        self.assertEqual(len(leer_json(self.procedencia)["archivos"]), 2)

    def test_huella_registrada_sigue_protegiendo_original_ausente(self) -> None:
        """La copia aislada conserva el rechazo aunque falte físicamente el original previo."""
        (self.carpeta / socrata.nombre_de_datos(CONJUNTO, DIA.isoformat())).unlink()
        antes = self._estado()
        with self.assertRaises(OriginalCambiado):
            self._registrar(self._respuestas(), aceptar=False)
        self.assertEqual(self._estado(), antes)

    def test_candidata_preexistente_sin_propiedad_se_conserva(self) -> None:
        """Un nombre coincidente nunca acredita propiedad ni autoriza retirar evidencia anterior."""
        antes = self._estado()
        huerfana = self.carpeta.parent / ".originales-socrata" / "candidata-corte-sintetico"
        huerfana.mkdir(parents=True)
        (huerfana / "parcial.json").write_text("no admitida", encoding="utf-8")
        with self.assertRaises(URLError):
            self._registrar([URLError("sin respuesta")])
        self.assertEqual((huerfana / "parcial.json").read_text(), "no admitida")
        self.assertEqual(self._estado(), antes)

    def test_copia_de_promocion_corrupta_no_se_admite(self) -> None:
        """La comprobación del árbol rechaza una copia de disco distinta de la candidata completa."""
        antes = self._estado()
        copiar = socrata.shutil.copytree

        def copia_corrupta(*argumentos: object, **opciones: object) -> Path:
            """Daña solo el árbol nuevo de publicación.

            Returns:
                La ruta creada por copytree.
            """
            resultado = copiar(*argumentos, **opciones)
            destino = Path(str(argumentos[1]))
            if destino.name == "originales.nuevo":
                (destino / "procedencia.json").write_text("dañada", encoding="utf-8")
            return resultado

        with patch.object(socrata.shutil, "copytree", copia_corrupta), self.assertRaises(OSError):
            self._registrar(self._respuestas())
        self.assertEqual(self._estado(), antes)

    def _intentos(self) -> list[Path]:
        """Localiza manifiestos propios para verificar evidencia; no autoriza limpiar por nombre.

        Returns:
            Los manifiestos encontrados bajo el control de esta prueba sintética.
        """
        return sorted((self.carpeta.parent / ".originales-socrata").glob("candidata-*/intento.json"))

    def test_fallo_metadatos_conserva_captura_y_causa_fuera_de_vigente(self) -> None:
        """El cuerpo recibido queda localizable aunque fracase la siguiente petición."""
        antes = self._estado()
        with self.assertRaises(URLError):
            self._registrar([self._respuestas()[0], URLError("metadatos fallidos")])
        self.assertEqual(self._estado(), antes)
        manifiestos = self._intentos()
        self.assertEqual(len(manifiestos), 1)
        manifiesto = leer_json(manifiestos[0])
        self.assertEqual(manifiesto["estado"], "fallido")
        self.assertEqual(manifiesto["error"]["tipo"], "URLError")
        self.assertIn("metadatos fallidos", manifiesto["error"]["mensaje"])
        capturas = list(manifiestos[0].parent.glob("capturas/*/respuesta.json"))
        self.assertEqual(len(capturas), 1)
        captura = leer_json(capturas[0])
        self.assertEqual((capturas[0].parent / captura["cuerpo"]).read_bytes(), DATOS_NUEVOS)
        self.assertEqual(captura["sha256"], hashlib.sha256(DATOS_NUEVOS).hexdigest())
        self.assertEqual(captura["url_final"], self._respuestas()[0].url_final)
        self.assertEqual(captura["capturado_utc"], CAPTURA_NUEVA)

    def test_rechazo_inmediato_conserva_el_cuerpo_no_admitido(self) -> None:
        """La política de cambio rechaza sin perder la respuesta nueva ni alterar lo vigente."""
        antes = self._estado()
        with self.assertRaises(OriginalCambiado):
            self._registrar(self._respuestas(), aceptar=False)
        self.assertEqual(self._estado(), antes)
        manifiestos = self._intentos()
        self.assertEqual(len(manifiestos), 1)
        manifiesto = leer_json(manifiestos[0])
        self.assertEqual(manifiesto["error"]["tipo"], "OriginalCambiado")
        captura = next(manifiestos[0].parent.glob("capturas/*/cuerpo.json"))
        self.assertEqual(captura.read_bytes(), DATOS_NUEVOS)

    def test_siguiente_intento_no_borra_fallidos_ni_completados(self) -> None:
        """Cada ejecución tiene identidad distinta y conserva el contenido de los intentos anteriores."""
        with self.assertRaises(URLError):
            self._registrar([self._respuestas()[0], URLError("metadatos fallidos")])
        self.assertEqual(len(self._intentos()), 1)
        primero = self._intentos()[0].parent
        evidencia = {p.relative_to(primero): p.read_bytes() for p in primero.rglob("*") if p.is_file()}
        self._registrar(self._respuestas())
        self.assertEqual(len(self._intentos()), 2)
        self.assertEqual({p.relative_to(primero): p.read_bytes() for p in primero.rglob("*") if p.is_file()}, evidencia)
        estados = {leer_json(p)["estado"] for p in self._intentos()}
        self.assertEqual(estados, {"fallido", "completado"})
        previos = {p: p.read_bytes() for m in self._intentos() for p in m.parent.rglob("*") if p.is_file()}
        with self.assertRaises(URLError):
            self._registrar([URLError("otro intento fallido")])
        self.assertEqual(len(self._intentos()), 3)
        self.assertEqual({p: p.read_bytes() for p in previos}, previos)

    def test_fallo_del_manifiesto_de_error_no_oculta_la_causa_original(self) -> None:
        """Aunque falle el diagnóstico JSON se preservan el cuerpo, la identidad y el error inicial."""
        guardar = socrata.guardar_json
        error = URLError("causa original en metadatos")

        def fallo(ruta: Path, contenido: object) -> None:
            """Rechaza únicamente la anotación de fallo, después de crear identidad y capturas.

            Raises:
                OSError: Si intenta escribir el manifiesto de fallo.
            """
            if ruta.name == "intento.json" and contenido.get("estado") == "fallido":
                raise OSError("no se puede escribir manifiesto de fallo")
            guardar(ruta, contenido)

        with patch.object(socrata, "guardar_json", fallo), self.assertRaises(URLError) as captura:
            self._registrar([self._respuestas()[0], error])
        self.assertIs(captura.exception, error)
        intento = self._intentos()[0].parent
        self.assertEqual(leer_json(intento / "intento.json")["estado"], "en_curso")
        self.assertIn("no se puede escribir manifiesto de fallo", " ".join(error.__notes__))
        self.assertIn(str(intento), " ".join(error.__notes__))
        alternativo = leer_json(intento / "fallo-manifiesto.txt")
        self.assertEqual(alternativo["error_original"]["tipo"], "URLError")
        self.assertEqual(next(intento.glob("capturas/*/cuerpo.json")).read_bytes(), DATOS_NUEVOS)

    def test_exito_retira_solo_la_copia_propia_redundante(self) -> None:
        """Tras publicar se conservan manifiesto y cuerpos, sin duplicar la carpeta histórica completa."""
        control = self.carpeta.parent / ".originales-socrata"
        ajena = control / "candidata-ajena"
        ajena.mkdir(parents=True)
        marca = ajena / "CONSERVAR.txt"
        marca.write_text("evidencia ajena", encoding="utf-8")
        historia = self.carpeta / "historia-no-descargada.json"
        historia.write_bytes(b"historia")
        self._registrar(self._respuestas())
        self.assertEqual(marca.read_text(), "evidencia ajena")
        manifiestos = self._intentos()
        self.assertEqual(len(manifiestos), 1)
        intento = manifiestos[0].parent
        self.assertEqual(leer_json(manifiestos[0])["estado"], "completado")
        self.assertFalse((intento / self.carpeta.name).exists())
        self.assertEqual(len(list(intento.glob("capturas/*/cuerpo.json"))), 2)
        self.assertEqual(historia.read_bytes(), b"historia")

    def test_fallo_antes_de_escribir_diagnosticos_conserva_causa_y_cuerpo(self) -> None:
        """Dos fallos de registro diagnóstico se anuncian en notas sin sustituir la excepción original."""
        error = URLError("metadatos rechazados")
        guardar = socrata.guardar_json
        abrir = Path.open

        def fallo_json(ruta: Path, contenido: object) -> None:
            """Impide solo guardar el estado fallido.

            Raises:
                OSError: Al registrar el fallo.
            """
            if ruta.name == "intento.json" and contenido.get("estado") == "fallido":
                raise OSError("diagnóstico JSON no disponible")
            guardar(ruta, contenido)

        def fallo_alternativo(ruta: Path, *argumentos: object, **opciones: object) -> object:
            """Impide solo la escritura diagnóstica alternativa.

            Returns:
                El archivo que abre realmente Path.open.

            Raises:
                OSError: Al abrir el diagnóstico alternativo.
            """
            if ruta.name == "fallo-manifiesto.txt":
                raise OSError("diagnóstico alternativo no disponible")
            return abrir(ruta, *argumentos, **opciones)

        with (
            patch.object(socrata, "guardar_json", fallo_json),
            patch.object(Path, "open", fallo_alternativo),
            self.assertRaises(URLError) as captura,
        ):
            self._registrar([self._respuestas()[0], error])
        self.assertIs(captura.exception, error)
        intento = self._intentos()[0].parent
        self.assertIn("diagnóstico alternativo no disponible", " ".join(error.__notes__))
        self.assertEqual(next(intento.glob("capturas/*/cuerpo.json")).read_bytes(), DATOS_NUEVOS)

    def test_api_previa_de_descargar_copia_sin_capturas_es_compatible(self) -> None:
        """La primitiva conserva sus cuatro argumentos y fecha registrada cuando no se pide archivo de capturas."""
        with (
            patch.object(red, "descargar_url", side_effect=self._respuestas(DATOS_PREVIOS, METADATOS_PREVIOS)),
            patch.object(socrata.time, "sleep"),
            redirect_stdout(io.StringIO()),
        ):
            registros = socrata.descargar_copia(self.conjuntos, DIA.isoformat(), self.carpeta, False)
        self.assertEqual(len(registros), 2)
        self.assertTrue(all(r["descargado_utc"] == CAPTURA_PREVIA for r in registros))
        self.assertEqual(self._intentos(), [])

    def test_fallo_del_manifiesto_inicial_deja_identidad_alternativa_sin_descargar(self) -> None:
        """Si no puede iniciar el manifiesto tampoco inicia HTTP y conserva identidad en el diagnóstico alternativo."""
        antes = self._estado()
        error = OSError("manifiestos no disponibles")
        with (
            patch.object(socrata, "guardar_json", side_effect=error),
            patch.object(red, "descargar_url") as transporte,
            self.assertRaises(OSError) as captura,
        ):
            socrata.registrar_copia(
                self.conjuntos, socrata.RutasDeLaCopia(self.carpeta, self.procedencia), {}, True, DIA
            )
        self.assertIs(captura.exception, error)
        transporte.assert_not_called()
        self.assertEqual(self._estado(), antes)
        control = self.carpeta.parent / ".originales-socrata"
        alternativo = next(control.glob("candidata-*/fallo-manifiesto.txt"))
        identidad = leer_json(alternativo)
        self.assertEqual(identidad["propietario"], "socrata.registrar_copia")
        self.assertEqual(identidad["intento"], alternativo.parent.name)
        self.assertEqual(identidad["originales"], str(self.carpeta))


if __name__ == "__main__":
    unittest.main()
