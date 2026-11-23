"""La confianza TLS se transmite al opener real antes de cualquier envío."""

import contextlib
import hashlib
import io
import json
import os
import shutil
import ssl
import subprocess
import tempfile
import unittest
from datetime import UTC, datetime
from http.client import HTTPResponse
from pathlib import Path
from unittest.mock import patch
from urllib.request import HTTPSHandler, Request

from plataforma_datos.comun import confianza_tls as tls
from plataforma_datos.comun import red
from plataforma_datos.cursos.fuentes.barcelonactiva import robot_cibernarium as robot


class PruebaEntradasTLS(unittest.TestCase):
    """Los openers propios no pueden volver a confiar implícitamente en el sistema."""

    def test_openers_reciben_contexto_explicito(self) -> None:
        """Los dos transportes reutilizan TLS verificado sin abrir sockets."""
        for modulo in (red, robot):
            with self.subTest(modulo=modulo.__name__), patch.object(modulo, "build_opener") as crear:
                if modulo is red:
                    red.abrir_peticion(Request("https://ejemplo.invalid"), 1)
                else:
                    robot.abrir_serial(Request("https://ejemplo.invalid"), timeout=1, pausa=2)
                handlers = [h for h in crear.call_args.args if isinstance(h, HTTPSHandler)]
                self.assertEqual(len(handlers), 1)
                self.assertIsInstance(handlers[0]._context, ssl.SSLContext)
                self.assertTrue(handlers[0]._context.check_hostname)
                self.assertEqual(handlers[0]._context.verify_mode, ssl.CERT_REQUIRED)


# Raíces de eMudhra que la lista de Mozilla del 20/10/2026 no contiene: el paquete oficial de raíces tampoco las trae.
G3 = "86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b"
C3 = "bc4d809b15189d78db3e1d8cf4f9726a795da1643ca5f1358e1ddb0edc0d7eb3"
C1 = "125609aa301da0a249b97a8239cb6a34216f44dcac9f3954b14292f2e8c8608f"
RAICES_OFICIALES = 118


def negociar(cliente: ssl.SSLContext, servidor: ssl.SSLContext, hostname: str) -> None:
    """Negocia TLS enteramente en memoria con un certificado sintético público.

    Raises:
        ssl.SSLError: Si la cadena o el hostname no se verifican.
        AssertionError: Si la negociación no termina en las rondas acotadas.
    """
    entrada_cliente, salida_cliente = ssl.MemoryBIO(), ssl.MemoryBIO()
    entrada_servidor, salida_servidor = ssl.MemoryBIO(), ssl.MemoryBIO()
    objetos = (
        (cliente.wrap_bio(entrada_cliente, salida_cliente, server_hostname=hostname), salida_cliente, entrada_servidor),
        (servidor.wrap_bio(entrada_servidor, salida_servidor, server_side=True), salida_servidor, entrada_cliente),
    )
    completos: set[ssl.SSLObject] = set()
    for _ in range(16):
        for objeto, salida, destino in objetos:
            try:
                objeto.do_handshake()
                completos.add(objeto)
            except (ssl.SSLWantReadError, ssl.SSLWantWriteError):
                pass
            if salida.pending:
                destino.write(salida.read())
        if len(completos) == len(objetos):
            return
    raise AssertionError("La negociación TLS sintética no ha terminado.")


