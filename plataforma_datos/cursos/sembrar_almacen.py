"""Siembra un almacén de Cursos nuevo: el esquema V10 vacío, admitido y conservado en su casa operativa.

Uso: python -m plataforma_datos.cursos.sembrar_almacen

No importa ofertas ni listas escritas a mano. La única procedencia es el acta de creación (versión y huella del
esquema); las altas llegan después, con su evidencia, de las fuentes que traen un censo completo propio
(CENSO_PROPIO en operacion_fuente). Un almacén existente nunca se sustituye: sembrar solo crea uno nuevo.
"""

import hashlib
import json
import tempfile
from pathlib import Path

from plataforma_datos.comun.entrada_salida import guardar_json
from plataforma_datos.comun.nucleo import RAIZ, FormatoInesperado, exigir
from plataforma_datos.cursos import admision_catalogo as admision
from plataforma_datos.cursos import almacen_catalogo as almacen
from plataforma_datos.cursos import catalogo, crear_catalogo
from plataforma_datos.orquestacion.ordenes import con_motivo
from plataforma_datos.orquestacion.sustitucion import cerrojo

ACTA = "creacion-almacen"


def _referencia(ruta: Path) -> admision.ReferenciaArchivo:
    return admision.ReferenciaArchivo(ruta=ruta, sha256=hashlib.sha256(ruta.read_bytes()).hexdigest())


def sembrar(raiz: Path = RAIZ) -> dict:
    """Crea, admite y conserva un almacén vacío bajo el cerrojo común de la instalación.

    Returns:
        El control del almacén conservado, con el acta de creación como única procedencia.

    Raises:
        FormatoInesperado: Si ya hay un almacén en la casa operativa.
    """
    destino = raiz / almacen.RUTA
    with cerrojo(raiz):
        exigir(
            not destino.exists(),
            "Ya hay un almacén de Cursos; sembrar solo crea uno nuevo y nunca sustituye el existente",
            FormatoInesperado,
        )
        destino.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=destino.parent, prefix=".sembrar-") as temporal:
            trabajo = Path(temporal)
            base = trabajo / "catalogo.sqlite3"
            crear_catalogo.crear(base)
            acta = trabajo / f"{ACTA}.json"
            guardar_json(
                acta,
                {
                    "schema_version": 1,
                    "origen": "plataforma_datos.cursos.crear_catalogo",
                    "version_sqlite": catalogo.VERSION_SQLITE_CONTENIDOS,
                    "esquema_sha256": hashlib.sha256(crear_catalogo.esquema().encode()).hexdigest(),
                },
            )
            solicitud = admision.SolicitudAdmision(
                snapshot=_referencia(base),
                procedencia={ACTA: _referencia(acta)},
                validacion_destino=trabajo / "validacion.json",
            )
            admision.admitir_snapshot(solicitud)
            entrada = almacen.EntradaCatalogo(
                admision=solicitud, sha256_admision=_referencia(solicitud.validacion_destino).sha256
            )
            return almacen.conservar(entrada, destino=destino)


def main() -> int:
    """Siembra el almacén de la instalación desde la que se ejecuta.

    Returns:
        Cero si queda sembrado; uno, con su motivo, si ya existía o no se pudo crear.
    """

    def ejecutar() -> None:
        control = sembrar()
        print(json.dumps({"sembrado": True, "snapshot_sha256": control["snapshot_sha256"]}, ensure_ascii=False))

    return con_motivo(ejecutar)


if __name__ == "__main__":
    raise SystemExit(main())
