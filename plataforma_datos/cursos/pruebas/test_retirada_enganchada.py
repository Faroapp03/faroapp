"""La regla de retirada activa de una fuente cambia lo que se publica; en sombra, lo publicado no cambia ni un byte."""

import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest import mock

from plataforma_datos.comun.entrada_salida import leer_json, sha256
from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.comun.nucleo import ValidacionFallida
from plataforma_datos.cursos import entrega_catalogo as entrega
from plataforma_datos.cursos import seleccion_entrega_catalogo as seleccion
from plataforma_datos.cursos.activacion_de_la_retirada import CRITERIO
from plataforma_datos.cursos.altas_en_sombra import ALTAS
from plataforma_datos.cursos.decisiones_retirada import guardar_registro as guardar_decisiones
from plataforma_datos.cursos.estado_de_la_retirada import guardar_registro
from plataforma_datos.cursos.json_entrega_catalogo import bytes_json
from plataforma_datos.cursos.pruebas import test_entrega_catalogo as montajes
from plataforma_datos.cursos.pruebas.test_error_de_retirada import lecturas_de, registros_de
from plataforma_datos.cursos.retirada_en_el_catalogo import PREFIJOS, retiradas_del_catalogo
from plataforma_datos.cursos.retirada_en_el_paquete import sin_las_retiradas
from plataforma_datos.cursos.tipos_json import ObjetoJson
from plataforma_datos.orquestacion import exportar_paquete
from plataforma_datos.orquestacion.exportacion.comun import Paquete
from plataforma_datos.orquestacion.pruebas import test_exportar_paquete as arnes

CORTE = "2026-10-30T08:00:00Z"
EDICION = "cibernarium-edicion:7"
ACADEMY = "claude-academy:curso-1"
AMBITOS = {"barcelonactiva": "cibernarium:edicion", "claude_academy": "claude_academy:curso", "formacion": "soc:curso"}


def retira(raiz: Path, fuente: str, curso: str, estado: str, *, numero: int = 1) -> None:
    """Deja una fuente con ese modo y un último ciclo cuya regla retira ese curso.

    La decisión es la de la regla real sobre un curso del SOC que desaparece del censo (en otras fuentes ese mismo
    patrón queda pendiente); se guarda como decisión de la fuente y del curso pedidos, que es lo único que lee la
    aplicación de la regla.
    """
    lecturas = lecturas_de("1100", ("formacion", "soc:curso"))
    (registro,) = registros_de(lecturas, desde=3)
    registro |= {"fuente": fuente, "ambito": AMBITOS[fuente]}
    registro["decisiones"][0]["curso"] = curso
    guardar_decisiones(raiz, registro)
    activa = estado == "activa"
    lectura_id = lecturas[3]["lectura_id"]
    guardar_registro(
        raiz,
        {
            "version": 1,
            "fuente": fuente,
            "numero": numero,
            "ciclo": sha256_json([lectura_id]),
            "lecturas": [lectura_id],
            "observado_utc": "2026-11-13T05:00:00Z",
            "en_el_ciclo": estado,
            "estado": estado,
            "cambio": None,
            "ultimo_cambio": (
                {"cambio": "activada", "decisiones": 30, "observado_utc": "2026-11-12T05:00:00Z"} if activa else None
            ),
            "confirmadas": 30 if activa else 3,
            "ciclos": 7 if activa else 1,
            "aplicadas": [lectura_id] if activa else [],
            "consulta": {"confirman": 0, "contradicen": 0, "no_se_sabe": 0, "sin_comprobar": 0, "motivo": None},
            "comprobaciones": [],
            "aplicada_contradicha": False,
            "salud_con_historia": True,
            "criterio": CRITERIO.a_json(),
        },
    )


def privado_con(unidad_id: str) -> ObjetoJson:
    """El catálogo privado mínimo de la entrega, con una unidad que producción publica.

    Returns:
        La entrada de la selección.
    """
    privado = montajes.SeleccionYContrato4Pruebas().privado()
    privado["unidades"][0]["id"] = unidad_id
    return privado


class Instalacion(unittest.TestCase):
    """Cada caso trabaja en una instalación temporal propia."""

    def setUp(self) -> None:
        """Crea la instalación."""
        carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(carpeta.cleanup)
        self.raiz = Path(carpeta.name)