class PruebaConfianzaTLS(unittest.TestCase):
    """Una versión y unos bytes oficiales, independientes del Mac y de su configuración ambiental."""

    def test_contextos_runtime_y_bootstrap_son_la_misma_confianza(self) -> None:
        """Las 118 raíces oficiales, sin G3, C1 ni C3, y la misma confianza en runtime y bootstrap."""
        inventarios = []
        intermedios = {i.sha256 for i in tls.INTERMEDIOS}
        for contexto in (tls.contexto_tls(), tls.contexto_tls_bootstrap()):
            huellas = {hashlib.sha256(c).hexdigest() for c in contexto.get_ca_certs(binary_form=True)} - intermedios
            self.assertTrue(huellas)
            self.assertEqual(len(huellas), RAICES_OFICIALES)
            self.assertFalse({G3, C1, C3} & huellas)
            self.assertTrue(contexto.check_hostname)
            self.assertEqual(contexto.verify_mode, ssl.CERT_REQUIRED)
            self.assertGreaterEqual(contexto.minimum_version, ssl.TLSVersion.TLSv1_2)
            inventarios.append(huellas)
        self.assertEqual(inventarios[0], inventarios[1])
        self.assertEqual(hashlib.sha256(tls.ruta_ca_runtime_verificada().read_bytes()).hexdigest(), tls.CA_SHA256)

    def test_bootstrap_no_importa_certifi_ni_carga_ca_ambientales(self) -> None:
        """Funciona antes del venv; variables hostiles no añaden raíces implícitas."""
        with (
            patch.dict(os.environ, {"SSL_CERT_FILE": "/no-usar", "SSL_CERT_DIR": "/no-usar"}),
            patch.object(ssl.SSLContext, "load_default_certs", side_effect=AssertionError("CA ambiental")),
            patch.object(tls, "_runtime", side_effect=AssertionError("Runtime aún no preparado")),
        ):
            self.assertTrue(tls.contexto_tls_bootstrap().check_hostname)

    def test_runtime_version_ajena_o_ausente_no_usa_semilla(self) -> None:
        """La semilla no funciona como respaldo silencioso de un runtime incompleto."""
        for problema in ("2024.8.30", tls.PackageNotFoundError("certifi")):
            with (
                self.subTest(problema=type(problema).__name__),
                patch.object(tls, "version") as consultar,
                self.assertRaises(tls.ErrorConfianzaTLS),
            ):
                if isinstance(problema, Exception):
                    consultar.side_effect = problema
                else:
                    consultar.return_value = problema
                tls.contexto_tls()

    def test_ca_runtime_alterada_o_enlazada_se_rechaza(self) -> None:
        """Misma versión no acredita bytes diferentes ni una ruta sustituta simbólica."""
        import certifi

        with tempfile.TemporaryDirectory() as nombre:
            ruta = Path(nombre) / "ca.pem"
            ruta.write_bytes(tls.ruta_ca_runtime_verificada().read_bytes() + b"x")
            with patch.object(certifi, "where", return_value=str(ruta)), self.assertRaises(tls.ErrorConfianzaTLS):
                tls.contexto_tls()
            ruta.unlink()
            ruta.symlink_to(tls.RECURSOS / "cacert.pem")
            with patch.object(certifi, "where", return_value=str(ruta)), self.assertRaises(tls.ErrorConfianzaTLS):
                tls.ruta_ca_runtime_verificada()

    def test_semilla_licencia_y_procedencia_faltantes_o_corruptas_fallan(self) -> None:
        """Ningún fichero faltante o alterado permite volver al almacén del sistema."""
        with tempfile.TemporaryDirectory() as nombre:
            copia = Path(nombre) / "confianza"
            shutil.copytree(tls.RECURSOS, copia)
            for archivo in ("cacert.pem", "LICENSE", "procedencia.json"):
                ruta = copia / archivo
                original = ruta.read_bytes()
                for contenido in (None, original + b"x"):
                    with self.subTest(archivo=archivo, ausente=contenido is None):
                        if contenido is None:
                            ruta.unlink()
                        else:
                            ruta.write_bytes(contenido)
                        with patch.object(tls, "RECURSOS", copia), self.assertRaises(tls.ErrorConfianzaTLS):
                            tls.contexto_tls_bootstrap()
                        ruta.write_bytes(original)

    def test_tls_real_rechaza_ca_ajena_y_hostname_incorrecto(self) -> None:
        """Cadena válida solo en fixture; la CA de producción no confía en ese certificado."""
        fixtures = Path(__file__).resolve().parents[3] / "pruebas/navegadores"
        certificado = fixtures / "tls-sintetico.pem"
        servidor = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        servidor.load_cert_chain(certificado, fixtures / "tls-clave-sintetica.pem")
        with self.assertRaises(ssl.SSLCertVerificationError):
            negociar(tls.contexto_tls(), servidor, "localhost")
        confianza_fixture = tls._contexto(certificado.read_bytes())
        negociar(confianza_fixture, servidor, "localhost")
        with self.assertRaises(ssl.SSLCertVerificationError):
            negociar(confianza_fixture, servidor, "otra-identidad.invalid")

    def test_instalacion_runtime_real_cumple_versiones_y_ca_fijadas(self) -> None:
        """El entorno que ejecuta las comprobaciones debe llevar pip y certifi realmente admitidos."""
        tls.comprobar_instalacion()

    def test_comprobacion_final_rechaza_pip_ajeno_o_ausente(self) -> None:
        """La preparación solo admite el instalador fijado junto al certifi verificado."""
        for problema in ("25.0.1", tls.PackageNotFoundError("pip")):

            def consultar(nombre: str, problema_actual: str | Exception = problema) -> str:
                if nombre == "certifi":
                    return tls.CERTIFI_VERSION
                if isinstance(problema_actual, Exception):
                    raise problema_actual
                return problema_actual

            with (
                self.subTest(problema=type(problema).__name__),
                patch.object(tls, "version", side_effect=consultar),
                self.assertRaises(tls.ErrorConfianzaTLS),
            ):
                tls.comprobar_instalacion()

    def test_sslkeylogfile_no_escribe_secretos_ni_configura_contextos(self) -> None:
        """El ambiente no puede habilitar un archivo de secretos TLS."""
        with tempfile.TemporaryDirectory() as nombre:
            ruta = Path(nombre) / "no-crear.log"
            with patch.dict(os.environ, {"SSLKEYLOGFILE": str(ruta)}):
                for crear in (tls.contexto_tls, tls.contexto_tls_bootstrap):
                    contexto = crear()
                    self.assertIsNone(contexto.keylog_filename)
                    self.assertFalse(ruta.exists())

    def test_runtime_no_carga_ca_del_sistema(self) -> None:
        """Un contexto nuevo no incorpora el truststore ambiental aunque exista."""
        with (
            patch.dict(os.environ, {"SSL_CERT_FILE": "/no-usar", "SSL_CERT_DIR": "/no-usar"}),
            patch.object(ssl.SSLContext, "load_default_certs", side_effect=AssertionError("CA ambiental")),
        ):
            self.assertTrue(tls.contexto_tls().check_hostname)


