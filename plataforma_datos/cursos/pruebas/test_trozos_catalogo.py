"""Conservación por trozos: reconstrucción exacta, verificación, límites y migración."""

import base64
import hashlib
import json
import os
import random
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import operacion_fuente
from plataforma_datos.cursos import recepciones_catalogo as recepciones
from plataforma_datos.cursos import trozos_catalogo as trozos
from plataforma_datos.cursos.auditoria_snapshot_catalogo import ErrorAdmisionCatalogo
from plataforma_datos.cursos.contrato_entrega_catalogo import ErrorEntregaCatalogo
from plataforma_datos.cursos.trozos_catalogo import ErrorTrozos

MIEMBROS = 100


def pagina(dia: int, cambiados: frozenset[int] = frozenset()) -> bytes:
    """Página sintética parecida al catálogo real: materiales con base64 y actividades por miembro.

    Returns:
        JSON de varios MB; solo cambian las actividades de los miembros indicados.
    """
    azar = random.Random(7)
    miembros = []
    for numero in range(MIEMBROS):
        imagen = base64.b64encode(azar.randbytes(45_000)).decode()
        actividad = dia if numero in cambiados else 0
        miembros.append(
            {
                "id": numero,
                "activities": [{"fecha": f"2026-10-{actividad + 1:02d}", "plazas": numero + actividad}],
                "activityCatalogMaterials": [{"titulo": f"Material {numero}", "imagen": imagen}],
            }
        )
    return json.dumps({"hydra:member": miembros}, separators=(",", ":")).encode()


