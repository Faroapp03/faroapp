"""La escala del servicio de acreditación en Cataluña: tres cifras de la Memòria del Sistema FPCAT 2025.

La Agència FP.CAT publica en su memoria anual el balance del servei d'acreditació de competències professionals
(procedimiento ordinario, 2022-2025). El informe da tres cifras en una línea del bloque de acreditación, para que la
persona sepa que el servicio es grande, que hay espera y que hay muchos puntos donde preguntar: las personas con una
cualificación entera acreditada, las solicitudes pendientes y los puntos de información y orientación.

Cada cifra se lee del PDF con pdf.py, en su página, junto a su rótulo: si una edición nueva la cambia o la mueve, la
lectura se detiene. fp.gencat.cat cierra la lectura automática en su robots.txt: el PDF se guarda a mano desde su
dirección oficial (como en `cursos/fuentes/agencia/lector.py`). Licencia: Llicència oberta d'ús d'informació –
Catalunya.

Uso: python3 -m plataforma_datos.cursos.fuentes.memoria.lector {descargar,preparar,validar,todo}
"""

import sys
from typing import Any

from plataforma_datos.comun import pdf
from plataforma_datos.comun.entrada_salida import (
    ahora_utc,
    carpetas,
    controles_de_huella,
    guardar_json,
    leer_json,
    original,
)
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, Controles, exigir
from plataforma_datos.comun.red import aviso_descarga_manual
from plataforma_datos.orquestacion.admision import cerrar_validacion
from plataforma_datos.orquestacion.ordenes import principal_fuente

FUENTE = "memoria-fpcat"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
MEMORIA_PDF = "memoria-sistema-fpcat-2025.pdf"
# Lo que escribe preparar y lee validar.
CIFRAS = PREPARADO / "cifras.json"

PAGINA = 9
PERIODO = "2022-2025"
# Cifra publicada y comienzo de su rótulo: los valores esperados detienen la lectura si cambia la edición.
RENGLONES_DEL_ROTULO = 3
CIFRAS_ESPERADAS = {
    "personas_con_cualificacion_entera": (
        "19.961",
        "PERSONES HAN ACREDITAT MÍNIM UNA QUALIFICACIÓ PROFESSIONAL SENCERA",
    ),
    "solicitudes_pendientes": ("18.307", "PENDENTS"),
    "puntos_de_orientacion": ("344", "PUNTS D’INFORMACIÓ I ORIENTACIÓ DEL SERVEI D’ACREDITACIÓ"),
}
CITA = (
    "Agència de Formació i Qualificació Professionals de Catalunya (Agència FP.CAT): Memòria del Sistema FPCAT 2025, "
    f"p. {PAGINA} (servei d'acreditació de competències professionals, procediment ordinari {PERIODO})."
)
URL = "https://fp.gencat.cat/content/dam/agenciafpcat/01_sistemafpcat/memories-sistema-fpcat/Memoria-AFPCAT-2025.pdf"


def _renglones_de_la_pagina_numero(datos: bytes, numero: int) -> list[str]:
    """Los renglones de una página del PDF (la primera es la 1), como los da pdf.py para el documento entero.

    Returns:
        Los renglones de la página, en el orden en que se dibujan.
    """
    documento = pdf.Documento(datos)
    paginas = documento.paginas()
    exigir(1 <= numero <= len(paginas), f"la memoria no tiene página {numero}")
    return pdf.renglones_de_la_pagina(documento, paginas[numero - 1], numero)


def cifras_de_la_pagina(renglones: list[str]) -> dict[str, int]:
    """Cada cifra de CIFRAS_ESPERADAS, solo si en la página va seguida de su rótulo y el periodo es el esperado.

    Returns:
        Las tres cifras asociadas a sus rótulos.

    Raises:
        FormatoInesperado: Si falta una cifra con su rótulo o no aparece el periodo esperado.
    """
    exigir(any(PERIODO in renglon for renglon in renglones), f"la página {PAGINA} no habla de {PERIODO}")
    cifras: dict[str, int] = {}
    for clave, (cifra, rotulo) in CIFRAS_ESPERADAS.items():
        # El rótulo va debajo de la cifra; se unen los renglones que ocupa en la página.
        posiciones = [i for i, renglon in enumerate(renglones) if renglon == cifra]
        exigir(
            any(" ".join(renglones[i + 1 : i + 1 + RENGLONES_DEL_ROTULO]).startswith(rotulo) for i in posiciones),
            f"la página {PAGINA} no da {cifra} con el rótulo «{rotulo}»",
        )
        cifras[clave] = int(cifra.replace(".", ""))
    return cifras


def descargar() -> None:
    """El original no se descarga con código: fp.gencat.cat cierra la lectura automática en su robots.txt."""
    aviso_descarga_manual(
        FUENTE, "fp.gencat.cat prohíbe la lectura automática en su robots.txt; el PDF se guarda a mano."
    )


def preparar() -> None:
    """Lee las tres cifras de su página."""
    renglones = _renglones_de_la_pagina_numero(original(FUENTE, MEMORIA_PDF).read_bytes(), PAGINA)
    cifras = cifras_de_la_pagina(renglones)
    guardar_json(CIFRAS, cifras)
    print(", ".join(f"{clave}: {valor}" for clave, valor in cifras.items()))


def _controles(controles: Controles, cifras: dict[str, Any]) -> None:
    """Las tres cifras, cada una un entero positivo."""
    controles.comprobar(
        set(cifras) == set(CIFRAS_ESPERADAS), f"las {len(CIFRAS_ESPERADAS)} cifras, leídas de la página {PAGINA}"
    )
    controles.comprobar(
        all(type(valor) is int and valor > 0 for valor in cifras.values()), "cada cifra es un entero positivo"
    )


def validar() -> None:
    """Comprueba las cifras y guarda el conjunto que lee el bloque de acreditación."""
    cifras = leer_json(CIFRAS)
    exigir(isinstance(cifras, dict), "memoria-fpcat: las cifras preparadas deben ser un objeto JSON")
    controles = Controles()
    controles_de_huella(controles, ORIGINAL, leer_json(PROCEDENCIA))
    _controles(controles, cifras)
    informe = {
        "estado": controles.estado,
        "comprobado_utc": ahora_utc(),
        "cobertura": {"pagina": PAGINA, "periodo": PERIODO, "cifras": len(cifras)},
        "limites": (
            "Cifras de toda Cataluña y de cuatro años, del procedimiento ordinario: dan la escala del servicio, no el "
            "plazo de una solicitud ni lo que se acredita en una ocupación."
        ),
        "controles": controles.lista,
    }
    conjunto = {"cita": CITA, "url": URL, "pagina": PAGINA, "periodo": PERIODO, **cifras}
    cerrar_validacion(FUENTE, informe, controles, lambda: conjunto)


def main(argv: list[str] | None = None) -> int:
    """Interfaz de línea de órdenes: descargar, preparar, validar o todo.

    Args:
        argv: Los argumentos; None toma los de la línea de órdenes.

    Returns:
        El código de salida del proceso.
    """
    etapas = {"descargar": descargar, "preparar": preparar, "validar": validar}
    return principal_fuente(__doc__, etapas, argv)


if __name__ == "__main__":
    sys.exit(main())
