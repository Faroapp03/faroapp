"""Variantes válidas del paquete publicado: catálogos de Cursos que cumplen su contrato y no son el de hoy.

Cada variante parte del catálogo y del compañero de aprendizaje reales y cambia lo que cambia el ciclo diario: cursos
que se retiran o aparecen, un proveedor que deja de publicar, fechas un día después o un idioma declarado distinto.
Se reconstruyen con la serialización y la huella del productor (bytes_json, sha256_json) y se validan con su contrato
(validar_publico), así que una variante que no lo cumpla detiene la ayuda: no se prueba el ciclo con datos inválidos.

Se escribe en la raíz de una variante, una copia real del producto sin catálogo ni compañero publicados
(scripts/verificar-datos-variantes.ts): el catálogo, el compañero y su referencia (web/scripts/catalogo-cursos).
Uso: python pruebas/ayudas/variantes_del_paquete.py <raíz del producto> <raíz de la variante> <variante>
"""

import hashlib
import json
import random
import re
import sys
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.contrato_entrega_catalogo import validar_publico
from plataforma_datos.cursos.json_entrega_catalogo import bytes_json

SEMILLA = 20261122
CATALOGO = Path("web/datos/catalogo-cursos")
APRENDIZAJE = Path("web/datos/catalogo-aprendizaje")
REFERENCIA = Path("web/scripts/catalogo-cursos/referencia.js")
NUMERO_FINAL = re.compile(r"(\d+)$")
#: Las fechas que fija el corte de cada día: mover una sin las demás no sería un paquete del ciclo.
FECHAS_DEL_CORTE = ("comprobado_el", "corte_evaluacion_utc")

Oferta = dict
Catalogo = dict


def _unico(carpeta: Path) -> Path:
    archivos = sorted(carpeta.glob("*.json"))
    if len(archivos) != 1:
        raise SystemExit(f"{carpeta} debe tener un solo archivo publicado")
    return archivos[0]


def _programas_del_aprendizaje(aprendizaje: dict) -> set[str]:
    return {ficha["programa_id"] for ficha in aprendizaje["fichas"]}


def _sin_aprendizaje(ofertas: list[Oferta], protegidos: set[str]) -> list[Oferta]:
    """Las ofertas que se pueden retirar sin cambiar el compañero de aprendizaje, que se liga a sus programas.

    Returns:
        Las ofertas de programas sin ficha de aprendizaje.
    """
    return [o for o in ofertas if o["unidad"]["programa_id"] not in protegidos]


def sin_cambios(_catalogo: Catalogo, _protegidos: set[str]) -> None:
    """El control: el mismo paquete por el mismo camino; si falla, el fallo es de la copia y no de los datos."""


def quitar_cursos(catalogo: Catalogo, protegidos: set[str]) -> None:
    """Retira 25 ofertas al azar, con semilla fija: cursos que ya no se publican."""
    candidatas = _sin_aprendizaje(catalogo["ofertas"], protegidos)
    retiradas = {id(o) for o in random.Random(SEMILLA).sample(candidatas, 25)}
    catalogo["ofertas"] = [o for o in catalogo["ofertas"] if id(o) not in retiradas]


def quitar_proveedor_pequeno(catalogo: Catalogo, protegidos: set[str]) -> None:
    """Retira todas las ofertas del proveedor con menos ofertas: una fuente que un día no publica."""
    cuentas: dict[str, int] = {}
    for oferta in catalogo["ofertas"]:
        cuentas[oferta["proveedor_id"]] = cuentas.get(oferta["proveedor_id"], 0) + 1
    libres = {o["proveedor_id"] for o in _sin_aprendizaje(catalogo["ofertas"], protegidos)}
    afectados = {o["proveedor_id"] for o in catalogo["ofertas"] if o["unidad"]["programa_id"] in protegidos}
    pequeno = min((p for p in cuentas if p in libres and p not in afectados), key=lambda p: (cuentas[p], p))
    catalogo["ofertas"] = [o for o in catalogo["ofertas"] if o["proveedor_id"] != pequeno]


def anadir_cursos(catalogo: Catalogo, _protegidos: set[str]) -> None:
    """Ediciones nuevas de programas que ya existen: otra convocatoria, con su propio número de edición.

    Raises:
        SystemExit: Si el número sintético ya existe en el catálogo.
    """
    ediciones = [
        o for o in catalogo["ofertas"] if o["unidad"]["tipo"] == "edicion" and o["proveedor_id"] == "cibernarium"
    ]
    usados = {o["unidad"]["id"] for o in catalogo["ofertas"]}
    for numero, base in enumerate(random.Random(SEMILLA).sample(ediciones, 5), start=1):
        nueva = json.loads(json.dumps(base))
        identidad = NUMERO_FINAL.sub(lambda m, n=numero: str(int(m.group(1)) + 90_000_000 + n), base["unidad"]["id"])
        if identidad in usados:
            raise SystemExit(f"La edición sintética {identidad} ya existe")
        nueva["unidad"]["id"] = identidad
        nueva["evidencia_materia"]["edicion_id"] = identidad
        catalogo["ofertas"].append(nueva)


def _instante(texto: str) -> datetime:
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))


def _mover(instante: str, dias: int) -> str:
    texto = (_instante(instante) + timedelta(days=dias)).isoformat()
    return texto.replace("+00:00", "Z") if instante.endswith("Z") else texto


