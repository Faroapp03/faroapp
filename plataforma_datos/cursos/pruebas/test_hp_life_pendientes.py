"""Pendientes de HP LIFE: uno por curso, sustituido en cada consulta, con la primera y la última vez."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from plataforma_datos.cursos.fuentes.hp_life import pendientes

ID = "hp-life:433:es"


def _pendiente(dia: int, cuerpo: bytes = b"<html>sin datos</html>") -> pendientes.Pendiente:
    recibo = json.dumps({"captura": {"recibido_utc": f"2026-10-{dia:02d}T04:00:01+00:00"}}).encode()
    return pendientes.Pendiente(
        ID,
        cuerpo,
        hashlib.sha256(cuerpo).hexdigest(),
        recibo,
        hashlib.sha256(recibo).hexdigest(),
        "alta sin ficha",
        f"2026-10-{dia:02d}T05:00:00Z",
    )


class PendientesHpPruebas(unittest.TestCase):
    """Cada prueba escribe en su propia área."""

    def setUp(self) -> None:
        """Crea el área de una preparación."""
        temporal = tempfile.TemporaryDirectory(prefix="Pendientes HP ")
        self.addCleanup(temporal.cleanup)
        self.area = Path(temporal.name)

    def archivos(self) -> list[str]:
        """Lista los archivos del área.

        Returns:
            Nombres ordenados.
        """
        return sorted(p.name for p in (self.area / "pendientes").iterdir())

    def test_la_misma_alta_no_acumula_un_archivo_por_dia(self) -> None:
        """Tres días ilegible dejan tres archivos, no nueve, con la fecha de la primera y de la última vez."""
        for dia in (1, 2, 3):
            fila = pendientes.registrar(_pendiente(dia), self.area)
            self.assertEqual(len(self.archivos()), 3)
        self.assertEqual(fila["primera_vez_utc"], "2026-10-01T04:00:01+00:00")
        self.assertEqual(fila["ultima_vez_utc"], "2026-10-03T04:00:01+00:00")
        estado = json.loads((self.area / "pendientes" / (pendientes.nombre(ID) + ".estado.json")).read_bytes())
        self.assertEqual(estado["primera_vez_utc"], "2026-10-01T04:00:01+00:00")
        self.assertEqual(estado["recibo_sha256"], _pendiente(3).recibo_sha256)
        self.assertEqual({a["archivo"] for a in fila["archivos"]}, {"pendientes/" + n for n in self.archivos()})

    def test_cada_curso_tiene_su_pendiente_y_un_recibo_ilegible_usa_el_corte(self) -> None:
        """Dos cursos dejan dos pendientes; sin fecha en el recibo, la última vez es el corte de la consulta."""
        pendientes.registrar(_pendiente(1), self.area)
        otro = pendientes.Pendiente(
            "hp-life:9:es", b"x", "a" * 64, b"no es json", "b" * 64, "m", "2026-10-02T05:00:00Z"
        )
        fila = pendientes.registrar(otro, self.area)
        self.assertEqual(len(self.archivos()), 6)
        self.assertEqual(fila["ultima_vez_utc"], "2026-10-02T05:00:00Z")

    def test_solo_el_cuerpo_y_el_recibo_se_sustituyen(self) -> None:
        """El estado de un curso se hereda de una consulta a otra; su cuerpo y su recibo no."""
        nombre = pendientes.nombre(ID)
        self.assertTrue(pendientes.reemplazable(f"pendientes/{nombre}.body"))
        self.assertTrue(pendientes.reemplazable(f"pendientes/{nombre}.json"))
        self.assertFalse(pendientes.reemplazable(f"pendientes/{nombre}.estado.json"))
        self.assertFalse(pendientes.reemplazable("evidencias/algo.body"))

    def test_la_primera_vez_se_compara_como_instante(self) -> None:
        """Dos escrituras del mismo instante, o una primera vez posterior a la última, no confunden las fechas."""
        pendientes.registrar(_pendiente(2), self.area)
        estado = self.area / "pendientes" / (pendientes.nombre(ID) + ".estado.json")
        # El mismo instante escrito con «Z» sigue siendo la primera vez; uno posterior a la última, o ilegible, no.
        dato = json.loads(estado.read_bytes())
        dato["primera_vez_utc"] = "2026-10-03T04:00:01Z"
        estado.write_text(json.dumps(dato))
        fila = pendientes.registrar(_pendiente(2), self.area)
        self.assertEqual(fila["primera_vez_utc"], "2026-10-02T04:00:01+00:00")
        dato["primera_vez_utc"] = "2026-10-02T04:00:01Z"
        estado.write_text(json.dumps(dato))
        fila = pendientes.registrar(_pendiente(3), self.area)
        self.assertEqual(fila["primera_vez_utc"], "2026-10-02T04:00:01Z")
        dato["primera_vez_utc"] = "ayer"
        estado.write_text(json.dumps(dato))
        self.assertEqual(pendientes.registrar(_pendiente(3), self.area)["primera_vez_utc"], "2026-10-03T04:00:01+00:00")

    def test_el_nombre_es_distinto_para_cada_identificador(self) -> None:
        """Identificadores que solo difieren en los separadores o en las mayúsculas no comparten archivo."""
        ids = [
            "hp-life:1:es",
            "hp-life-1-es",
            "hp_life_1_es",
            "HP-LIFE:1:ES",
            "hp-life:1:es ",
            "hp-life:1:é",
            "é",
            "_n",
            None,
        ]
        nombres = [pendientes.nombre(i) for i in ids]
        self.assertEqual(len(set(nombres)), len(ids))
        for nombre in nombres:
            self.assertRegex(nombre, r"[a-z0-9_]+")

    def test_el_estado_de_un_alta_que_deja_de_estar_pendiente_se_retira(self) -> None:
        """Al resolverse no queda su estado; el de otro curso que sigue pendiente se conserva."""
        otro = pendientes.Pendiente("hp-life:9:es", b"x", "a" * 64, b"{}", "b" * 64, "m", "2026-10-02T05:00:00Z")
        filas = [pendientes.registrar(_pendiente(1), self.area), pendientes.registrar(otro, self.area)]
        heredadas = [a for fila in filas for a in fila["archivos"]]
        quedan = pendientes.retirar_resueltos(self.area, [f for f in filas if f["id"] == "hp-life:9:es"], heredadas)
        self.assertEqual({a["archivo"] for a in quedan}, {a["archivo"] for a in filas[1]["archivos"]})
        self.assertEqual(self.archivos(), sorted(a["archivo"].split("/")[1] for a in filas[1]["archivos"]))


if __name__ == "__main__":
    unittest.main()