def openssl(*argumentos: str) -> None:
    """Ejecuta la orden `openssl` para fabricar certificados de prueba.

    Raises:
        subprocess.CalledProcessError: Si OpenSSL falla.
    """
    subprocess.run(["openssl", *argumentos], check=True, capture_output=True)


CONFIGURACION_DE_PRUEBA = """[req]
distinguished_name = dn
prompt = no
[dn]
CN = {nombre}
[autoridad]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
[hoja]
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature
subjectAltName = DNS:servidor.prueba
"""
SERVIDOR_DE_PRUEBA = "servidor.prueba"


class Emitido:
    """Un certificado de prueba y su clave, en archivos PEM de una carpeta temporal."""

    def __init__(self, carpeta: Path, nombre: str, emisor: "Emitido | None", extension: str) -> None:
        configuracion = carpeta / "configuracion.cnf"
        configuracion.write_text(CONFIGURACION_DE_PRUEBA.format(nombre=nombre))
        self.nombre = nombre
        self.clave, self.certificado = carpeta / f"{nombre}-clave.pem", carpeta / f"{nombre}.pem"
        openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(self.clave))
        if emisor is None:
            openssl(
                *("req", "-new", "-x509", "-key", str(self.clave), "-sha256", "-days", "2"),
                *("-config", str(configuracion), "-extensions", extension, "-out", str(self.certificado)),
            )
            return
        solicitud = carpeta / f"{nombre}.csr"
        openssl(
            *("req", "-new", "-key", str(self.clave), "-config", str(configuracion)),
            *("-out", str(solicitud)),
        )
        openssl(
            *("x509", "-req", "-in", str(solicitud), "-CA", str(emisor.certificado), "-CAkey", str(emisor.clave)),
            *("-CAcreateserial", "-sha256", "-days", "2", "-extfile", str(configuracion), "-extensions", extension),
            *("-out", str(self.certificado)),
        )

    def declarar(self, emisor: str, archivo: str | None = None) -> tls.Intermedio:
        """El certificado como entrada de intermedio, con la huella y el tamaño que tiene.

        Returns:
            La entrada con el emisor dado.
        """
        der = ssl.PEM_cert_to_DER_cert(self.certificado.read_text())
        return tls.Intermedio(
            nombre=self.nombre,
            archivo=archivo or self.certificado.name,
            sha256=hashlib.sha256(der).hexdigest(),
            tamano=len(der),
            emisor=emisor,
            caduca="",
            origen="prueba",
            obtenido="",
        )


