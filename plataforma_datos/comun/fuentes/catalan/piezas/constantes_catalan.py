"""Metadatos, límites y tablas de la fuente catalan, definidos junto a su motivo y usados por su cadena."""

import re

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA
from plataforma_datos.ocupaciones.fuentes.textos.lector import CAMPOS_REDACCION

FUENTE = "catalan"
_, PREPARADO, VALIDADO = carpetas(FUENTE)
ORIGEN = PREPARADO / "origen"
TRADUCCIONES = PREPARADO / "traducciones"
PROCEDENCIA = PREPARADO / ARCHIVO_DE_PROCEDENCIA
TIPOS = ("tareas", "grupos", "ocupaciones")
# Campos de una tarea, en el orden en que se muestran: «La IA podría» y «Lo tuyo» solo si la tarea tiene los dos.
CAMPOS_TAREA = ("corto", "texto", *CAMPOS_REDACCION)

MARCA = "traducido con IA"
# Qué se ha hecho con la traducción, dicho sin juzgarla. Son dos campos distintos del motor (la marca se enseña junto
# al texto y el estado describe el conjunto) que hoy dicen lo mismo, por eso el estado se deriva de la marca.
ESTADO = MARCA
ESTADO_ADMITIDO = f"Admitido: {ESTADO}"
# Lo que cada archivo de traducción dice de sí mismo: sin ello no se sabe quién la hizo ni en qué estado está.
CAMPOS_PROCEDENCIA = ("modelo", "fecha", "estado", "marca")
# La fecha de procedencia (AAAA-MM-DD). Sin anclas: quien la usa debe aplicarla entera con `fullmatch`.
FECHA_ISO = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")

# Las partes: una muestra para revisar primero y el resto en partes de como mucho MAX_CLAVES_POR_PARTE claves, sin
# partir los campos de una tarea. La muestra son 20 claves de cada tipo, del caso de la recepcionista y de las
# ocupaciones que usan los testigos del informe: 4226-1 y 4226-2 con sus cuatro campos y 6 tareas con dos.
PARTE_MUESTRA = "muestra"
MAX_CLAVES_POR_PARTE = 1000
# Las claves van agrupadas por línea (una rama de la clasificación por línea): el formateador pondría una por línea.
# fmt: off
MUESTRA = {
    "tareas": ("4226-1", "4226-2", "2512-1", "2512-2", "5411-1", "5411-2", "5246-1", "7512-1"),
    "grupos": (
        "4", "42", "422", "4226", "5", "52", "524", "5246", "5249", "54", "541", "5411",
        "7", "75", "751", "7512", "2", "25", "251", "2512",
    ),
    "ocupaciones": (
        "4226.1", "4226.1.1", "4226.1.2", "2512.1", "2512.2", "2512.3", "2512.4", "2512.7", "5411.1", "5411.1.1",
        "7512.1", "7512.2", "7512.3", "7512.5", "5246.1", "5249.1", "5249.3", "0110.1", "0110.2", "0110.3",
    ),
}
# fmt: on

# Longitud razonable frente al original: el catalán ocupa más o menos lo mismo que el castellano. A un texto corto
# se le da una holgura fija, porque una palabra más o menos cambia mucho su proporción.
RELACION_MINIMA = 0.6
RELACION_MAXIMA = 1.7
HOLGURA_CARACTERES = 12
# Lo que la traducción conserva tal cual: cifras, siglas (palabras de 2 o más mayúsculas) y marcadores.
CIFRAS = re.compile(r"\d+")
SIGLAS = re.compile(r"\b[A-ZÁÉÍÓÚÜÑÀÈÒÏÇ]{2,}\b")
MARCADORES = ("/", "(", ")", "«", "»", "%")
# Lo que no se escribe en catalán, por código Unicode: letras castellanas (ñ, á), acentos que no existen (ì, ù),
# signos de apertura (¿ ¡), la ele geminada de un solo carácter (ŀ) y los apóstrofos que no son ' ni ’ (` ´ ʼ ‘).
# El punto volado solo va en «l·l».
# fmt: off
CARACTERES_AJENOS = frozenset(
    chr(codigo)
    for codigo in (
        0xF1, 0xD1, 0xE1, 0xC1, 0xEC, 0xCC, 0xF9, 0xD9,  # ñ Ñ á Á ì Ì ù Ù
        0xBF, 0xA1, 0x140, 0x13F,  # ¿ ¡ ŀ Ŀ
        0x60, 0xB4, 0x2BC, 0x2018,  # ` ´ ʼ ‘
    )
)
# fmt: on
ELE_CON_PUNTO = re.compile(r"[lL]\.[lL]")
PUNTO_VOLADO = "·"
PUNTO_VOLADO_EN_ELE_GEMINADA = re.compile(r"(?<=[lL])·(?=[lL])")
MAX_EJEMPLOS = 5
# Los controles de los archivos de traducción, además de una comprobación por texto (COMPROBACIONES).
CONTROL_ORIGEN = "cada traducción tiene su archivo de origen"
CONTROL_CLAVES = "ninguna clave falta ni sobra frente a su origen"
CONTROL_PROCEDENCIA = f"procedencia completa (modelo, fecha, estado «{ESTADO}», marca «{MARCA}»)"
CONTROL_IGUALES = "ningún texto igual al castellano salvo los declarados con motivo o los de solo siglas y números"
