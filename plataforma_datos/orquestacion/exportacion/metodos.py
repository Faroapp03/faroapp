"""Consenso de métodos de exposición a la IA por ocupación, para la confianza del informe breve.

Lee el cálculo de Faro guardado en `originales/metodos/consenso-isco4.json` (comprobando su huella con su procedencia),
calculado previamente; su generador no forma parte de esta entrega:
para cada ocupación ISCO-08 de 4 cifras con nota de la OIT, el tercio en que la sitúa la OIT y cuántos de los demás
métodos publicados la sitúan en el mismo tercio. La puntuación de ODEE/Cambra no cuenta: se calcula con las notas de
la OIT, así que coincidiría con ella por construcción. Solo se publica lo que lee el informe.
"""

from pathlib import Path
from typing import Any

from plataforma_datos.comun.entrada_salida import leer_json, original
from plataforma_datos.comun.nucleo import exigir
from plataforma_datos.orquestacion.exportacion.comun import Paquete

# El método que no es independiente de la OIT y no entra en el recuento.
NO_INDEPENDIENTE = "cambra_odee"
TERCIOS = {"alto", "medio", "bajo"}
CONDICIONES = Path(__file__).resolve().parents[2] / "ia_y_trabajo" / "condiciones-metodos.json"


def _condiciones_de_datos(metodos: dict[str, Any]) -> list[Path]:
    """Aplica la atribución comprobada al recurso concreto, sin modificar su original ni sus cifras.

    Returns:
        La declaración utilizada, para registrar su huella en el manifiesto.
    """
    if "anthropic" not in metodos:
        return []
    condiciones = leer_json(CONDICIONES)
    exigir(condiciones.get("version") == 1, "metodos: versión de condiciones no admitida")
    declaracion = condiciones["anthropic"]
    exigir(
        metodos["anthropic"].get("url") == declaracion["recurso"],
        "metodos: la declaración de licencia no corresponde al recurso de Anthropic",
    )
    metodos["anthropic"] = {**metodos["anthropic"], "licencia": declaracion["licencia_datos"]}
    return [CONDICIONES]


def paquete_metodos() -> Paquete:
    """Compone metodos.json: los métodos, el criterio y el recuento de cada ocupación sin el método no independiente.

    Returns:
        El paquete y el cálculo del que sale.
    """
    ruta = original("metodos", "consenso-isco4.json")
    calculo: dict[str, Any] = leer_json(ruta)
    ocupaciones = calculo.get("ocupaciones")
    exigir(isinstance(ocupaciones, dict) and len(ocupaciones) > 0, "metodos: el cálculo no trae ocupaciones")
    recuento = {}
    for isco, fila in sorted(ocupaciones.items()):
        exigir(fila.get("tercio_oit") in TERCIOS, f"metodos: tercio de la OIT inesperado en {isco}")
        coinciden, con_dato = fila["coinciden_sin_cambra"], fila["con_dato_sin_cambra"]
        exigir(0 <= coinciden <= con_dato, f"metodos: recuento imposible en {isco}")
        recuento[isco] = {"tercio_oit": fila["tercio_oit"], "coinciden": coinciden, "con_dato": con_dato}
    metodos = {clave: datos for clave, datos in calculo["metodos"].items() if clave != NO_INDEPENDIENTE}
    condiciones = _condiciones_de_datos(metodos)
    datos = {
        "fecha": calculo["fecha"],
        "metodos": metodos,
        "criterio": (
            "Percentil sin ponderar de cada ocupación en el fichero de cada autor, llevado a ISCO-08 con la media "
            "de sus códigos; tercio alto desde 66,67 y bajo hasta 33,33. «coinciden» cuenta los métodos, sin la OIT, "
            "que sitúan la ocupación en el mismo tercio que la OIT; «con_dato», los que tienen dato. ODEE/Cambra no "
            "cuenta porque se calcula con las notas de la OIT."
        ),
        "ocupaciones": recuento,
    }
    return Paquete(datos, [ruta, *condiciones])