class EnElCatalogo(Instalacion):
    """La selección de la entrega retiene lo que retira la regla activa de su fuente, y nada más."""

    def test_activa_retiene_lo_que_la_regla_retira_con_su_motivo(self) -> None:
        """La unidad que producción publicaría queda retenida con el motivo de la regla."""
        retira(self.raiz, "barcelonactiva", EDICION, "activa")
        privado = privado_con(EDICION)
        self.assertEqual(len(seleccion.seleccionar(deepcopy(privado), CORTE)["ofertas"]), 1)
        publico = seleccion.seleccionar(privado, CORTE, retiradas=retiradas_del_catalogo(self.raiz))
        self.assertEqual(publico["ofertas"], [])
        unidad = {"tipo": "recurso", "id": EDICION, "programa_id": EDICION}
        self.assertEqual(privado["retenciones_publicacion"], [{"unidad": unidad, "motivo": "retirada_por_evidencia"}])

    def test_en_sombra_lo_publicado_no_cambia_ni_un_byte(self) -> None:
        """Con la regla en sombra, aunque retire, la selección es byte a byte la de producción."""
        retira(self.raiz, "barcelonactiva", EDICION, "sombra")
        self.assertEqual(retiradas_del_catalogo(self.raiz), frozenset())
        produccion, sombra = privado_con(EDICION), privado_con(EDICION)
        de_produccion = seleccion.seleccionar(produccion, CORTE)
        en_sombra = seleccion.seleccionar(sombra, CORTE, retiradas=retiradas_del_catalogo(self.raiz))
        self.assertEqual(bytes_json(en_sombra), bytes_json(de_produccion))
        self.assertEqual(bytes_json(sombra), bytes_json(produccion))

    def test_una_fuente_no_retira_las_unidades_de_otra(self) -> None:
        """Una fuente activa solo retira las suyas; la otra, en sombra, no retira nada."""
        retira(self.raiz, "claude_academy", EDICION, "activa")
        self.assertEqual(retiradas_del_catalogo(self.raiz), frozenset())
        otra = self.raiz / "otra"
        retira(otra, "claude_academy", ACADEMY, "activa")
        retira(otra, "barcelonactiva", EDICION, "sombra")
        self.assertEqual(retiradas_del_catalogo(otra), {ACADEMY})

    def test_los_prefijos_son_los_de_las_altas_de_la_sombra(self) -> None:
        """Las fuentes y prefijos del catálogo son exactamente los que da de alta la sombra."""
        de_las_altas: dict[str, list[str]] = {}
        for alta in ALTAS:
            if alta.prefijo is not None:
                de_las_altas.setdefault(alta.fuente, []).append(alta.prefijo)
        self.assertEqual(PREFIJOS, {fuente: tuple(prefijos) for fuente, prefijos in de_las_altas.items()})


class EnLaEntrega(unittest.TestCase):
    """El estado de la regla entra en la huella y el linaje de la entrega, que se sigue reproduciendo."""

    def setUp(self) -> None:
        """Admite una instantánea con el montaje de la prueba de la entrega."""
        self.montaje = montajes.EntregaCatalogoPruebas("admitir")
        self.montaje.setUp()
        self.addCleanup(self.montaje.doCleanups)
        self.solicitud = self.montaje.solicitud
        self.raiz = self.montaje.raiz

    def publicado(self) -> bytes:
        """Prepara y valida la entrega.

        Returns:
            Los bytes del catálogo público validado.
        """
        entrega.preparar(self.solicitud)
        entrega.validar(self.solicitud)
        return (self.solicitud.area / "validado" / entrega.PUBLICO).read_bytes()

    def test_la_huella_del_codigo_lleva_las_piezas_de_la_regla(self) -> None:
        """La selección y las piezas de las que sale lo que la regla retiene están en la huella del código."""
        codigo = entrega.comprobar_entradas_de_entrega(self.solicitud)["codigo_proyeccion"]
        for pieza in ("seleccion_entrega_catalogo", "retirada_en_el_catalogo", "aplicacion_de_la_retirada"):
            self.assertIn(f"plataforma_datos/cursos/{pieza}.py", codigo)
        for pieza in ("estado_de_la_retirada", "activacion_de_la_retirada", "decisiones_retirada"):
            self.assertIn(f"plataforma_datos/cursos/{pieza}.py", codigo)

    def test_dos_registros_de_sombra_seguidos_no_cambian_el_linaje(self) -> None:
        """En sombra la entrada solo dice el modo: la sombra puede dejar registros sin desactualizar la entrega."""
        entrada = entrega.comprobar_entradas_de_entrega(self.solicitud)
        self.assertEqual(entrada["regla_de_retirada"]["barcelonactiva"], {"estado": "sombra"})
        publicado = self.publicado()
        for numero in (1, 2):
            retira(self.raiz, "barcelonactiva", EDICION, "sombra", numero=numero)
            self.assertEqual(entrega.comprobar_entradas_de_entrega(self.solicitud), entrada)
        destino = entrega.exportar(self.solicitud, destino=self.montaje.destino)
        self.assertEqual(destino.read_bytes(), publicado)

    def test_pasar_a_activa_cambia_el_linaje_y_la_entrega_se_reproduce(self) -> None:
        """La activación deja la entrega desactualizada; preparada de nuevo, se reproduce y se exporta."""
        self.publicado()
        retira(self.raiz, "claude_academy", ACADEMY, "activa")
        estados = entrega.comprobar_entradas_de_entrega(self.solicitud)["regla_de_retirada"]
        self.assertEqual(set(estados), set(PREFIJOS))
        self.assertEqual((estados["claude_academy"]["estado"], estados["claude_academy"]["registro"]), ("activa", 1))
        self.assertEqual(estados["barcelonactiva"], {"estado": "sombra"})
        with self.assertRaises(ValidacionFallida):
            entrega.exportar(self.solicitud, destino=self.montaje.destino)
        publicado = self.publicado()
        linaje = (self.solicitud.area / "validado" / entrega.LINAJE).read_bytes()
        self.assertEqual(self.publicado(), publicado)
        self.assertEqual((self.solicitud.area / "validado" / entrega.LINAJE).read_bytes(), linaje)
        destino = entrega.exportar(self.solicitud, destino=self.montaje.destino)
        self.assertEqual(sha256(destino), sha256(self.solicitud.area / "validado" / entrega.PUBLICO))