class CadenaDePrueba:
    """Una autoridad de pruebas con dos intermedios encadenados y una hoja, como la cadena de FUNDAE."""

    def __init__(self, carpeta: Path) -> None:
        self.carpeta = carpeta
        self.raiz = Emitido(carpeta, "raiz", None, "autoridad")
        self.primero = Emitido(carpeta, "primero", self.raiz, "autoridad")
        self.segundo = Emitido(carpeta, "segundo", self.primero, "autoridad")
        self.hoja = Emitido(carpeta, "hoja", self.segundo, "hoja")
        self.intermedios = (self.primero.declarar("raiz"), self.segundo.declarar("primero"))

    def cliente(self) -> ssl.SSLContext:
        """Contexto que solo confía en la raíz de prueba.

        Returns:
            El contexto, con la misma construcción que el de Faro.
        """
        return tls._contexto(self.raiz.certificado.read_bytes())

    def servidor(self) -> ssl.SSLContext:
        """Servidor que solo envía la hoja, sin sus intermedios.

        Returns:
            El contexto de servidor.
        """
        servidor = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        servidor.load_cert_chain(self.hoja.certificado, self.hoja.clave)
        return servidor


class PruebaIntermediosConocidos(unittest.TestCase):
    """Los intermedios se comprueban uno a uno antes de cargarlos y uno malo no tumba el contexto."""

    def setUp(self) -> None:
        """Una carpeta temporal y los avisos de cada prueba, sin los ya dados en el proceso."""
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.carpeta = Path(carpeta.name)
        self.avisos = io.StringIO()
        avisados = patch.object(tls, "_AVISADOS", set())
        avisados.start()
        self.addCleanup(avisados.stop)

    def cargar(
        self, contexto: ssl.SSLContext, intermedios: tuple[tls.Intermedio, ...], ahora: float | None = None
    ) -> str:
        """Carga los intermedios en el contexto y devuelve lo que se avisó.

        Returns:
            El texto escrito en la salida de errores.
        """
        reloj = datetime.now(UTC).timestamp() if ahora is None else ahora
        with contextlib.redirect_stderr(self.avisos):
            tls._cargar_intermedios(contexto, intermedios, self.carpeta, reloj)
        return self.avisos.getvalue()

    def huellas(self, contexto: ssl.SSLContext) -> set[str]:
        """Las huellas de todo lo que el contexto tiene como autoridad.

        Returns:
            Las huellas en minúsculas.
        """
        return {hashlib.sha256(c).hexdigest() for c in contexto.get_ca_certs(binary_form=True)}

    def test_los_dos_intermedios_declarados_se_cargan_con_su_huella(self) -> None:
        """Cada PEM es el certificado declarado: huella, tamaño, caducidad y emisor; y el contexto lo tiene."""
        completo = tls.contexto_tls()
        declaradas = set()
        for intermedio in tls.INTERMEDIOS:
            with self.subTest(intermedio=intermedio.nombre):
                der = ssl.PEM_cert_to_DER_cert((tls.RECURSOS / "intermedios" / intermedio.archivo).read_text())
                self.assertEqual(hashlib.sha256(der).hexdigest(), intermedio.sha256)
                self.assertEqual(len(der), intermedio.tamano)
                examen = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                examen.load_verify_locations(cadata=der)
                (certificado,) = examen.get_ca_certs()
                caduca = datetime.fromtimestamp(ssl.cert_time_to_seconds(certificado["notAfter"]), UTC).date()
                self.assertEqual(caduca.isoformat(), intermedio.caduca)
                self.assertEqual(tls._ultimo_componente(certificado["issuer"]), intermedio.emisor)
                self.assertIn(intermedio.sha256, self.huellas(completo))
                declaradas.add(intermedio.sha256)
        self.assertEqual(len(completo.get_ca_certs()), RAICES_OFICIALES + len(declaradas))
        self.assertEqual(
            {"ac-raiz-fnmt-servidores-seguros-g2r.pem", "ac-servidores-seguros-tipo2-g2r.pem"},
            {i.archivo for i in tls.INTERMEDIOS},
        )
        self.assertEqual(
            {p.name for p in (tls.RECURSOS / "intermedios").iterdir()}, {i.archivo for i in tls.INTERMEDIOS}
        )

    def test_el_descriptor_de_procedencia_dice_lo_mismo_que_el_codigo(self) -> None:
        """`procedencia.json` declara cada intermedio con los mismos datos que `INTERMEDIOS`."""
        descriptor = json.loads((tls.RECURSOS / "procedencia.json").read_text(encoding="utf-8"))
        esperado = [
            {
                "nombre": i.nombre,
                "archivo": f"intermedios/{i.archivo}",
                "bytes": i.tamano,
                "sha256": i.sha256,
                "emisor": i.emisor,
                "caduca": i.caduca,
                "origen": i.origen,
                "obtenido": i.obtenido,
            }
            for i in tls.INTERMEDIOS
        ]
        self.assertEqual(descriptor["intermedios"], esperado)

    def test_no_hay_intermedios_en_el_contexto_de_bootstrap(self) -> None:
        """Lo que usan pip y la preparación no cambia: solo las raíces."""
        huellas = self.huellas(tls.contexto_tls_bootstrap())
        self.assertEqual(len(huellas), RAICES_OFICIALES)
        self.assertFalse({i.sha256 for i in tls.INTERMEDIOS} & huellas)

    def copiar_recursos(self) -> Path:
        """Una copia de los recursos reales en la carpeta temporal.

        Returns:
            La carpeta de la copia.
        """
        copia = self.carpeta / "confianza"
        shutil.copytree(tls.RECURSOS, copia)
        return copia

    def test_un_intermedio_alterado_no_se_carga_y_el_contexto_sigue(self) -> None:
        """Con un byte cambiado en el certificado, solo falta ese; el otro y las raíces siguen."""
        copia = self.copiar_recursos()
        alterado = copia / "intermedios" / tls.INTERMEDIOS[1].archivo
        lineas = alterado.read_text().splitlines()
        lineas[10] = ("B" if lineas[10][0] == "A" else "A") + lineas[10][1:]
        alterado.write_text("\n".join(lineas) + "\n")
        with patch.object(tls, "RECURSOS", copia), contextlib.redirect_stderr(self.avisos):
            contexto = tls.contexto_tls()
        huellas = self.huellas(contexto)
        self.assertNotIn(tls.INTERMEDIOS[1].sha256, huellas)
        self.assertIn(tls.INTERMEDIOS[0].sha256, huellas)
        self.assertEqual(len(huellas), RAICES_OFICIALES + 1)
        self.assertIn(tls.INTERMEDIOS[1].nombre, self.avisos.getvalue())
        self.assertIn("no es el certificado declarado", self.avisos.getvalue())

    def test_un_intermedio_ausente_o_enlazado_no_se_carga(self) -> None:
        """Un archivo que falta o que es un enlace simbólico se trata como un intermedio no verificado."""
        copia = self.copiar_recursos()
        primero, segundo = (copia / "intermedios" / i.archivo for i in tls.INTERMEDIOS)
        primero.unlink()
        original = segundo.read_bytes()
        segundo.unlink()
        enlace = self.carpeta / "enlace.pem"
        enlace.write_bytes(original)
        segundo.symlink_to(enlace)
        with patch.object(tls, "RECURSOS", copia), contextlib.redirect_stderr(self.avisos):
            contexto = tls.contexto_tls()
        self.assertEqual(len(contexto.get_ca_certs()), RAICES_OFICIALES)
        self.assertIn("no se puede leer", self.avisos.getvalue())

    def test_un_intermedio_caducado_no_se_carga_y_el_otro_si(self) -> None:
        """Con el reloj tras la caducidad del primero y antes de la del segundo, solo se carga el segundo."""
        despues = datetime(2030, 1, 1, tzinfo=UTC).timestamp()
        with patch.object(tls, "_ahora", return_value=despues), contextlib.redirect_stderr(self.avisos):
            contexto = tls.contexto_tls()
        huellas = self.huellas(contexto)
        self.assertNotIn(tls.INTERMEDIOS[0].sha256, huellas)
        self.assertIn(tls.INTERMEDIOS[1].sha256, huellas)
        self.assertIn("ha caducado", self.avisos.getvalue())
        self.assertIn(tls.INTERMEDIOS[0].nombre, self.avisos.getvalue())

    def test_un_intermedio_no_caducado_ni_avisa(self) -> None:
        """Con el reloj de hoy no se escribe ningún aviso."""
        with contextlib.redirect_stderr(self.avisos):
            tls.contexto_tls()
        self.assertEqual(self.avisos.getvalue(), "")

    def test_el_aviso_se_da_una_vez_por_intermedio_y_motivo(self) -> None:
        """Cada conexión construye un contexto, pero el aviso no se repite."""
        despues = datetime(2030, 1, 1, tzinfo=UTC).timestamp()
        with patch.object(tls, "_ahora", return_value=despues), contextlib.redirect_stderr(self.avisos):
            tls.contexto_tls()
            tls.contexto_tls()
        self.assertEqual(self.avisos.getvalue().count("ha caducado"), 1)

    def test_un_autofirmado_no_se_carga_como_intermedio(self) -> None:
        """Una raíz, aunque sea una autoridad, nunca entra por la lista de intermedios."""
        cadena = CadenaDePrueba(self.carpeta)
        autofirmado = cadena.raiz.declarar("raiz")
        contexto = cadena.cliente()
        antes = len(contexto.get_ca_certs())
        # La propia raíz de prueba ya está en el contexto; se comprueba con una distinta.
        otra = Emitido(self.carpeta, "otra", None, "autoridad")
        aviso = self.cargar(contexto, (otra.declarar("otra"), autofirmado))
        self.assertEqual(len(contexto.get_ca_certs()), antes)
        self.assertEqual(aviso.count("es autofirmado"), 2)

    def test_un_certificado_que_no_es_autoridad_no_se_carga(self) -> None:
        """Una hoja con CA:FALSE no entra como intermedio."""
        cadena = CadenaDePrueba(self.carpeta)
        contexto = cadena.cliente()
        aviso = self.cargar(contexto, (cadena.hoja.declarar("segundo"),))
        self.assertEqual(len(contexto.get_ca_certs()), 1)
        self.assertIn("no es un certificado de autoridad", aviso)

    def test_un_emisor_distinto_del_esperado_no_se_carga(self) -> None:
        """El emisor declarado forma parte de la comprobación."""
        cadena = CadenaDePrueba(self.carpeta)
        contexto = cadena.cliente()
        aviso = self.cargar(contexto, (cadena.primero.declarar("otra autoridad"),))
        self.assertEqual(len(contexto.get_ca_certs()), 1)
        self.assertIn("su emisor no es el esperado", aviso)

    def test_el_tamano_declarado_es_exacto(self) -> None:
        """Un tamaño declarado distinto del real basta para no cargarlo."""
        cadena = CadenaDePrueba(self.carpeta)
        declarado = cadena.primero.declarar("raiz")
        erroneo = tls.Intermedio(**{**declarado.__dict__, "tamano": declarado.tamano + 1})
        contexto = cadena.cliente()
        self.assertIn("no es el certificado declarado", self.cargar(contexto, (erroneo,)))
        self.assertEqual(len(contexto.get_ca_certs()), 1)

    def test_la_cadena_se_completa_con_los_intermedios_y_falla_sin_ellos(self) -> None:
        """Hoja, dos intermedios y raíz: el servidor solo envía la hoja y la verificación necesita los intermedios."""
        cadena = CadenaDePrueba(self.carpeta)
        with self.assertRaises(ssl.SSLCertVerificationError):
            negociar(cadena.cliente(), cadena.servidor(), SERVIDOR_DE_PRUEBA)
        solo_uno = cadena.cliente()
        self.cargar(solo_uno, cadena.intermedios[:1])
        with self.assertRaises(ssl.SSLCertVerificationError):
            negociar(solo_uno, cadena.servidor(), SERVIDOR_DE_PRUEBA)
        completo = cadena.cliente()
        self.assertEqual(self.cargar(completo, cadena.intermedios), "")
        negociar(completo, cadena.servidor(), SERVIDOR_DE_PRUEBA)
        with self.assertRaises(ssl.SSLCertVerificationError):
            negociar(completo, cadena.servidor(), "otra-identidad.invalid")

    def test_los_intermedios_no_son_raices_de_confianza(self) -> None:
        """Una hoja emitida por un intermedio cuya raíz no está en el contexto no se verifica."""
        cadena = CadenaDePrueba(self.carpeta)
        ajeno = tls._contexto(Emitido(self.carpeta, "ajena", None, "autoridad").certificado.read_bytes())
        self.cargar(ajeno, cadena.intermedios)
        with self.assertRaises(ssl.SSLCertVerificationError):
            negociar(ajeno, cadena.servidor(), SERVIDOR_DE_PRUEBA)

    def test_la_cadena_parcial_sigue_apagada(self) -> None:
        """Ningún contexto de Faro enciende `VERIFY_X509_PARTIAL_CHAIN` ni relaja la verificación."""
        for dominio in (None, "agora.fundae.es", "portaldogc.gencat.cat"):
            contexto = tls.contexto_tls(dominio)
            with self.subTest(dominio=dominio):
                self.assertFalse(contexto.verify_flags & ssl.VERIFY_X509_PARTIAL_CHAIN)
                self.assertEqual(contexto.verify_mode, ssl.CERT_REQUIRED)
                self.assertTrue(contexto.check_hostname)


