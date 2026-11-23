"""Adjunta a cada oferta de la entrega pública el bloque `clasificacion` que decide el clasificador de su fuente.

La proyección compone las ofertas y aquí se pregunta, oferta a oferta, al clasificador registrado para su proveedor.
Si devuelve algún dato, la oferta lleva el bloque, validado contra el corte de la entrega; si no, viaja igual que en la
versión 6. La revisión de la entrega se calcula sobre las ofertas ya clasificadas.
"""

from plataforma_datos.comun.huella_json import sha256_json
from plataforma_datos.cursos.clasificacion.contrato import Clasificacion, Evidencia, validar_bloque
from plataforma_datos.cursos.clasificacion.registro import clasificador_de
from plataforma_datos.cursos.exigencias_entrega_catalogo import exigir
from plataforma_datos.cursos.tipos_json import ObjetoJson

# Una referencia de la oferta apunta a un documento capturado entero; el clasificador que se apoya en una parte
# concreta construye su propia evidencia con el localizador de esa parte.
DOCUMENTO_ENTERO = "#"


def evidencias_de_la_oferta(oferta: ObjetoJson) -> tuple[Evidencia, ...]:
    """Las capturas vinculadas a la oferta en la entrega (sus `referencias`), como evidencias del documento entero.

    Returns:
        Una evidencia por referencia, en el orden de la oferta.
    """
    return tuple(
        Evidencia(
            url=referencia["url"],
            sha256=referencia["sha256"],
            capturado_utc=referencia["fecha_referencia"],
            localizador=DOCUMENTO_ENTERO,
        )
        for referencia in oferta["referencias"]
    )


def clasificar_oferta(oferta: ObjetoJson, corte: str) -> ObjetoJson | None:
    """Pregunta al clasificador de la fuente de la oferta y valida el bloque que devuelve.

    Returns:
        El bloque `clasificacion` tal como viaja, o `None` si la fuente no decide ningún dato de esta oferta o su
        proveedor no tiene clasificador.
    """
    exigir("clasificacion" not in oferta, "La oferta ya trae una clasificación")
    clasificador = clasificador_de(oferta["proveedor_id"])
    resultado = None if clasificador is None else clasificador(oferta, evidencias_de_la_oferta(oferta))
    if resultado is None:
        return None
    exigir(isinstance(resultado, Clasificacion), "Clasificador con un resultado ajeno al contrato")
    bloque = resultado.a_json()
    validar_bloque(bloque, corte)
    return bloque


def clasificar_entrega(publico: ObjetoJson) -> ObjetoJson:
    """Devuelve la entrega pública con el bloque de cada oferta clasificada y su revisión calculada de nuevo.

    Returns:
        Una entrega nueva; la recibida no se modifica.
    """
    ofertas = []
    for oferta in publico["ofertas"]:
        bloque = clasificar_oferta(oferta, publico["corte_proyeccion_utc"])
        ofertas.append(oferta if bloque is None else {**oferta, "clasificacion": bloque})
    salida = {**{k: v for k, v in publico.items() if k != "revision"}, "ofertas": ofertas}
    return {**salida, "revision": sha256_json(salida)}