class TrozosPruebas(unittest.TestCase):
    """Cada cuerpo se reconstruye byte a byte y nunca se devuelve sin verificar."""

    @classmethod
    def setUpClass(cls) -> None:
        """Genera una vez las páginas sintéticas compartidas."""
        cls.cuerpo = pagina(0)
        cls.cambiado = pagina(1, frozenset({3, 30, 60, 90}))

    def setUp(self) -> None:
        """Área temporal propia, sin red."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name) / "evidencias" / "cibervoluntarios"
        self.area.mkdir(parents=True)
        self.sha = hashlib.sha256(self.cuerpo).hexdigest()

    def conservar(self, cuerpo: bytes) -> Path:
        """Conserva un cuerpo en su ruta canónica por huella.

        Returns:
            Ruta lógica del cuerpo.
        """
        sha = hashlib.sha256(cuerpo).hexdigest()
        ruta = self.area / (sha + ".body")
        trozos.conservar(ruta, cuerpo, sha)
        return ruta

    def manifiesto(self, ruta: Path) -> dict:
        """Lee el JSON del manifiesto conservado.

        Returns:
            Manifiesto sin la marca inicial.
        """
        return json.loads(ruta.read_bytes()[len(trozos.MAGIA) :])

    def reescribir(self, ruta: Path, dato: dict) -> None:
        """Escribe un manifiesto canónico con el contenido indicado."""
        ruta.write_bytes(trozos.MAGIA + (json.dumps(dato, sort_keys=True, separators=(",", ":")) + "\n").encode())

    def test_cuerpo_grande_se_reconstruye_exacto_y_pequeno_queda_entero(self) -> None:
        """La ruta lógica guarda el manifiesto; la lectura devuelve los mismos bytes."""
        self.assertGreater(len(self.cuerpo), trozos.UMBRAL)
        ruta = self.conservar(self.cuerpo)
        self.assertTrue(ruta.read_bytes().startswith(trozos.MAGIA))
        self.assertLess(ruta.stat().st_size, trozos.MAX_MANIFIESTO)
        self.assertEqual(trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA), self.cuerpo)
        pequeno = b'{"hydra:member":[]}'
        ruta_pequena = self.conservar(pequeno)
        self.assertEqual(ruta_pequena.read_bytes(), pequeno)

    def test_fichas_medianas_reutilizan_la_plantilla_con_huellas_independientes(self) -> None:
        """Una nueva edición comparte los trozos del HTML y conserva su propio original verificable."""
        plantilla = b"<!doctype html>\n" + self.cuerpo[: 3 * trozos.MAX_TROZO_FICHA]
        edicion = plantilla + b"\n<p>Plazas disponibles</p>"
        primera = self.conservar(plantilla)
        sha = hashlib.sha256(edicion).hexdigest()
        segunda = self.area.parent / "conservadas" / (sha + ".ref")
        trozos.conservar(segunda, edicion, sha)
        manifiesto = self.manifiesto(segunda)
        piezas = {h for h, _ in self.manifiesto(primera)["trozos"]}
        self.assertTrue(piezas.intersection(h for h, _ in manifiesto["trozos"]))
        self.assertEqual(trozos.leer(segunda, sha, limite=len(edicion)), edicion)
        conservados = {p.name for p in trozos.carpeta_trozos(segunda).iterdir()}
        trozos.conservar(segunda, edicion, sha)
        self.assertEqual(conservados, {p.name for p in trozos.carpeta_trozos(segunda).iterdir()})
        self.assertEqual(self.manifiesto(segunda), manifiesto)

        # La procedencia estructurada sigue disponible para los lectores de sus controles.
        referencia = self.area.parent / "conservadas" / "registro.ref"
        cuerpo = b'{"html":"' + b"a" * trozos.UMBRAL_FICHA + b'"}'
        trozos.conservar(referencia, cuerpo, hashlib.sha256(cuerpo).hexdigest())
        self.assertEqual(referencia.read_bytes(), cuerpo)

    def test_cortes_deterministas_y_estables_ante_una_insercion(self) -> None:
        """Una inserción solo cambia los trozos que la rodean."""
        self.assertEqual(trozos.cortes(self.cuerpo), trozos.cortes(bytes(self.cuerpo)))
        mitad = len(self.cuerpo) // 2
        insertado = self.cuerpo[:mitad] + b'"nuevo":1,' + self.cuerpo[mitad:]

        def huellas(datos: bytes) -> set[str]:
            inicio, salida = 0, set()
            for fin in trozos.cortes(datos):
                self.assertLessEqual(fin - inicio, trozos.MAX_TROZO)
                salida.add(hashlib.sha256(datos[inicio:fin]).hexdigest())
                inicio = fin
            return salida

        antes, despues = huellas(self.cuerpo), huellas(insertado)
        self.assertLessEqual(len(despues - antes), 2)

    def test_trozo_alterado_ausente_o_enlazado_no_devuelve_contenido(self) -> None:
        """Cualquier diferencia en un trozo impide la lectura."""
        ruta = self.conservar(self.cuerpo)
        primero = self.manifiesto(ruta)["trozos"][0][0]
        trozo = trozos.ruta_trozo(ruta, primero)
        original = trozo.read_bytes()
        trozo.write_bytes(b"x" + original[1:])
        with self.assertRaisesRegex(ErrorTrozos, "Trozo alterado"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)
        trozo.unlink()
        with self.assertRaisesRegex(ErrorTrozos, "Trozo ausente"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)
        ajeno = ruta.parent / "ajeno"
        ajeno.write_bytes(original)
        trozo.symlink_to(ajeno)
        with self.assertRaisesRegex(ErrorTrozos, "enlace"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)
        trozo.unlink()
        os.link(ajeno, trozo)
        with self.assertRaisesRegex(ErrorTrozos, "alias"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)

    def test_manifiesto_reordenado_no_supera_la_huella_completa(self) -> None:
        """Trozos íntegros en otro orden no reconstruyen el cuerpo citado."""
        ruta = self.conservar(self.cuerpo)
        dato = self.manifiesto(ruta)
        dato["trozos"][0], dato["trozos"][1] = dato["trozos"][1], dato["trozos"][0]
        self.reescribir(ruta, dato)
        with self.assertRaisesRegex(ErrorTrozos, "SHA256 esperado"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)

    def test_manifiestos_defectuosos_y_limites(self) -> None:
        """Se rechazan formas, tamaños y cotas fuera del contrato, también reconstruidas."""
        ruta = self.conservar(self.cuerpo)
        valido = self.manifiesto(ruta)
        with self.assertRaisesRegex(ErrorTrozos, "excesivo"):
            trozos.leer(ruta, self.sha, limite=len(self.cuerpo) - 1)
        casos = {
            "otro cuerpo": {**valido, "sha256": "0" * 64},
            "incompatible": {**valido, "extra": 1},
            "Versión": {**valido, "version": 2},
            "incoherente": {**valido, "bytes": valido["bytes"] + 1},
            "declarado": {**valido, "trozos": [[valido["trozos"][0][0], trozos.MAX_TROZO + 1]]},
            "ninguno": {**valido, "trozos": []},
            "Demasiados": {**valido, "trozos": [["a" * 64, 1]] * (trozos.MAX_TROZOS + 1)},
            "Trozo declarado": {**valido, "trozos": [["../x", 1], *valido["trozos"][1:]]},
        }
        for motivo, dato in casos.items():
            with self.subTest(motivo):
                self.reescribir(ruta, dato)
                with self.assertRaisesRegex(ErrorTrozos, motivo):
                    trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)
        ruta.write_bytes(trozos.MAGIA + b'{"bytes":1,"bytes":2}')
        with self.assertRaisesRegex(ErrorTrozos, "Clave repetida"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)
        ruta.write_bytes(trozos.MAGIA + json.dumps(valido, indent=1).encode())
        with self.assertRaisesRegex(ErrorTrozos, "no canónico"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)
        ruta.write_bytes(trozos.MAGIA + b"{no json")
        with self.assertRaisesRegex(ErrorTrozos, "no válido"):
            trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA)

    def test_cuerpo_sin_marca_solo_pide_el_prefijo_para_distinguir_un_manifiesto(self) -> None:
        """La detección de formato puede terminar antes de leer el cuerpo que después se verificará por SHA."""
        cuerpo = b"contenido original de la captura" * 100
        ruta = self.area / "captura.body"
        ruta.write_bytes(cuerpo)
        sha = hashlib.sha256(cuerpo).hexdigest()
        with (
            ruta.open("rb") as archivo,
            patch.object(archivo, "read", wraps=archivo.read) as leer,
            patch.object(Path, "open", return_value=archivo),
        ):
            self.assertIsNone(trozos.manifiesto_de(ruta, sha, limite=len(cuerpo)))
            leer.assert_called_once_with(len(trozos.MAGIA))
        self.assertEqual(trozos.leer(ruta, sha, limite=len(cuerpo)), cuerpo)
        with self.assertRaises(ErrorTrozos):
            trozos.leer(ruta, "0" * 64, limite=len(cuerpo))

    def test_cuerpo_entero_que_empieza_como_manifiesto_sigue_siendo_entero(self) -> None:
        """La marca no basta: un cuerpo con su propia huella se lee entero."""
        cuerpo = trozos.MAGIA + b'{"no":"manifiesto"}'
        ruta = self.area / "captura.body"
        ruta.write_bytes(cuerpo)
        self.assertEqual(trozos.leer(ruta, hashlib.sha256(cuerpo).hexdigest(), limite=1024), cuerpo)

    def test_conservar_es_idempotente_y_no_reemplaza_otro_cuerpo(self) -> None:
        """Repetir conserva lo mismo; otra huella en la misma ruta es colisión."""
        ruta = self.conservar(self.cuerpo)
        self.conservar(self.cuerpo)
        self.assertEqual(trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA), self.cuerpo)
        with self.assertRaisesRegex(ErrorTrozos, "Colisión"):
            trozos.conservar(ruta, self.cambiado, hashlib.sha256(self.cambiado).hexdigest())

    def test_copiar_del_almacen_conserva_por_trozos_y_lee_verificado(self) -> None:
        """La copia entre candidatas comparte trozos y conserva identidad y errores."""
        origen = self.area / "origen.body"
        origen.write_bytes(self.cuerpo)
        destino = self.area / (self.sha + ".body")
        almacen.copiar_evidencia(admision.ReferenciaArchivo(ruta=origen, sha256=self.sha), destino)
        self.assertTrue(destino.read_bytes().startswith(trozos.MAGIA))
        self.assertEqual(almacen.leer_evidencia(destino, self.sha, "motivo"), self.cuerpo)
        with self.assertRaisesRegex(ErrorEntregaCatalogo, "Entrada alterada"):
            almacen.copiar_evidencia(admision.ReferenciaArchivo(ruta=origen, sha256="0" * 64), destino)
        with self.assertRaisesRegex(ErrorEntregaCatalogo, "Ancla"):
            almacen.leer_evidencia(destino, "1" * 64, "Ancla alterada")

    def test_presupuesto_cuenta_bytes_almacenados_una_vez_y_respeta_el_limite(self) -> None:
        """Dos capturas casi iguales consumen sus trozos comunes una sola vez."""
        primera = self.conservar(self.cuerpo)
        segunda = self.conservar(self.cambiado)
        presupuesto = admision._Presupuesto(restante=admision.MAX_TOTAL_ENTRADAS, archivos=10)
        for ruta, cuerpo in ((primera, self.cuerpo), (segunda, self.cambiado)):
            ref = admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(cuerpo).hexdigest())
            resumen = presupuesto.comprobar_evidencia(ref, admision.MAX_ENTRADA)
            self.assertEqual(resumen["bytes"], len(cuerpo))
        almacenados = sum(p.stat().st_size for p in self.area.parent.rglob("*") if p.is_file())
        self.assertEqual(admision.MAX_TOTAL_ENTRADAS - presupuesto.restante, almacenados)
        self.assertLess(almacenados, len(self.cuerpo) * 1.2)
        corto = admision._Presupuesto(restante=len(self.cuerpo) // 2, archivos=10)
        with self.assertRaisesRegex(ErrorAdmisionCatalogo, "límite"):
            corto.comprobar_evidencia(admision.ReferenciaArchivo(ruta=primera, sha256=self.sha), admision.MAX_ENTRADA)
        with self.assertRaisesRegex(ErrorAdmisionCatalogo, "excesivo"):
            presupuesto.comprobar_evidencia(admision.ReferenciaArchivo(ruta=primera, sha256=self.sha), 1024)

    def test_migracion_interrumpida_deja_el_cuerpo_entero_y_se_completa_al_repetir(self) -> None:
        """El reemplazo atómico ocurre solo tras verificar; repetir termina sin perder nada."""
        ruta = self.area / (self.sha + ".body")
        ruta.write_bytes(self.cuerpo)
        ruta.chmod(0o640)
        os.utime(ruta, ns=(1_700_000_000_000_000_000, 1_700_000_000_000_000_000))
        with (
            patch.object(Path, "replace", side_effect=OSError("corte simulado")),
            self.assertRaises(OSError),
        ):
            trozos.migrar_archivo(ruta, self.sha)
        self.assertEqual(ruta.read_bytes(), self.cuerpo)
        sobrante = self.area / ".migracion-abc12345.tmp"
        sobrante.write_bytes(b"temporal de un corte")
        trozos.retirar_temporales(self.area)
        self.assertFalse(sobrante.exists())
        self.assertTrue(trozos.migrar_archivo(ruta, self.sha))
        self.assertFalse(trozos.migrar_archivo(ruta, self.sha))
        self.assertEqual(trozos.leer(ruta, self.sha, limite=admision.MAX_ENTRADA), self.cuerpo)
        self.assertEqual(ruta.stat().st_mtime_ns, 1_700_000_000_000_000_000)
        self.assertEqual(ruta.stat().st_mode & 0o777, 0o640)

    def test_crecimiento_por_ciclo_frente_a_cuerpos_enteros(self) -> None:
        """Ciclos idénticos no crecen y uno con 4 de 100 miembros cambiados crece poco."""

        def ocupado() -> int:
            return sum(p.stat().st_size for p in self.area.parent.rglob("*") if p.is_file())

        self.conservar(self.cuerpo)
        base = ocupado()
        for _ in range(3):
            self.conservar(self.cuerpo)
            self.assertEqual(ocupado(), base)
        self.conservar(self.cambiado)
        crecimiento = ocupado() - base
        self.assertLess(crecimiento, len(self.cambiado) // 10)


class OriginalesPorTrozosPruebas(unittest.TestCase):
    """La recepción guarda los cuerpos grandes por trozos y los cita por su huella original."""

    def setUp(self) -> None:
        """Originales temporales propios, sin red."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.original = Path(temporal.name) / "cibervoluntarios"
        self.cuerpo = pagina(0)
        self.sha = hashlib.sha256(self.cuerpo).hexdigest()

    def test_conservar_bytes_guarda_manifiesto_y_trozos_compartidos(self) -> None:
        """La ruta y la huella son las del cuerpo; la lectura común lo reconstruye exacto."""
        maximo = recepciones.MAX_CUERPO_CATALOGO
        ref = recepciones.conservar_bytes(self.original / "cuerpos", self.cuerpo, ".body", maximo_bytes=maximo)
        self.assertEqual((ref.ruta.name, ref.sha256), (self.sha + ".body", self.sha))
        self.assertTrue(ref.ruta.read_bytes().startswith(trozos.MAGIA))
        self.assertTrue(any((self.original / "cuerpos" / trozos.CARPETA).iterdir()))
        mtime = ref.ruta.stat().st_mtime_ns
        recepciones.conservar_bytes(self.original / "cuerpos", self.cuerpo, ".body", maximo_bytes=maximo)
        self.assertEqual(ref.ruta.stat().st_mtime_ns, mtime)
        archivo = {"archivo": "cuerpos/" + ref.ruta.name, "sha256": self.sha}
        self.assertEqual(operacion_fuente.leer_conservado(self.original, archivo, maximo_bytes=maximo), self.cuerpo)
        recibo = recepciones.conservar_bytes(self.original / "metadatos", self.cuerpo[: trozos.UMBRAL], ".json")
        self.assertFalse(recibo.ruta.read_bytes().startswith(trozos.MAGIA))
        self.assertEqual(
            operacion_fuente.referencia_conservada(ref.ruta, self.original, ref.sha256)["sha256"], self.sha
        )

    def test_recepcion_cita_el_cuerpo_por_su_huella_original(self) -> None:
        """El recibo de una consulta nunca cita la huella del manifiesto."""
        respuesta = recepciones.RespuestaCatalogo(
            url="https://ejemplo.test/pagina",
            inicio_utc="2026-10-25T03:00:00Z",
            fin_utc="2026-10-25T03:00:01Z",
            cuerpo=self.cuerpo,
            url_final="https://ejemplo.test/pagina",
            http=200,
            completo=True,
            content_type="application/ld+json",
        )
        with patch.object(operacion_fuente, "consultar", return_value=respuesta):
            filas = operacion_fuente.recibir_url(
                "https://ejemplo.test/pagina", self.original, None, perfil="datos", maximo_bytes=len(self.cuerpo)
            )
        self.assertEqual(filas["cuerpo"]["sha256"], self.sha)
        self.assertEqual(
            operacion_fuente.leer_conservado(self.original, filas["cuerpo"], maximo_bytes=len(self.cuerpo)), self.cuerpo
        )


if __name__ == "__main__":
    unittest.main()