class PruebaCifradosHeredados(unittest.TestCase):
    """Un cifrado antiguo solo se permite al dominio exacto que lo necesita."""

    def nombres(self, contexto: ssl.SSLContext) -> set[str]:
        """Los cifrados que el contexto negocia.

        Returns:
            Sus nombres OpenSSL.
        """
        return {c["name"] for c in contexto.get_ciphers()}

    def test_el_dominio_de_la_lista_recibe_su_cifrado_y_los_demas_no(self) -> None:
        """`portaldogc.gencat.cat` negocia AES256-SHA; el contexto sin dominio y el de otros no."""
        self.assertEqual(set(tls.CIFRADOS_HEREDADOS), {"portaldogc.gencat.cat"})
        self.assertIn("AES256-SHA", self.nombres(tls.contexto_tls("portaldogc.gencat.cat")))
        for dominio in (None, "agora.fundae.es", "gencat.cat", "ejemplo.invalid"):
            with self.subTest(dominio=dominio):
                self.assertNotIn("AES256-SHA", self.nombres(tls.contexto_tls(dominio)))

    def test_ni_subdominios_ni_dominios_parecidos_lo_reciben(self) -> None:
        """La lista es de nombres exactos: sin comodines, subdominios, sufijos ni prefijos."""
        for dominio in (
            "www.portaldogc.gencat.cat",
            "portaldogc.gencat.cat.ejemplo.invalid",
            "xportaldogc.gencat.cat",
            "portaldogc.gencat.cat.",
            "PORTALDOGC.gencat.cat",
            "portaldogc-gencat.cat",
            "",
        ):
            with self.subTest(dominio=dominio):
                self.assertNotIn("AES256-SHA", self.nombres(tls.contexto_tls(dominio)))

    def test_el_contexto_del_dominio_solo_anade_el_cifrado(self) -> None:
        """Misma verificación, misma versión mínima, mismas raíces; los cifrados, los modernos más el heredado."""
        normal, heredado = tls.contexto_tls(), tls.contexto_tls("portaldogc.gencat.cat")
        self.assertEqual(heredado.verify_mode, normal.verify_mode)
        self.assertEqual(heredado.check_hostname, normal.check_hostname)
        self.assertEqual(heredado.verify_flags, normal.verify_flags)
        self.assertEqual(heredado.minimum_version, normal.minimum_version)
        self.assertEqual(heredado.maximum_version, normal.maximum_version)
        self.assertEqual(heredado.get_ca_certs(binary_form=True), normal.get_ca_certs(binary_form=True))
        self.assertEqual(self.nombres(heredado) - self.nombres(normal), {"AES256-SHA"})
        self.assertLessEqual(self.nombres(normal), self.nombres(heredado))

    def test_cada_entrada_declara_su_motivo_y_su_evidencia(self) -> None:
        """Una entrada sin porqué o sin fecha no tiene sentido en la lista."""
        for dominio, heredado in tls.CIFRADOS_HEREDADOS.items():
            with self.subTest(dominio=dominio):
                self.assertTrue(heredado.cifrado and heredado.motivo)
                self.assertTrue(datetime.strptime(heredado.evidencia, "%Y-%m-%d"))
                self.assertEqual(dominio, dominio.lower())
                self.assertNotIn("*", dominio)

    def test_un_cifrado_que_openssl_no_admite_falla_con_el_error_de_la_confianza(self) -> None:
        """No se sigue en silencio con un contexto distinto del pedido."""
        with self.assertRaises(tls.ErrorConfianzaTLS):
            tls._permitir_cifrado(tls.contexto_tls(), "NO-EXISTE")