class EnElPaquete(Instalacion):
    """La exportación del paquete quita lo que retira la regla activa del SOC, del Consorci o de Citilab."""

    def paquete(self, *ids: str) -> Paquete:
        """Un archivo del paquete con esos cursos.

        Returns:
            Su contenido y su origen.
        """
        origen = self.raiz / "conjunto.json"
        origen.write_text("{}")
        return Paquete({"fuente": "cita", "cursos": [{"id": i, "nombre": i} for i in ids]}, [origen])

    def test_activa_quita_el_curso_y_la_regla_entra_en_los_origenes(self) -> None:
        """El curso retirado no se exporta y los registros de la regla quedan entre los orígenes del manifiesto."""
        retira(self.raiz, "formacion", "soc-1", "activa")
        paquete = self.paquete("soc-1", "soc-2")
        resultado = sin_las_retiradas(self.raiz, "formacion.json", paquete)
        self.assertEqual(resultado.datos, {"fuente": "cita", "cursos": [{"id": "soc-2", "nombre": "soc-2"}]})
        self.assertEqual(resultado.origenes[0], paquete.origenes[0])
        nombres = [ruta.relative_to(self.raiz).as_posix() for ruta in resultado.origenes[1:]]
        self.assertEqual(nombres[0], "var/actualizacion/validados/formacion/retirada/00000001.json")
        self.assertTrue(all(ruta.is_file() for ruta in resultado.origenes))
        self.assertEqual(len(paquete.datos["cursos"]), 2)

    def test_en_sombra_el_archivo_sale_tal_cual(self) -> None:
        """Con la regla en sombra, el contenido y los orígenes no cambian."""
        retira(self.raiz, "formacion", "soc-1", "sombra")
        paquete = self.paquete("soc-1", "soc-2")
        self.assertIs(sin_las_retiradas(self.raiz, "formacion.json", paquete), paquete)

    def test_una_fuente_no_toca_el_archivo_de_otra(self) -> None:
        """La regla activa del SOC no cambia Citilab ni un archivo que no publica cursos."""
        retira(self.raiz, "formacion", "soc-1", "activa")
        for nombre in ("citilab.json", "consorci.json", "esco.json"):
            paquete = self.paquete("soc-1")
            with self.subTest(nombre=nombre):
                self.assertIs(sin_las_retiradas(self.raiz, nombre, paquete), paquete)

    def exportar(self, carpeta: str) -> tuple[ObjetoJson, ObjetoJson]:
        """Exporta un formacion.json con dos cursos del SOC desde esta instalación.

        Returns:
            El archivo exportado y su entrada del manifiesto.
        """
        destino = self.raiz / carpeta
        destino.mkdir()
        with mock.patch.object(exportar_paquete, "RAIZ", self.raiz):
            manifiesto = arnes.PruebaExportacion().exportar(destino, {"formacion.json": self.paquete("soc-1", "soc-2")})
        return leer_json(destino / "formacion.json"), manifiesto["formacion.json"]

    def test_la_exportacion_quita_lo_retirado_y_lo_dice_en_el_manifiesto(self) -> None:
        """Al exportar el paquete, el SOC activo no publica su curso retirado y su registro es un origen."""
        retira(self.raiz, "formacion", "soc-1", "activa")
        exportado, entrada = self.exportar("paquete")
        self.assertEqual([curso["id"] for curso in exportado["cursos"]], ["soc-2"])
        estado = self.raiz / "var/actualizacion/validados/formacion/retirada/00000001.json"
        self.assertEqual(entrada["origenes"][estado.resolve().as_posix()], sha256(estado))

    def test_la_exportacion_en_sombra_no_cambia_ni_un_byte(self) -> None:
        """La misma exportación antes y después de dejar la regla en sombra: archivo y manifiesto idénticos."""
        antes = self.exportar("antes")
        retira(self.raiz, "formacion", "soc-1", "sombra")
        self.assertEqual(self.exportar("despues"), antes)
        self.assertEqual(
            (self.raiz / "antes/formacion.json").read_bytes(), (self.raiz / "despues/formacion.json").read_bytes()
        )


if __name__ == "__main__":
    unittest.main()
