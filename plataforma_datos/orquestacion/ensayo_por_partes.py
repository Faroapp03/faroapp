"""Ensayo por partes: repetir solo un tramo del paquete sobre lo que dejó un ensayo con datos grabados.

Es una herramienta para trabajar, no para aceptar: sirve para arreglar algo y volver a probar en minutos. Nada se junta,
se sube ni se publica sin la verificación completa, y el ensayo completo sigue siendo la prueba final del ciclo. El
ensayo por partes nunca publica nada: repite las órdenes del tramo en una copia propia del área.

Durante el ensayo completo, antes de cada paso repetible del paquete (PASOS_REPETIBLES) se conserva un clon del área
(APFS, sin duplicar bytes) con la huella de su entrada; al terminar el paso se anota la de su salida y el código que
lo produjo (la revisión y su árbol en git). Para repetir un tramo:

- **Datos:** el clon del paso desde el que se empieza tiene que coincidir con su huella. Si no coincide, la orden se
  niega y dice desde qué paso conservado se puede empezar (o que hace falta el ensayo completo).
- **Código:** si cambió desde el ensayo, el tramo se repite con el código actual (se aplican al clon los archivos que
  cambiaron entre las dos revisiones), pero el recibo y las huellas dicen, paso por paso reutilizado, «reutilizado con
  código distinto», y la ejecución queda marcada como que no vale para aceptar: `comparar` no la admite como referencia.

Cada repetición deja en `SALIDA/repeticiones/NN/` su recibo y sus huellas, que dicen qué pasos se repitieron y cuáles
se reutilizaron, con sus huellas.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from plataforma_datos.comun.nucleo import RAIZ
from plataforma_datos.orquestacion.actualizar import (
    Ejecutor,
    Opciones,
    Paso,
    Resultado,
    ejecutar_orden,
    ejecutar_paquete,
    ejecutar_pasos,
    publicar,
)
from plataforma_datos.orquestacion.estado_de_la_actualizacion import VERDE
from plataforma_datos.orquestacion.generacion_del_ensayo import exportar_en_local, supervisor_se_detiene
from plataforma_datos.orquestacion.guardia_sin_red import exigir_sin_red
from plataforma_datos.orquestacion.modulos import PAQUETE
from plataforma_datos.orquestacion.ordenes_de_la_actualizacion import (
    COMPONER_EL_CATALOGO,
    COMPROBACIONES,
    COTEJO_DE_ARTEFACTOS,
    ENSAMBLADO,
    EXPORTAR_EL_PAQUETE,
    EXPORTAR_EN_EL_CICLO_OPERATIVO,
    ORDENES_DEL_PAQUETE,
    RUTAS_DE_LA_ENTREGA,
    Orden,
    ordenes_del_paquete,
)

# Los pasos del paquete desde los que se puede repetir, con el nombre corto de la orden.
PASOS_REPETIBLES = {
    "exportar": EXPORTAR_EL_PAQUETE,
    "componer": COMPONER_EL_CATALOGO,
    "ensamblado": ENSAMBLADO[0],
    "web": COTEJO_DE_ARTEFACTOS,
    "comprobaciones": COMPROBACIONES[0],
}
PRIMER_PASO = "exportar"
# Las órdenes en que se reconoce cada paso repetible. La exportación del ciclo operativo, que completa además los
# renombres del paquete (`ordenes_del_paquete`), sigue siendo el paso «exportar».
ORDENES_DE_CADA_PASO = {nombre: {tuple(orden.orden)} for nombre, orden in PASOS_REPETIBLES.items()} | {
    PRIMER_PASO: {tuple(EXPORTAR_EL_PAQUETE.orden), tuple(EXPORTAR_EN_EL_CICLO_OPERATIVO.orden)}
}
CARPETA_DE_PASOS = "pasos"
INDICE = "indice.json"
CODIGO = "codigo.json"
NO_VALE_PARA_ACEPTAR = "no vale para aceptar: el código cambió desde que se calcularon los pasos reutilizados"
# Las carpetas operativas del área: son datos del ensayo, nunca se sustituyen por el código de otra revisión.
OPERATIVOS = ("datos/", "var/")


class SalidaConservadaAlterada(ValueError):
    """Un clon conservado no coincide con su huella: repetir sobre él daría por bueno algo que no lo es."""


def huella_del_arbol(carpeta: Path) -> str:
    """La huella de una carpeta entera: cada ruta con su contenido (o, si es un enlace, con su destino).

    Returns:
        SHA-256 de la lista ordenada de rutas y huellas.
    """
    resumen = hashlib.sha256()
    for ruta in sorted(carpeta.rglob("*")):
        relativa = ruta.relative_to(carpeta).as_posix()
        if ruta.is_symlink():
            contenido = "enlace:" + str(ruta.readlink())
        elif ruta.is_file():
            with ruta.open("rb") as archivo:
                contenido = "archivo:" + hashlib.file_digest(archivo, "sha256").hexdigest()
        else:
            contenido = "carpeta"
        resumen.update(f"{relativa}\0{contenido}\n".encode())
    return resumen.hexdigest()


def clonar(origen: Path, destino: Path) -> None:
    """Clona una carpeta en APFS (`cp -c`): una copia propia que no duplica bytes; los enlaces se copian tal cual."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cp", "-c", "-R", str(origen), str(destino)], check=True)


