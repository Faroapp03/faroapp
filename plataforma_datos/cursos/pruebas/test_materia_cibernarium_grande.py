"""El control de materia de Cibernàrium crece con las ediciones y se sigue archivando y leyendo pasado 1 MiB.

Es el caso del ciclo del 25/11: el control acumulado del almacén vigente cabía en la cota del informe de admisión
(1 MiB) y la edición nueva lo llevó por encima; `componer` fallaba al readmitir su candidata. Los documentos
archivados del almacén tienen su propia cota (`admision.MAX_DOCUMENTO`), comprobada al escribir y al leer.
"""

import hashlib
import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo, contenido_aprendizaje, recibos_compartidos, trozos_catalogo
from plataforma_datos.cursos import materia_cibernarium as materia
from plataforma_datos.cursos.pruebas import test_materia_cibernarium as prueba_materia

CAMPOS_EVENTO = frozenset({"ediciones", "ciclos", "fuentes"})
# Las ediciones que el almacén ya no ve: identificadores que la fuente sintética no publica.
PRIMERA_AJENA = 9_000_000


def _bytes_del_evento(control: dict) -> int:
    _, evento = recibos_compartidos.separar(materia.operacion_fuente.json_bytes(control), campos_evento=CAMPOS_EVENTO)
    return len(evento)


def _control_acumulado(fila: dict, cota: int) -> dict:
    """Un control de materia con la forma del real, con tantas ediciones anteriores como caben en `cota`.

    Cada edición anterior copia la fila real con otro identificador y sin censo, como una edición que el almacén
    conserva pero que la consulta de hoy ya no trae.

    Returns:
        El control, cuyo evento ocupa como mucho `cota` bytes.
    """

    def control(cantidad: int) -> dict:
        ediciones, ciclos = {}, {}
        for numero in range(PRIMERA_AJENA, PRIMERA_AJENA + cantidad):
            id = f"cibernarium-edicion:{numero}"
            ediciones[id] = {**deepcopy(fila), "edicion_id": id, "censo_ia": None, "estado_censo": "sin-evidencia"}
            ciclos[id] = {"observacion": None, "positivo": None}
        return {"version": 1, "ediciones": ediciones, "ciclos": ciclos, "fuentes": {}}

    una = _bytes_del_evento(control(1))
    cantidad = (cota - una) // (_bytes_del_evento(control(2)) - una) + 1
    while _bytes_del_evento(acumulado := control(cantidad)) > cota:
        cantidad -= 1
    return acumulado


