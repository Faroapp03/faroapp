"""Migración acotada de hechos históricos: corte real de proceso, conservación y contrato único."""

import copy
import hashlib
import io
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.nucleo import FormatoInesperado
from plataforma_datos.orquestacion import actualizar, sustitucion
from plataforma_datos.orquestacion import estado_de_la_actualizacion as estado
from plataforma_datos.orquestacion import estado_panel as panel
from plataforma_datos.orquestacion import migrar_estado_actualizacion as migracion
from plataforma_datos.orquestacion.piezas_de_la_actualizacion import CARPETA_DE_INFORMES
from plataforma_datos.orquestacion.pruebas.test_estado_panel import AHORA, documento

VERSIONES_HISTORICAS = (None, 2, 3, 4)
CODIGO_CORTE = 23


def historico(version: int | None = None) -> dict:
    """Representa exactamente cada inventario histórico, con fallo y versión buena conservados.

    Returns:
        Documento anterior a v5, sin campos que nunca publicó.
    """
    valor = documento()
    for nombre in migracion.IDS_ALTAS_V5:
        valor["modulos"].pop(nombre, None)
    valor["actualizacion"]["informe"] = "var/actualizacion/ejecuciones/informe.md"
    del valor["origen_migracion"]
    del valor["actualizacion"]["integridad_resultados"]
    if version != estado.VERSION_CON_HUELLA:
        del valor["actualizacion"]["huella_resultados"]
    if version is None:
        del valor["version"]
        del valor["modulos"]["lecturas"]
        del valor["modulos"]["enlaces_lecturas"]
    else:
        valor["version"] = version
        if version == migracion.VERSION_EDITORIAL:
            del valor["modulos"]["enlaces_lecturas"]
    return valor


def anterior_cursos() -> dict:
    """Representa la v5 ya instalada con sus 49 módulos anteriores.

    Returns:
        Estado con datos temporales y errores conservados, sin las altas futuras.
    """
    valor = documento()
    for nombre in migracion.IDS_ALTAS_V5:
        del valor["modulos"][nombre]
    return valor