def codigo_de(revision: str, raiz: Path = RAIZ) -> dict[str, str]:
    """El código de una revisión: su SHA y el de su árbol, que cambia con cualquier archivo.

    Returns:
        «revision» y «arbol».
    """
    arbol = subprocess.check_output(["git", "-C", str(raiz), "rev-parse", f"{revision}^{{tree}}"], text=True)
    return {"revision": revision, "arbol": arbol.strip()}


def _leer(ruta: Path) -> dict[str, Any]:
    return json.loads(ruta.read_bytes())


def _escribir(ruta: Path, valor: object) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(valor, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


class RegistroDePasos:
    """Ejecutor que, en cada paso repetible, conserva el área antes de él y anota sus huellas y su código."""

    def __init__(self, salida: Path, ejecutor: Ejecutor = ejecutar_orden, *, conservar: bool = True) -> None:
        self.carpeta = salida / CARPETA_DE_PASOS
        self.candidato = salida / "candidato"
        self.ejecutor = ejecutor
        self.conservar = conservar
        self.codigo = _leer(self.carpeta / CODIGO)
        self.pasos: dict[str, dict[str, Any]] = {}

    def __call__(self, orden: Sequence[str], area: Path) -> Resultado:
        """Ejecuta la orden; si es un paso repetible, conserva su entrada y anota sus huellas.

        Returns:
            El resultado de la orden.
        """
        nombre = next((n for n, ordenes in ORDENES_DE_CADA_PASO.items() if tuple(orden) in ordenes), None)
        if nombre is None:
            return self.ejecutor(orden, area)
        if self.conservar:
            clonar(area, self.carpeta / nombre / "area")
            if nombre == PRIMER_PASO:
                # El candidato no cambia durante el paquete hasta que se publica: su clon sirve a cualquier tramo.
                clonar(self.candidato, self.carpeta / nombre / "candidato")
        entrada = huella_del_arbol(area)
        inicio = time.monotonic()
        resultado = self.ejecutor(orden, area)
        self.pasos[nombre] = {
            "paso": PASOS_REPETIBLES[nombre].nombre,
            "entrada": entrada,
            "salida": huella_del_arbol(area),
            "codigo": self.codigo,
            "estadoDeSalida": resultado.codigo,
            "minutos": round((time.monotonic() - inicio) / 60, 2),
        }
        _escribir(self.carpeta / INDICE, self.pasos)
        return resultado


def ordenes_del_tramo(desde: str, hasta: str | None, entorno: Mapping[str, str] = os.environ) -> list[Orden]:
    """Las órdenes del paquete desde un paso repetible hasta otro (incluido), o hasta el final.

    Son las del paquete en este entorno (`ordenes_del_paquete`), como en el ciclo: con la señal del ciclo operativo,
    la exportación completa además los renombres.

    Returns:
        Las órdenes, en su orden.

    Raises:
        ValueError: Si un paso no es repetible o `hasta` va antes que `desde`.
    """
    if desde not in PASOS_REPETIBLES or (hasta is not None and hasta not in PASOS_REPETIBLES):
        raise ValueError(f"los pasos repetibles son: {', '.join(PASOS_REPETIBLES)}")
    inicio = ORDENES_DEL_PAQUETE.index(PASOS_REPETIBLES[desde])
    fin = len(ORDENES_DEL_PAQUETE) if hasta is None else ORDENES_DEL_PAQUETE.index(PASOS_REPETIBLES[hasta]) + 1
    if fin <= inicio:
        raise ValueError("«--hasta» tiene que ser el mismo paso que «--desde» o uno posterior")
    return list(ordenes_del_paquete(entorno)[inicio:fin])


def comprobar_conservado(salida: Path, desde: str) -> dict[str, Any]:
    """Comprueba que el clon desde el que se empieza coincide con su huella.

    Returns:
        El índice de los pasos conservados.

    Raises:
        SalidaConservadaAlterada: Si no coincide; dice desde qué paso conservado e intacto se puede empezar.
        ValueError: Si el ensayo de esa salida no conservó ese paso.
    """
    indice = _leer(salida / CARPETA_DE_PASOS / INDICE)
    if desde not in indice:
        raise ValueError(f"el ensayo de {salida} no conservó el paso «{desde}»: ejecuta el ensayo completo")
    if huella_del_arbol(salida / CARPETA_DE_PASOS / desde / "area") == indice[desde]["entrada"]:
        return indice
    anteriores = list(PASOS_REPETIBLES)[: list(PASOS_REPETIBLES).index(desde)]
    intactos = [
        n
        for n in anteriores
        if n in indice and huella_del_arbol(salida / CARPETA_DE_PASOS / n / "area") == indice[n]["entrada"]
    ]
    remedio = f"repite desde «{intactos[-1]}»" if intactos else "ejecuta el ensayo completo"
    raise SalidaConservadaAlterada(
        f"lo conservado antes de «{PASOS_REPETIBLES[desde].nombre}» no coincide con su huella: {remedio}"
    )


def aplicar_codigo(area: Path, desde_revision: str, hasta_revision: str, raiz: Path = RAIZ) -> list[str]:
    """Pone en el clon el código de otra revisión: los archivos que cambiaron entre las dos, fuera de datos y var.

    Returns:
        Las rutas cambiadas.
    """
    salida = subprocess.check_output(
        ["git", "-C", str(raiz), "diff", "--no-renames", "--name-status", "-z", desde_revision, hasta_revision]
    ).split(b"\0")
    cambiadas = []
    for estado, ruta in zip(salida[0::2], salida[1::2], strict=False):
        nombre = ruta.decode()
        if not nombre or nombre.startswith(OPERATIVOS):
            continue
        destino = area / nombre
        if estado == b"D":
            destino.unlink(missing_ok=True)
        else:
            destino.parent.mkdir(parents=True, exist_ok=True)
            contenido = subprocess.check_output(["git", "-C", str(raiz), "show", f"{hasta_revision}:{nombre}"])
            destino.write_bytes(contenido)
        cambiadas.append(nombre)
    return cambiadas


def reutilizados(indice: dict[str, Any], desde: str, codigo_actual: dict[str, str]) -> list[dict[str, Any]]:
    """Los pasos del paquete que el tramo no repite, con sus huellas y si su código es el actual.

    Returns:
        Uno por orden del paquete anterior al tramo; los repetibles llevan sus huellas.
    """
    filas = []
    for orden in ORDENES_DEL_PAQUETE[: ORDENES_DEL_PAQUETE.index(PASOS_REPETIBLES[desde])]:
        nombre = next((n for n, o in PASOS_REPETIBLES.items() if o == orden), None)
        anotado = indice.get(nombre) if nombre else None
        fila: dict[str, Any] = {"paso": orden.nombre}
        if anotado is not None:
            fila |= {"entrada": anotado["entrada"], "salida": anotado["salida"]}
        fila["codigo"] = _codigo(anotado["codigo"] if anotado else _leer_codigo_del_ensayo(indice), codigo_actual)
        filas.append(fila)
    return filas


def _leer_codigo_del_ensayo(indice: dict[str, Any]) -> dict[str, str]:
    # Todos los pasos de un ensayo completo corren con el mismo código: el de cualquiera de sus pasos anotados.
    return next(iter(indice.values()))["codigo"]


def _codigo(antes: dict[str, str], ahora: dict[str, str]) -> str:
    if antes["arbol"] == ahora["arbol"]:
        return "mismo código"
    return f"reutilizado con código distinto: {antes['revision'][:12]} → {ahora['revision'][:12]}"


def publicar_y_exportar(repeticion: Path, en_verde: bool) -> dict[str, Any]:
    """Publica el tramo en el clon del candidato de la repetición y exporta su generación a una carpeta local.

    Es lo que hace el ciclo tras el paquete (publicar en el candidato) y el supervisor tras el recibo (exportar la
    generación), sobre clones propios: nada sale de la repetición.

    Returns:
        El resultado de la exportación (`generacion_del_ensayo.exportar_en_local`).
    """
    candidato = repeticion / "candidato"
    if en_verde:
        publicar(candidato, repeticion / "area", PAQUETE, RUTAS_DE_LA_ENTREGA, False)
    revision = _leer(repeticion / CARPETA_DE_PASOS / CODIGO)["revision"]
    destino = repeticion / "generacion-resultado"
    return exportar_en_local(candidato, destino, revision, "validado" if en_verde else "rechazado")


def _paquete_entero(repeticion: Path, registro: RegistroDePasos) -> tuple[list[Paso], bool]:
    """El paquete entero, como en el ciclo: exportar, cuarentena, el resto de órdenes y la publicación en el clon.

    Returns:
        Sus pasos y si quedó en verde (ya publicado en el clon del candidato).
    """
    pasos, _comparacion, resultado = ejecutar_paquete(
        repeticion / "candidato", repeticion / "area", registro, Opciones()
    )
    return pasos, resultado.veredicto == VERDE


def tramo(
    repeticion: Path,
    desde: str,
    hasta: str | None,
    ejecutor: Ejecutor = ejecutar_orden,
    cerrar: Callable[[Path, bool], dict[str, Any]] = publicar_y_exportar,
) -> int:
    """Repite las órdenes del tramo en el área de la repetición y anota sus huellas. Corre bajo la guardia de red.

    Las órdenes, sus topes y su entorno son los del ciclo (`actualizar.ejecutar_pasos`); se detiene en la primera
    que falla, como el paquete. Desde «exportar» repite el paquete entero con `actualizar.ejecutar_paquete`, con su
    cuarentena y sus alarmas. Un tramo que llega al final del paquete publica en el clon del candidato y exporta la
    generación (`cerrar`); uno que termina antes (`hasta`) no llega a la generación.

    Returns:
        Cero si todas las órdenes del tramo terminaron bien y su generación, si llega a ella, se conservaría; uno si
        no, también cuando el supervisor se detendría por no poder conservar lo que validó.
    """
    registro = RegistroDePasos(repeticion, ejecutor, conservar=False)
    ordenes = ordenes_del_tramo(desde, hasta)
    al_final = hasta is None
    if desde == PRIMER_PASO and al_final:
        pasos, en_verde = _paquete_entero(repeticion, registro)
        generacion = cerrar(repeticion, en_verde) if (repeticion / "candidato").exists() else None
    else:
        pasos = ejecutar_pasos(repeticion / "area", registro, ordenes, Opciones())
        en_verde = len(pasos) == len(ordenes) and all(p.en_verde for p in pasos)
        generacion = cerrar(repeticion, en_verde) if al_final and (repeticion / "candidato").exists() else None
    _escribir(
        repeticion / "tramo.json",
        {
            "pasos": [{"paso": p.nombre, "codigo": p.codigo, "minutos": round(p.segundos / 60, 2)} for p in pasos],
            "huellas": registro.pasos,
            "generacion": generacion,
        },
    )
    return 0 if en_verde and not supervisor_se_detiene("validado", generacion) else 1


def main(argv: list[str] | None = None) -> int:
    """Suborden interna: la lanza `ensayo_grabado ejecutar --desde`, bajo la guardia de red.

    Returns:
        El código del tramo.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("orden", choices=("tramo",))
    parser.add_argument("--repeticion", type=Path, required=True)
    parser.add_argument("--desde", required=True, choices=PASOS_REPETIBLES)
    parser.add_argument("--hasta", choices=PASOS_REPETIBLES)
    argumentos = parser.parse_args(argv)
    exigir_sin_red()
    return tramo(argumentos.repeticion.resolve(), argumentos.desde, argumentos.hasta)


if __name__ == "__main__":
    sys.exit(main())