class ConexionFalsa:
    """Conexión que no abre sockets: anota el contexto con el que se pidió y contesta según el servidor."""

    registro: list[tuple[str, ssl.SSLContext]] = []

    def __init__(self, host: str, timeout: float | None = None, context: ssl.SSLContext | None = None) -> None:
        self.host, self.sock = host, None
        assert context is not None
        self.registro.append((host, context))

    def set_debuglevel(self, _nivel: int) -> None:
        """No registra nada."""

    def request(self, *_argumentos: object, **_opciones: object) -> None:
        """No envía nada."""

    def getresponse(self) -> HTTPResponse:
        """La respuesta de cada servidor: portaldogc redirige a otro dominio; el otro contesta.

        Returns:
            Una respuesta HTTP real, construida desde bytes.
        """
        if self.host == "portaldogc.gencat.cat":
            texto = b"HTTP/1.1 302 Found\r\nLocation: https://otro.ejemplo.invalid/x\r\nContent-Length: 0\r\n\r\n"
        else:
            texto = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"
        conector = type("Conector", (), {"makefile": lambda _yo, _modo: io.BytesIO(texto)})()
        respuesta = HTTPResponse(conector)  # type: ignore[arg-type]
        respuesta.begin()
        return respuesta

    def close(self) -> None:
        """No hay nada que cerrar."""