class ControlDeMateriaGrande(unittest.TestCase):
    """Recibos y candidatas reales sobre la fuente sintética de `test_materia_cibernarium`, sin red."""

    def setUp(self) -> None:
        """Prepara la fuente sintética, su censo de IA y la fila real de materia de su edición."""
        self.caso = prueba_materia.SeleccionAdmitida()
        self.caso.setUp()
        self.addCleanup(self.caso.doCleanups)
        self.caso.recibir()
        primera = self.caso.incorporar(self.caso.entrada, "materia-una")
        self.fila = self._control(almacen_catalogo.solicitud(primera))["ediciones"][self.caso.caso.id]
        self.materia = self.caso.dato(primera)

    @staticmethod
    def _control(solicitud: admision.SolicitudAdmision) -> dict:
        return materia._control_materia(solicitud, contenido_aprendizaje.referencias_de_evidencia_indexadas(solicitud))

    def _base_con(self, control_materia: dict) -> almacen_catalogo.EntradaCatalogo:
        """Una candidata admitida como la de entrada, con `control_materia` archivado igual que lo hace `incorporar`.

        Returns:
            Su entrada admitida.
        """
        destino = self.caso.raiz / "base-acumulada"
        control = almacen_catalogo.conservar(self.caso.entrada, destino=destino)
        inventario = {p["archivo"]: p["sha256"] for p in control["archivos_conservados"]}
        control["procedencia"][materia.CONTROL] = almacen_catalogo.archivar_documento(
            materia.operacion_fuente.json_bytes(control_materia), destino, inventario, campos_evento=CAMPOS_EVENTO
        )
        control["archivos_conservados"] = [{"archivo": n, "sha256": h} for n, h in sorted(inventario.items())]
        guardar_json(destino / almacen_catalogo.CONTROL, control)
        admision.admitir_snapshot(almacen_catalogo.solicitud(destino))
        return self.caso.entrada_de(destino)

    def test_la_edicion_nueva_lleva_el_control_sobre_un_mib_y_la_candidata_se_admite(self) -> None:
        """Un control que cabía en 1 MiB y lo pasa con la edición nueva se archiva, se admite y se vuelve a leer."""
        anterior = _control_acumulado(self.fila, admision.MAX_INFORME)
        self.assertLessEqual(_bytes_del_evento(anterior), admision.MAX_INFORME)
        destino = self.caso.incorporar(self._base_con(anterior), "materia-acumulada")
        self.assertIsNotNone(destino)
        control = self._control(almacen_catalogo.solicitud(destino))
        self.assertGreater(_bytes_del_evento(control), admision.MAX_INFORME)
        self.assertEqual(len(control["ediciones"]), len(anterior["ediciones"]) + 1)
        self.assertEqual(control["ediciones"][self.caso.caso.id], self.fila)
        self.assertEqual(self.caso.dato(destino), self.materia)

    def test_documento_entero_o_por_trozos_conserva_sha_e_integridad(self) -> None:
        """Las dos partes fragmentadas se readmiten, se reconstruyen y se vuelven a archivar por su SHA lógico."""
        dato = {"estables": "m" * trozos_catalogo.UMBRAL, "ediciones": "e" * trozos_catalogo.UMBRAL}
        entrada = self._base_con(dato).admision
        area = entrada.snapshot.ruta.parent
        control = json.loads((area / almacen_catalogo.CONTROL).read_bytes())
        referenciada = control["procedencia"][materia.CONTROL]
        evento = entrada.procedencia[materia.CONTROL]
        referencias = contenido_aprendizaje.referencias_de_evidencia_indexadas(entrada)
        contenido = recibos_compartidos.canonico(dato)
        meta, cuerpo = recibos_compartidos.separar(contenido, campos_evento=CAMPOS_EVENTO)
        ref_meta = referencias[hashlib.sha256(meta).hexdigest()]
        for ref in (evento, ref_meta):
            self.assertTrue(ref.ruta.read_bytes().startswith(trozos_catalogo.MAGIA))
        self.assertEqual(evento.sha256, hashlib.sha256(cuerpo).hexdigest())
        self.assertEqual(almacen_catalogo.leer_documento(area, referenciada), dato)
        self.assertEqual(almacen_catalogo.leer_documento_indexado(evento, referencias), dato)
        inventario = {}
        self.assertEqual(
            almacen_catalogo.archivar_documento(contenido, area, inventario, campos_evento=CAMPOS_EVENTO), referenciada
        )
        self.assertEqual(set(inventario.values()), {evento.sha256, ref_meta.sha256})
        # La forma histórica entera tiene la misma huella y un rearquivado conserva sus bytes.
        evento.ruta.write_bytes(cuerpo)
        self.assertEqual(
            almacen_catalogo.archivar_documento(contenido, area, inventario, campos_evento=CAMPOS_EVENTO), referenciada
        )
        self.assertEqual(evento.ruta.read_bytes(), cuerpo)
        self.assertEqual(almacen_catalogo.leer_documento_indexado(evento, referencias), dato)

        enlace = area / "alias-del-evento"
        enlace.hardlink_to(evento.ruta)
        with self.assertRaisesRegex(ValueError, "alias duro"):
            almacen_catalogo.leer_documento_indexado(evento, referencias)
        with self.assertRaisesRegex(ValueError, "Colisión de documento"):
            almacen_catalogo.archivar_documento(contenido, area, inventario, campos_evento=CAMPOS_EVENTO)
        enlace.unlink()
        manifiesto = trozos_catalogo.manifiesto_de(ref_meta.ruta, ref_meta.sha256, limite=admision.MAX_DOCUMENTO)
        trozos_catalogo.ruta_trozo(ref_meta.ruta, manifiesto.trozos[0][0]).write_bytes(b"corrompido")
        with self.assertRaisesRegex(ValueError, "Trozo alterado"):
            almacen_catalogo.solicitud(area)
        with self.assertRaisesRegex(ValueError, "Trozo alterado"):
            almacen_catalogo.leer_documento(area, referenciada)

    def test_la_cota_del_documento_se_sigue_exigiendo_al_escribir_y_al_leer(self) -> None:
        """Un evento sobre la cota no se archiva, y uno que ya está en el almacén no se readmite ni se lee."""
        anterior = _control_acumulado(self.fila, 64 * 1024)
        destino = Path(self.caso.incorporar(self._base_con(anterior), "materia-pequena"))
        cota = _bytes_del_evento(anterior)
        actual = materia.operacion_fuente.json_bytes(self._control(almacen_catalogo.solicitud(destino)))
        with (
            patch.object(admision, "MAX_DOCUMENTO", cota),
            self.assertRaisesRegex(ValueError, "Documento archivado excede su cota"),
        ):
            almacen_catalogo.archivar_documento(
                actual, self.caso.raiz / "sobre-la-cota", {}, campos_evento=CAMPOS_EVENTO
            )
        self.assertFalse((self.caso.raiz / "sobre-la-cota").exists())
        referencia = json.loads((destino / almacen_catalogo.CONTROL).read_bytes())["procedencia"][materia.CONTROL]
        with patch.object(admision, "MAX_DOCUMENTO", cota):
            with self.assertRaisesRegex(ValueError, "Archivo excede el límite de bytes"):
                almacen_catalogo.solicitud(destino)
            with self.assertRaisesRegex(ValueError, "Archivo excede el límite de bytes"):
                almacen_catalogo.leer_documento(destino, referencia)


if __name__ == "__main__":
    unittest.main()