class MigracionEstado(unittest.TestCase):
    """Nunca transforma un estado agregado en evidencia de un payload que no existe."""

    def setUp(self) -> None:
        """Instalación propia sin fuentes, red ni notificaciones."""
        temporal = tempfile.TemporaryDirectory()
        self.addCleanup(temporal.cleanup)
        self.raiz = Path(temporal.name) / "Copia año 2026"
        self.carpeta = self.raiz / CARPETA_DE_INFORMES
        self.carpeta.mkdir(parents=True)
        self.ruta = self.carpeta / estado.ARCHIVO

    def guardar(self, valor: dict) -> tuple[bytes, str]:
        """Conserva bytes deliberadamente distintos del formateador para comprobar la copia exacta.

        Returns:
            Original y SHA que debe autorizar la migración.
        """
        contenido = json.dumps(valor, ensure_ascii=False, indent=1).encode() + b"\n\n"
        self.ruta.write_bytes(contenido)
        return contenido, hashlib.sha256(contenido).hexdigest()

    def test_migracion_conserva_hechos_fechas_y_desconocidos_en_todos_los_formatos(self) -> None:
        """Los módulos nuevos quedan sin intento y la v4 conserva su huella, sin inventarla en otros."""
        for version in VERSIONES_HISTORICAS:
            with self.subTest(version=version):
                original = historico(version)
                contenido, huella = self.guardar(original)
                avisos = self.carpeta / "avisos.log"
                avisos.write_bytes(b"hecho historico\n")
                informe = self.carpeta / "informe.json"
                informe.write_bytes(b'{"hecho":"original"}\n')
                migracion.migrar(self.raiz, sha256_estado=huella)
                nuevo = json.loads(self.ruta.read_bytes())
                self.assertEqual(nuevo["version"], estado.VERSION_REGISTRO)
                self.assertEqual(nuevo["origen_migracion"], {"version": version, "sha256_estado": huella})
                self.assertEqual({k: nuevo["modulos"][k] for k in original["modulos"]}, original["modulos"])
                for nombre in set(nuevo["modulos"]) - set(original["modulos"]):
                    self.assertEqual(nuevo["modulos"][nombre], estado.SIN_INTENTO)
                self.assertEqual(
                    {k: nuevo["actualizacion"][k] for k in original["actualizacion"]}, original["actualizacion"]
                )
                self.assertEqual(migracion._respaldo(self.raiz, huella).read_bytes(), contenido)
                self.assertEqual(avisos.read_bytes(), b"hecho historico\n")
                self.assertEqual(informe.read_bytes(), b'{"hecho":"original"}\n')
                self.assertEqual(estado.leer_estado(self.raiz), nuevo["modulos"])
                self.assertEqual(len(panel.modulos_de_registro_panel(nuevo, AHORA)), len(estado.IDS))
                if version == estado.VERSION_CON_HUELLA:
                    self.assertEqual(nuevo["actualizacion"]["integridad_resultados"], estado.HUELLA_CONSERVADA)
                else:
                    self.assertIsNone(nuevo["actualizacion"]["huella_resultados"])
                    self.assertEqual(nuevo["actualizacion"]["integridad_resultados"], estado.SIN_HUELLA_HISTORICA)

    def test_repeticion_exacta_conserva_todos_los_bytes_y_mtimes(self) -> None:
        """El SHA de origen vuelve a identificar la misma migración sin otro intento ni copia."""
        _, huella = self.guardar(historico())
        migracion.migrar(self.raiz, sha256_estado=huella)
        antes = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpeta.iterdir()}
        migracion.migrar(self.raiz, sha256_estado=huella)
        self.assertEqual({p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpeta.iterdir()}, antes)

    def test_replay_sin_payload_se_rechaza_y_siguiente_intento_real_conserva_omitidos(self) -> None:
        """No se acepta {} como payload histórico; una operación nueva sí conserva su huella propia."""
        original = historico()
        _, huella = self.guardar(original)
        migracion.migrar(self.raiz, sha256_estado=huella)
        intento = estado.Intento(
            datetime.fromisoformat(original["actualizacion"]["comienzo_utc"]),
            original["actualizacion"]["veredicto"],
            self.raiz / original["actualizacion"]["informe"],
        )
        antes = self.ruta.read_bytes()
        aviso = mock.Mock()
        with self.assertRaisesRegex(FormatoInesperado, "sin payload"):
            estado.registrar_estado(self.raiz, {}, intento, aviso)
        self.assertEqual(self.ruta.read_bytes(), antes)
        nuevo_intento = intento._replace(informe=self.carpeta / "otra-operacion.md")
        resultados = {"tich": estado.ResultadoDelModulo(estado.AMBAR, "fallo nuevo")}
        estado.registrar_estado(self.raiz, resultados, nuevo_intento, aviso)
        nuevo = json.loads(self.ruta.read_bytes())
        self.assertEqual(nuevo["actualizacion"]["huella_resultados"], estado._huella_resultados(resultados))
        self.assertEqual(nuevo["actualizacion"]["integridad_resultados"], estado.HUELLA_CONSERVADA)
        self.assertEqual(nuevo["modulos"]["consorci"], original["modulos"]["consorci"])
        self.assertEqual(nuevo["modulos"]["lecturas"], estado.SIN_INTENTO)
        self.assertEqual(nuevo["modulos"]["tich"]["fallos_seguidos"], 1)
        estado.registrar_estado(self.raiz, resultados, nuevo_intento, aviso)
        self.assertEqual(estado.leer_estado(self.raiz)["tich"]["fallos_seguidos"], 1)
        self.assertEqual(aviso.call_count, 1)

    def test_alta_cursos_v5_preserva_todos_los_hechos_y_repite_sin_escritura(self) -> None:
        """Ni registro ni panel inventan intentos; los 49 registros anteriores quedan exactos."""
        original = anterior_cursos()
        contenido, huella = self.guardar(original)
        with self.assertRaises(FormatoInesperado):
            estado.leer_estado(self.raiz)
        migracion.migrar(self.raiz, sha256_estado=huella)
        nuevo = json.loads(self.ruta.read_bytes())
        self.assertEqual(
            {k: v for k, v in nuevo.items() if k != "modulos"}, {k: v for k, v in original.items() if k != "modulos"}
        )
        self.assertEqual({k: nuevo["modulos"][k] for k in original["modulos"]}, original["modulos"])
        for nombre in migracion.IDS_ALTAS_V5:
            self.assertEqual(nuevo["modulos"][nombre], estado.SIN_INTENTO)
        self.assertEqual(migracion._respaldo(self.raiz, huella).read_bytes(), contenido)
        antes = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpeta.iterdir()}
        migracion.migrar(self.raiz, sha256_estado=huella)
        self.assertEqual({p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpeta.iterdir()}, antes)
        panel.modulos_de_registro_panel(nuevo, AHORA)
        aviso = mock.Mock()
        estado.registrar_estado(
            self.raiz,
            {"hp_life": estado.ResultadoDelModulo(estado.AMBAR, "fallo sintético")},
            estado.Intento(AHORA, estado.AMBAR, self.carpeta / "nuevo.md"),
            aviso,
        )
        tras = estado.leer_estado(self.raiz)
        self.assertEqual({k: tras[k] for k in original["modulos"]}, original["modulos"])
        self.assertEqual(tras["cibervoluntarios"], estado.SIN_INTENTO)
        self.assertEqual(tras["claude_academy"], estado.SIN_INTENTO)
        self.assertEqual(tras["hp_life"]["fallos_seguidos"], 1)

    def test_alta_editorial_desde_v5_con_cursos_preserva_52_registros_y_repite(self) -> None:
        """La revisión editorial empieza sin intento; conserva también hechos previos de Cursos."""
        original = documento()
        for nombre in ("hechos_informe", *migracion.IDS_PRODUCTORES_MERCADO, *migracion.IDS_ENLACES):
            del original["modulos"][nombre]
        original["modulos"]["hp_life"] = copy.deepcopy(original["modulos"]["consorci"])
        self.assertEqual(set(original["modulos"]), migracion.IDS_V5_CON_CURSOS)
        contenido, huella = self.guardar(original)
        migracion.migrar(self.raiz, sha256_estado=huella)
        nuevo = json.loads(self.ruta.read_bytes())
        self.assertEqual({k: nuevo["modulos"][k] for k in original["modulos"]}, original["modulos"])
        self.assertEqual(nuevo["modulos"]["hechos_informe"], estado.SIN_INTENTO)
        self.assertEqual(
            {k: v for k, v in nuevo.items() if k != "modulos"},
            {k: v for k, v in original.items() if k != "modulos"},
        )
        self.assertEqual(migracion._respaldo(self.raiz, huella).read_bytes(), contenido)
        antes = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpeta.iterdir()}
        migracion.migrar(self.raiz, sha256_estado=huella)
        self.assertEqual({p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.carpeta.iterdir()}, antes)
        panel.modulos_de_registro_panel(nuevo, AHORA)

    def test_alta_de_los_productores_de_mercado_desde_v5_con_editoriales(self) -> None:
        """EPA, EAES, ofertas y enlaces empiezan sin intento; los 53 registros anteriores se conservan tal cual."""
        original = documento()
        for nombre in migracion.IDS_PRODUCTORES_MERCADO | migracion.IDS_ENLACES:
            del original["modulos"][nombre]
        self.assertEqual(set(original["modulos"]), migracion.IDS_V5_CON_EDITORIALES)
        _contenido, huella = self.guardar(original)
        migracion.migrar(self.raiz, sha256_estado=huella)
        nuevo = json.loads(self.ruta.read_bytes())
        self.assertEqual({k: nuevo["modulos"][k] for k in original["modulos"]}, original["modulos"])
        for nombre in migracion.IDS_PRODUCTORES_MERCADO | migracion.IDS_ENLACES:
            self.assertEqual(nuevo["modulos"][nombre], estado.SIN_INTENTO)
        panel.modulos_de_registro_panel(nuevo, AHORA)

    def test_el_ciclo_amplia_solo_un_inventario_al_que_solo_le_faltan_altas(self) -> None:
        """Al arrancar, un v5 de 53 módulos pasa a 57 con respaldo; repetirlo no cambia nada."""
        original = documento()
        for nombre in migracion.IDS_PRODUCTORES_MERCADO | migracion.IDS_ENLACES:
            del original["modulos"][nombre]
        contenido, huella = self.guardar(original)
        with sustitucion.cerrojo(self.raiz):
            self.assertTrue(migracion.ampliar_al_arrancar(self.raiz))
        nuevo = json.loads(self.ruta.read_bytes())
        self.assertEqual({k: nuevo["modulos"][k] for k in original["modulos"]}, original["modulos"])
        for nombre in migracion.IDS_PRODUCTORES_MERCADO | migracion.IDS_ENLACES:
            self.assertEqual(nuevo["modulos"][nombre], estado.SIN_INTENTO)
        self.assertEqual(migracion._respaldo(self.raiz, huella).read_bytes(), contenido)
        self.assertEqual(estado.leer_estado(self.raiz), nuevo["modulos"])
        antes = self.ruta.read_bytes()
        self.assertFalse(migracion.ampliar_al_arrancar(self.raiz))
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_el_ciclo_amplia_el_estado_de_56_modulos_con_la_comprobacion_de_enlaces(self) -> None:
        """Un v5 con los productores de mercado y sin enlaces pasa a 57 módulos, con respaldo, sin inventar intentos."""
        original = documento()
        del original["modulos"]["enlaces"]
        self.assertEqual(set(original["modulos"]), migracion.IDS_V5_CON_MERCADO)
        contenido, huella = self.guardar(original)
        with sustitucion.cerrojo(self.raiz):
            self.assertTrue(migracion.ampliar_al_arrancar(self.raiz))
        nuevo = json.loads(self.ruta.read_bytes())
        self.assertEqual({k: nuevo["modulos"][k] for k in original["modulos"]}, original["modulos"])
        self.assertEqual(nuevo["modulos"]["enlaces"], estado.SIN_INTENTO)
        self.assertEqual(migracion._respaldo(self.raiz, huella).read_bytes(), contenido)
        panel.modulos_de_registro_panel(nuevo, AHORA)

    def estado_de_53_modulos(self) -> tuple[bytes, str]:
        """Un estado v5 al que solo le faltan los productores de mercado y los enlaces.

        Returns:
            Sus bytes y su SHA.
        """
        original = documento()
        for nombre in migracion.IDS_PRODUCTORES_MERCADO | migracion.IDS_ENLACES:
            del original["modulos"][nombre]
        return self.guardar(original)

    def test_la_actualizacion_real_amplia_el_estado_y_sigue(self) -> None:
        """Al arrancar, bajo su cerrojo, la actualización lo pasa a 57 módulos, lee el estado y llega a actualizar."""
        contenido, huella = self.estado_de_53_modulos()
        # Lo que hace la actualización con los módulos pendientes no es de esta prueba: basta con que llegue a ello.
        llegada = actualizar.ResultadoActualizacion(0, None, None, {"llega": None})
        with (
            redirect_stdout(io.StringIO()) as salida,
            mock.patch.object(actualizar, "_actualizar", return_value=llegada),
        ):
            resultado = actualizar.actualizar_con_resultado(self.raiz, actualizar.Opciones(reintentar_pendientes=True))
        self.assertIs(resultado, llegada)
        self.assertIn("Estado ampliado", salida.getvalue())
        self.assertEqual(set(json.loads(self.ruta.read_bytes())["modulos"]), set(estado.IDS))
        self.assertEqual(migracion._respaldo(self.raiz, huella).read_bytes(), contenido)

    def test_el_ensayo_no_escribe_el_estado_y_dice_que_la_real_lo_ampliara(self) -> None:
        """Un ensayo con el estado de 53 módulos se detiene sin escribir nada y avisa de la ampliación automática."""
        contenido, huella = self.estado_de_53_modulos()
        with redirect_stdout(io.StringIO()) as salida:
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(ensayo=True, reintentar_pendientes=True)
            )
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertIn("la actualización real lo ampliará sola al arrancar", salida.getvalue())
        self.assertEqual(self.ruta.read_bytes(), contenido)
        self.assertFalse(migracion._respaldo(self.raiz, huella).exists())

    def test_el_ensayo_con_otro_inventario_termina_en_rojo_y_nombra_la_orden(self) -> None:
        """Un inventario que no es ninguno de los revisados no deja una excepción sin tratar en el ensayo."""
        original = documento()
        del original["modulos"]["esco"]
        contenido, _huella = self.guardar(original)
        with redirect_stdout(io.StringIO()) as salida:
            resultado = actualizar.actualizar_con_resultado(
                self.raiz, actualizar.Opciones(ensayo=True, reintentar_pendientes=True)
            )
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertRegex(salida.getvalue(), r"No se ensaya: .*inventario.*migrar_estado_actualizacion --raiz")
        self.assertEqual(self.ruta.read_bytes(), contenido)

    def test_la_actualizacion_real_con_otro_inventario_termina_en_rojo_y_nombra_la_orden(self) -> None:
        """Tampoco la actualización real deja una excepción sin tratar con un inventario desconocido."""
        original = documento()
        del original["modulos"]["esco"]
        contenido, _huella = self.guardar(original)
        with redirect_stdout(io.StringIO()) as salida:
            resultado = actualizar.actualizar_con_resultado(self.raiz, actualizar.Opciones(reintentar_pendientes=True))
        self.assertEqual(resultado.codigo, actualizar.CODIGO_ROJO)
        self.assertRegex(salida.getvalue(), r"No se actualiza: .*inventario.*migrar_estado_actualizacion --raiz")
        self.assertEqual(self.ruta.read_bytes(), contenido)

    def test_otro_inventario_no_se_amplia_y_el_error_nombra_la_orden(self) -> None:
        """Un inventario que no es uno de los revisados se deja como está y la lectura dice qué ejecutar."""
        original = documento()
        del original["modulos"]["esco"]
        contenido, _huella = self.guardar(original)
        self.assertFalse(migracion.ampliar_al_arrancar(self.raiz))
        self.assertEqual(self.ruta.read_bytes(), contenido)
        with self.assertRaisesRegex(FormatoInesperado, "migrar_estado_actualizacion --raiz"):
            estado.leer_estado(self.raiz)

    def test_runtime_y_panel_rechazan_anteriores_sin_migrar(self) -> None:
        """El formato histórico solo se lee en la herramienta explícita."""
        for version in VERSIONES_HISTORICAS:
            with self.subTest(version=version):
                antes, _ = self.guardar(historico(version))
                with self.assertRaisesRegex(FormatoInesperado, "versión"):
                    estado.leer_estado(self.raiz)
                with self.assertRaises(FormatoInesperado):
                    panel.modulos_de_registro_panel(json.loads(antes), AHORA)
                self.assertEqual(self.ruta.read_bytes(), antes)

    def test_v4_migrada_conserva_replay_del_payload_efectivo(self) -> None:
        """Una huella realmente conservada permite repetir el mismo payload sin contar otro fallo."""
        intento = estado.Intento(AHORA, estado.AMBAR, self.carpeta / "informe.md")
        resultados = {"tich": estado.ResultadoDelModulo(estado.AMBAR, "fallo")}
        aviso = mock.Mock()
        estado.registrar_estado(self.raiz, resultados, intento, aviso)
        anterior = json.loads(self.ruta.read_bytes())
        anterior["version"] = estado.VERSION_CON_HUELLA
        for nombre in migracion.IDS_ALTAS_V5:
            del anterior["modulos"][nombre]
        del anterior["origen_migracion"]
        del anterior["actualizacion"]["integridad_resultados"]
        _, huella = self.guardar(anterior)
        migracion.migrar(self.raiz, sha256_estado=huella)
        antes = self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns
        estado.registrar_estado(self.raiz, resultados, intento, aviso)
        self.assertEqual((self.ruta.read_bytes(), self.ruta.stat().st_mtime_ns), antes)
        self.assertEqual(aviso.call_count, 1)

    def test_corte_real_antes_y_despues_del_reemplazo_es_reanudable(self) -> None:
        """os._exit interrumpe un proceso después del fsync, sin ejecutar finally ni limpieza."""
        for formato in ("anterior", "v5-49"):
            for fase in ("respaldo", "antes", "despues"):
                with self.subTest(fase=fase, formato=formato):
                    contenido, huella = self.guardar(historico() if formato == "anterior" else anterior_cursos())
                    codigo = """
    import os,sys
    from pathlib import Path
    from plataforma_datos.orquestacion import migrar_estado_actualizacion as m
    real=Path.replace
    def cortar(self, destino):
     if sys.argv[3] == 'respaldo' and Path(destino).name.startswith('estado-pre-v5-'):
      os._exit(23)
     if Path(destino).name == 'estado.json':
      if sys.argv[3] == 'despues': real(self,destino)
      os._exit(23)
     return real(self,destino)
    Path.replace=cortar
    m.migrar(Path(sys.argv[1]),sha256_estado=sys.argv[2])
    """
                    proceso = subprocess.run(
                        [sys.executable, "-c", textwrap.dedent(codigo), str(self.raiz), huella, fase],
                        check=False,
                        capture_output=True,
                        timeout=10,
                    )
                    self.assertEqual(proceso.returncode, CODIGO_CORTE, proceso.stderr.decode())
                    if fase != "despues":
                        self.assertEqual(self.ruta.read_bytes(), contenido)
                    migracion.migrar(self.raiz, sha256_estado=huella)
                    self.assertEqual(json.loads(self.ruta.read_bytes())["version"], estado.VERSION_REGISTRO)
                    self.assertEqual(migracion._respaldo(self.raiz, huella).read_bytes(), contenido)
                    self.assertEqual([p.name for p in self.ruta.parent.glob(".estado.json.*tmp")], [])
                    # Vuelta atrás en esta copia: el respaldo reproduce todos los bytes originales, sin cálculo inverso.
                    self.ruta.write_bytes(migracion._respaldo(self.raiz, huella).read_bytes())
                    self.assertEqual(self.ruta.read_bytes(), contenido)
                    migracion.migrar(self.raiz, sha256_estado=huella)

    def test_cerrojo_ocupado_no_muta_archivos(self) -> None:
        """No se lee ni convierte el estado mientras otro escritor conserva el cerrojo."""
        _, huella = self.guardar(historico())
        with sustitucion.cerrojo(self.raiz):
            antes = {p.name: p.read_bytes() for p in self.carpeta.iterdir()}
            with (
                mock.patch.object(
                    panel, "leer_bytes_registro_panel", side_effect=AssertionError("lectura antes del cerrojo")
                ),
                self.assertRaises(sustitucion.ActualizacionEnCurso),
            ):
                migracion.migrar(self.raiz, sha256_estado=huella)
            self.assertEqual({p.name: p.read_bytes() for p in self.carpeta.iterdir()}, antes)

    def test_origen_erroneo_y_defectos_no_se_reparan(self) -> None:
        """No completa inventarios dañados, huellas v4 ausentes ni campos temporales incoherentes."""
        for caso in ("sha", "inventario", "contador", "v4_sin_huella", "version"):
            with self.subTest(caso=caso):
                valor = historico(4 if caso == "v4_sin_huella" else None)
                if caso == "inventario":
                    del valor["modulos"]["consorci"]
                elif caso == "contador":
                    valor["modulos"]["consorci"]["fallos_seguidos"] = True
                elif caso == "v4_sin_huella":
                    del valor["actualizacion"]["huella_resultados"]
                elif caso == "version":
                    valor["version"] = 99
                contenido, huella = self.guardar(valor)
                with self.assertRaises((FormatoInesperado, panel.EstadoPanelInvalido)):
                    migracion.migrar(self.raiz, sha256_estado="0" * 64 if caso == "sha" else huella)
                self.assertEqual(self.ruta.read_bytes(), contenido)

    def test_integridad_desconocida_no_es_un_hueco_para_un_v5_danado(self) -> None:
        """Null solo corresponde a un origen histórico declarado; v4 nunca puede perder su huella."""
        valor = migracion._convertir(historico(), "a" * 64)
        for cambio in ("sin_origen", "origen_v4", "huella_espuria", "integridad"):
            with self.subTest(cambio=cambio):
                malo = copy.deepcopy(valor)
                if cambio == "sin_origen":
                    malo["origen_migracion"] = None
                elif cambio == "origen_v4":
                    malo["origen_migracion"]["version"] = 4
                elif cambio == "huella_espuria":
                    malo["actualizacion"]["huella_resultados"] = "b" * 64
                else:
                    malo["actualizacion"]["integridad_resultados"] = estado.HUELLA_CONSERVADA
                with self.assertRaises(FormatoInesperado):
                    estado.comprobar_cabecera_estado(malo)


if __name__ == "__main__":
    unittest.main()