class PruebaContextoPorDominioEnLaRed(unittest.TestCase):
    """`red` pide a cada conexión el contexto de su dominio, también tras una redirección."""

    def setUp(self) -> None:
        """Vacía el registro de conexiones."""
        ConexionFalsa.registro = []

    def pedir(self, url: str) -> bytes:
        """Abre la petición con el abridor real y conexiones falsas.

        Returns:
            El cuerpo de la respuesta final.
        """
        with (
            patch.object(red, "HTTPSConnection", ConexionFalsa),
            patch.object(red, "registrar_redireccion"),
            red.abrir_peticion(Request(url, headers={"User-Agent": red.agente_de_usuario()}), 1) as respuesta,
        ):
            return respuesta.read()

    def test_el_dominio_de_la_lista_conecta_con_su_cifrado(self) -> None:
        """La petición directa a `portaldogc.gencat.cat` lleva un contexto que admite AES256-SHA."""
        self.pedir("https://portaldogc.gencat.cat/documento.pdf")
        host, contexto = ConexionFalsa.registro[0]
        self.assertEqual(host, "portaldogc.gencat.cat")
        self.assertIn("AES256-SHA", {c["name"] for c in contexto.get_ciphers()})

    def test_otro_dominio_conecta_con_el_contexto_de_siempre(self) -> None:
        """Un dominio que no está en la lista no recibe el cifrado, ni uno parecido."""
        for url in (
            "https://agora.fundae.es/",
            "https://www.portaldogc.gencat.cat/",
            "https://portaldogc.gencat.cat.x.invalid/",
        ):
            ConexionFalsa.registro = []
            with self.subTest(url=url):
                self.assertEqual(self.pedir(url), b"ok")
                ((_host, contexto),) = ConexionFalsa.registro
                self.assertNotIn("AES256-SHA", {c["name"] for c in contexto.get_ciphers()})

    def test_una_redireccion_fuera_de_la_lista_vuelve_al_contexto_normal(self) -> None:
        """Del dominio de la lista a otro: la primera conexión admite el cifrado y la segunda no."""
        self.assertEqual(self.pedir("https://portaldogc.gencat.cat/documento.pdf"), b"ok")
        (primero, contexto_inicial), (segundo, contexto_final) = ConexionFalsa.registro
        self.assertEqual((primero, segundo), ("portaldogc.gencat.cat", "otro.ejemplo.invalid"))
        self.assertIn("AES256-SHA", {c["name"] for c in contexto_inicial.get_ciphers()})
        self.assertNotIn("AES256-SHA", {c["name"] for c in contexto_final.get_ciphers()})


if __name__ == "__main__":
    unittest.main()