def fechas_un_dia_despues(catalogo: Catalogo, _protegidos: set[str]) -> None:
    """El corte de mañana: se comprueba y se proyecta un día después y los cierres se acercan un día.

    El cierre no puede ir más allá del plazo de solicitud que acredita el curso (lo exige el contrato), así que se
    adelanta; la oferta cuyo cierre ya ha llegado al nuevo corte la retira el productor, y aquí también.
    """
    corte = _mover(catalogo["corte_proyeccion_utc"], 1)
    catalogo["corte_proyeccion_utc"] = corte
    vigentes = []
    for oferta in catalogo["ofertas"]:
        for campo in FECHAS_DEL_CORTE:
            oferta[campo] = _mover(oferta[campo], 1)
        if oferta["cierra_el"] is not None:
            oferta["cierra_el"] = _mover(oferta["cierra_el"], -1)
            if _instante(oferta["cierra_el"]) <= _instante(corte):
                continue
        vigentes.append(oferta)
    catalogo["ofertas"] = vigentes


def cambiar_idioma(catalogo: Catalogo, _protegidos: set[str]) -> None:
    """Un idioma declarado distinto en algunos cursos, con un valor que el vocabulario ya admite."""
    cambios = {"ca": "es", "es": "ca", "Català": "Español", "Español": "Català"}
    con_idioma = [o for o in catalogo["ofertas"] if o["hechos"]["idiomas_declarados"]["valor"]]
    for oferta in random.Random(SEMILLA).sample(con_idioma, 20):
        hecho = oferta["hechos"]["idiomas_declarados"]
        hecho["valor"] = sorted({cambios.get(idioma, idioma) for idioma in hecho["valor"]})


VARIANTES: dict[str, Callable[[Catalogo, set[str]], None]] = {
    "sin-cambios": sin_cambios,
    "quitar-cursos": quitar_cursos,
    "quitar-proveedor-pequeno": quitar_proveedor_pequeno,
    "anadir-cursos": anadir_cursos,
    "fechas-un-dia-despues": fechas_un_dia_despues,
    "cambiar-idioma": cambiar_idioma,
}


def recomponer(catalogo: Catalogo) -> bytes:
    """Orden canónico, proveedores con oferta, cobertura y revisión, como el productor (seleccion_entrega_catalogo).

    Returns:
        Los bytes canónicos del catálogo, ya validado con su contrato.
    """
    catalogo["ofertas"].sort(key=lambda o: (o["unidad"]["tipo"], o["unidad"]["id"]))
    presentes = {o["proveedor_id"] for o in catalogo["ofertas"]}
    catalogo["proveedores"] = [p for p in catalogo["proveedores"] if p["id"] in presentes]
    catalogo["cobertura"] = {
        t: sum(o["unidad"]["tipo"] == t for o in catalogo["ofertas"]) for t in ("recurso", "edicion")
    }
    catalogo["revision"] = sha256_json({k: v for k, v in catalogo.items() if k != "revision"})
    validar_publico(catalogo)
    return bytes_json(catalogo)


def _escribir(raiz: Path, relativa: Path, cuerpo: bytes) -> None:
    """Escribe un archivo propio de la raíz de la variante: ni la ruta ni sus carpetas pueden ser enlaces.

    Raises:
        SystemExit: Si la ruta sale de la raíz de la variante.
    """
    destino = raiz / relativa
    destino.parent.mkdir(parents=True, exist_ok=True)
    if destino.is_symlink() or not destino.parent.resolve().is_relative_to(raiz.resolve()):
        raise SystemExit(f"{relativa} sale de la raíz de la variante")
    destino.write_bytes(cuerpo)


def construir(origen: Path, raiz: Path, variante: str) -> dict[str, str | int]:
    """Escribe la variante en su raíz, una copia del producto sin catálogo ni compañero publicados.

    Returns:
        La variante, sus ofertas y la huella del catálogo nuevo.

    Raises:
        SystemExit: Si la raíz ya tiene un catálogo o un compañero publicados.
    """
    catalogo = json.loads(_unico(origen / CATALOGO).read_bytes())
    aprendizaje = json.loads(_unico(origen / APRENDIZAJE).read_bytes())
    VARIANTES[variante](catalogo, _programas_del_aprendizaje(aprendizaje))
    cuerpo = recomponer(catalogo)
    sha = hashlib.sha256(cuerpo).hexdigest()
    aprendizaje["catalogo"] = {"sha256": sha, "bytes": len(cuerpo), "revision": catalogo["revision"]}
    companero = bytes_json(aprendizaje)
    sha_companero = hashlib.sha256(companero).hexdigest()
    # Un catálogo anterior seguiría publicado junto al nuevo: la raíz se prepara sin ninguno.
    if any(any((raiz / carpeta).glob("*.json")) for carpeta in (CATALOGO, APRENDIZAJE)):
        raise SystemExit(f"{raiz} ya tiene un catálogo publicado")
    _escribir(raiz, CATALOGO / f"{sha}.json", cuerpo)
    _escribir(raiz, APRENDIZAJE / f"{sha_companero}.json", companero)
    referencia = (
        "// Referencia generada desde una exportación admitida. No editar.\n"
        "export const REFERENCIA = Object.freeze({\n"
        f"  ruta: 'datos/catalogo-cursos/{sha}.json',\n  sha256: '{sha}',\n  bytes: {len(cuerpo)},\n"
        f"  revision: '{catalogo['revision']}',\n"
        "});\n"
        "export const APRENDIZAJE = Object.freeze({\n"
        f"  ruta: 'datos/catalogo-aprendizaje/{sha_companero}.json',\n  sha256: '{sha_companero}',\n"
        f"  bytes: {len(companero)},\n"
        "});\n"
    )
    _escribir(raiz, REFERENCIA, referencia.encode())
    return {"variante": variante, "ofertas": len(catalogo["ofertas"]), "sha256": sha}


if __name__ == "__main__":
    origen_, raiz_, variante_ = sys.argv[1:]
    print(json.dumps(construir(Path(origen_), Path(raiz_), variante_), ensure_ascii=False))
