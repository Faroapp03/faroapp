"""Constantes de la acreditación: carpetas, direcciones, pasajes literales, umbrales y listas revisadas a mano."""

from typing import NamedTuple

from plataforma_datos.comun.entrada_salida import carpetas
from plataforma_datos.comun.estadisticas import SITIO_INE as INE
from plataforma_datos.comun.nucleo import ARCHIVO_DE_PROCEDENCIA, DATOS, RAIZ

# La pausa común entre peticiones vive en red.py; se reexporta para las piezas de la descarga de la acreditación.
from plataforma_datos.comun.red import PAUSA_ENTRE_PETICIONES_S as PAUSA_ENTRE_PETICIONES_S

FUENTE = "acreditacion"
ORIGINAL, PREPARADO, VALIDADO = carpetas(FUENTE)
PROCEDENCIA = ORIGINAL / ARCHIVO_DE_PROCEDENCIA
CERTIFICADOS = PREPARADO / "certificados.jsonl"
CORRESPONDENCIA = PREPARADO / "correspondencia-cno94-cno11.json"
NORMAS = PREPARADO / "normas.json"
REGISTRO_A_MANO = PREPARADO / "paginas-registradas.json"
RESUMEN = PREPARADO / "resumen.json"
NOMBRE_FUENTE = "Acreditación de competencias · certificados profesionales y ocupaciones relacionadas"

BOE = "https://www.boe.es"
# El Real Decreto 189/2013 modificó todos los certificados publicados hasta marzo de 2013: sus «Referencias
# anteriores» dan el identificador del BOE y la fecha de cada real decreto de certificados.
INDICE = "BOE-A-2013-3092"
ARCHIVO_DEL_INDICE = "boe-indice-rd-189-2013.html"
# Los reales decretos de certificados posteriores, que el índice no puede citar, por su fecha: con ella se lee su ELI.
FECHAS_POSTERIORES = {
    "2013-08-02": tuple(range(610, 629)),  # Reales Decretos 610/2013 a 628/2013, de 2 de agosto
    "2013-12-13": tuple(range(982, 994)),  # Reales Decretos 982/2013 a 993/2013, de 13 de diciembre
    "2014-06-27": (548,),  # Real Decreto 548/2014, de 27 de junio
    "2022-09-13": (748,),  # Real Decreto 748/2022, de 13 de septiembre
    "2023-07-04": (569,),  # Real Decreto 569/2023, de 4 de julio
}
CORRESPONDENCIA_CNO94 = f"{INE}/daco/daco42/clasificaciones/cno11_correspcno94.xls"
ARCHIVO_CNO94 = "ine-cno11-cno94.xls"


class Norma(NamedTuple):
    """Una norma que se lee para comprobar literales los pasajes en que se apoya el bloque."""

    archivo: str
    boe: str
    titulo: str


EQUIVALENCIAS = Norma("boe-norma-rd-2022-151.html", "BOE-A-2022-4205", "Real Decreto 151/2022: texto consolidado")
REGLAMENTO = Norma("boe-norma-rd-2023-659.html", "BOE-A-2023-16889", "Real Decreto 659/2023: texto consolidado")
LEY = Norma("boe-norma-lo-2022-3.html", "BOE-A-2022-5139", "Ley Orgánica 3/2022: texto consolidado")
# Los pasajes literales en que se apoyan los requisitos, la exclusión de Sanidad y el plazo legal. Si una norma cambia
# y el pasaje ya no está, la validación falla: hay que revisar los textos del bloque.
PASAJES = {
    "edad": (REGLAMENTO, "Tener dieciocho años cumplidos en el momento de realizar la inscripción, cuando se trate de "
             "estándares de competencia de nivel 1 y veinte años para los niveles 2 y 3"),
    "experiencia": (REGLAMENTO, "justificar, al menos tres años, con un mínimo de 2.000 horas trabajadas en total, "
                    "en los últimos quince años"),
    "experiencia_nivel_1": (REGLAMENTO, "se requerirán dos años de experiencia laboral con un mínimo de 1.000 horas "
                            "trabajadas en total"),
    "formacion": (REGLAMENTO, "justificar, al menos 300 horas, en los últimos diez años"),
    "formacion_nivel_1": (REGLAMENTO, "Para los estándares de competencia de nivel 1, se requerirán al menos "
                          "200 horas"),
    "provisional": (REGLAMENTO, "Las personas mayores de veinticinco años que reúnan los requisitos de experiencia "
                    "laboral o formativa"),
    "sanidad": (REGLAMENTO, "a excepción de las vinculadas a la Familia Profesional Sanidad, salvo autorización "
                "expresa o normativa que así lo permita del organismo regulador de la profesión"),
    "permanente": (REGLAMENTO, "procedimiento administrativo abierto de forma permanente"),
    "plazo_legal": (LEY, "un plazo de resolución de seis meses"),
    "equivalencia": (EQUIVALENCIAS, "La declaración de equivalencia de dichas unidades de competencia tiene los "
                     "efectos de acreditación parcial acumulable"),
}  # fmt: skip

LICENCIA_BOE = (
    "Condiciones de reutilización del BOE (licencia tipo de 27/06/2024, https://www.boe.es/informacion/aviso_legal/): "
    "reutilización libre citando «Basado en datos de la Agencia Estatal Boletín Oficial del Estado» con enlace a "
    "https://www.boe.es, sin desnaturalizar el sentido, diciendo que un texto consolidado es de carácter meramente "
    "informativo y con la fecha de su última actualización. Las disposiciones normativas no son objeto de propiedad "
    "intelectual (art. 13 del texto refundido de la Ley de Propiedad Intelectual)."
)
CITA_BOE = (
    "Basado en datos de la Agencia Estatal Boletín Oficial del Estado (https://www.boe.es): reales decretos de los "
    "certificados de profesionalidad, Real Decreto 151/2022, Real Decreto 659/2023 y Ley Orgánica 3/2022 (textos "
    "consolidados, de carácter meramente informativo, y PDF originales)."
)
CITA_INE = "Fuente: INE, correspondencia entre la CNO-94 y la CNO-11 (www.ine.es)."
CITA_SOC = (
    "Generalitat de Catalunya. Servei Públic d'Ocupació de Catalunya: especialitats formatives i unitats formatives "
    "(datos abiertos, ODC-BY 1.0)."
)

# Páginas que no se leen con código: las de la Generalitat (fp.gencat.cat prohíbe cualquier lectura automática en su
# robots.txt; Tràmits gencat, las direcciones con «?», donde están los requisitos) y el informe de la Sindicatura, del
# que solo se cita una cifra. Una persona del equipo las abre cada mes, comprueba que dicen lo mismo y actualiza
# `comprobado` y `sha256` (la huella de la página guardada; None si no se ha podido guardar). La validación avisa
# (sin fallar) de la que pase de MAX_DIAS_REGISTRO días sin comprobar.
PAGINAS_REGISTRADAS = {
    "tramite": {
        "titulo": "Tràmits gencat · Acreditació de competències professionals (FPCAT), trámite 21900",
        "url": {
            "ca": "https://tramits.gencat.cat/ca/tramits/tramits-temes/21900_Acreditat",
            "es": "https://tramits.gencat.cat/es/tramits/tramits-temes/21900_Acreditat",
        },
        "comprobado": "2026-10-06",
        "sha256": {
            "ca": "c4e0eb4becea7e2567320737589ffc9ecb61aec89569e790ee1e593c15a010a7",
            "es": "975c272c661908d3e6e205676f732039fe80338aa5bc52063766deb3ab1025b2",
        },
        "dice": "«Data d'actualització 18.05.2026». Opciones: Sol·licitar la inscripció; Inscripció per a convenis "
        "amb entitats; Presentació d'esmenes, escrits i documents.",
    },
    "expedicion": {
        "titulo": "Tràmits gencat · Sol·licitud de certificats professionals i acreditacions parcials acumulables",
        "url": {
            "ca": "https://tramits.gencat.cat/ca/tramits/tramits-temes/"
            "Sollicitud-de-certificats-professionals-i-acreditacions-parcials-acumulables",
        },
        "comprobado": "2026-10-06",
        "sha256": {"ca": "0ef1f185dc54b16b7d85f1ef779dad174c2867acbfd1a4fbd3ce907d68dd7728"},
        "dice": "«Data d'actualització 28.10.2025». «Taxes: No s'han de pagar taxes per a aquest tràmit.»",
    },
    "agencia": {
        "titulo": "Agència FP.CAT · Em vull acreditar",
        "url": {"ca": "https://fp.gencat.cat/ca/acreditacio/em-vull-acreditar/"},
        "comprobado": "2026-10-06",
        "sha256": None,
        "dice": "Dirección enlazada por el Consorci d'Educació de Barcelona (edubcn.cat, página leída el 06/10/2026). "
        "Sin copia conservada: fp.gencat.cat no admite lectura automática en su robots.txt y la página se renueva "
        "guardándola a mano.",
    },
    "orientacion": {
        "titulo": "Agència FP.CAT · Cercador de Punts d'Informació i Orientació professionals",
        "url": {
            "ca": "https://fp.gencat.cat/ca/detalls/article/Cercador-de-Punts-dInformacio-i-Orientacio-professionals"
        },
        "comprobado": "2026-10-06",
        "sha256": None,
        "dice": "Dirección publicada en los metadatos oficiales del conjunto qsgb-mu78 de Dades Obertes de Catalunya "
        "(«Enllaços relacionats», leído el 06/10/2026). Sin copia conservada: fp.gencat.cat no admite lectura "
        "automática en su robots.txt y la página se renueva guardándola a mano.",
    },
    # El punto de información y orientación de la acreditación en Cornellà: el teléfono que da el bloque es el de esta
    # página, copiado literal en «dice» y en «telefono» (la validación comprueba que coinciden).
    "cornella": {
        "titulo": "Ajuntament de Cornellà · Acreditació de competències professionals",
        "url": {
            "ca": "https://www.cornella.cat/ca/treballar-a-cornella/busco-feina/acreditacio-de-competencies-professionals"
        },
        "comprobado": "2026-10-07",
        "sha256": {"ca": "9234794dff5589c399578145415284edeb91fd1107e833acf26cfac5228f4b63"},
        "dice": "«El Servei Local d'Ocupació de Cornellà és punt d'informació i orientació del procés d'acreditació de "
        "competències professionals»; «les persones interessades podran passar per Can Mercader amb Cita Prèvia»; "
        "«Tel. 93 474 33 99».",
        "telefono": "93 474 33 99",
    },
    "sindicatura": {
        "titulo": "Sindicatura de Comptes de Catalunya · Informe 15/2026, servicio de acreditación de competencias "
        "profesionales de la Agència FP.CAT (agosto de 2026)",
        "url": {"ca": "https://www.sindicatura.cat/informes"},
        "comprobado": "2026-10-06",
        "sha256": {"ca": "815ee97bd2b1888fce11f2f4576a1c1687d6e64c2ab5668781be488d984921d2"},
        "dice": "Plazo medio de resolución: 8,9 meses con la aplicación anterior y 10,9 meses con la nueva "
        "(pp. 45–47); la normativa fija 6 meses.",
    },
}
# Las páginas registradas que no se enlazan en el bloque: de la Sindicatura solo se cita una cifra, y de la página del
# Ajuntament de Cornellà, el teléfono del punto de información (PUNTO_DE_INFORMACION).
SIN_ENLACE = ("sindicatura", "cornella")
PUNTO_DE_INFORMACION = "cornella"
# Lo que depende de un permiso o de una comprobación pendiente: no se usa, y la validación lo recuerda.
PENDIENTES = [
    "TodoFP (Ministerio de Educación, FP y Deportes): fichas de los certificados con sus puestos de trabajo y los "
    "módulos de FP que convalidan; pendiente de permiso, no se usa.",
    "INCUAL: catálogo de estándares de competencias (nombres vigentes de cada estándar); pendiente de permiso, no se "
    "usa: los nombres de las unidades son los del BOE y los del SOC.",
    "Resolució PRE/735/2024, anexo 1.2: texto de la resolución sin leer; se usa la lista de la Agència FP.CAT de "
    "cualificaciones no disponibles (febrero de 2025, fuente agencia).",
    "Agència FP.CAT: qué versión de las unidades de SSCS0108 acredita hoy (UC0249_2… o sus equivalentes del Real "
    "Decreto 151/2022); consulta escrita pendiente.",
]
# La revisión manual es mensual; el aviso de validación aparece al superar 60 días sin comprobar.
MAX_DIAS_REGISTRO = 60
# Horas de experiencia del nivel 1 en Cataluña: «Experiència d'almenys 2 anys amb un mínim de 1.000 hores» (Agència
# FP.CAT, Guia de la persona usuària, agosto de 2024, pág. 8, posterior a la Resolució PRE/735/2024;
# `cursos/fuentes/agencia/lector.py`), lo mismo que el Real Decreto 659/2023. La Sindicatura (informe 15/2026, cuadro
# 13) atribuye 1.200 a la resolución.
HORAS_NIVEL_1 = 1000

# Umbrales con alarma: por debajo, la lectura del BOE ha fallado de forma visible y hay que revisarla.
MIN_PARTE_CON_ANEXO = 0.97  # certificados del SOC cuyo anexo se encuentra (577 de 585 al incorporar la fuente)
MIN_PARTE_UNIDADES_EN_EL_ANEXO = 0.95  # unidades del SOC que el anexo de su certificado enumera
MIN_PARTE_CODIGOS_CONOCIDOS = 0.97  # códigos de ocupación cuyo grupo existe en su clasificación
MIN_REALES_DECRETOS_DEL_INDICE = 90  # reales decretos de certificados que cita el Real Decreto 189/2013 (95)
# Las cinco ocupaciones del estudio y lo que tiene que dar cada una: certificado y relación. La recepcionista tiene dos:
# el anexo de ADGG0208 (Real Decreto 1210/2009) solo trae códigos de la CNO-94, que relacionan el grupo, y el de
# ADGG0408 (Real Decreto 645/2011) nombra su ocupación.
EJEMPLOS = (
    ("4311.1", "ADGD0308", "ocupacion"),  # empleado de contabilidad
    ("5322.1", "SSCS0108", "grupo"),  # técnico de atención sociosanitaria a domicilio
    ("9313.1", "EOCB0208", "ocupacion"),  # obrero de la construcción
    ("4226.1", "ADGG0408", "ocupacion"),  # recepcionista
    ("4226.1", "ADGG0208", "grupo"),
    ("5223.6", "COMV0108", "grupo"),  # asistente de tienda
    ("4224.1", "HOTA0308", "grupo"),  # recepcionista de alojamientos turísticos
)
# Un grupo ISCO-08 confirmado sin ocupación ESCO: los certificados que tiene que dar (por mayoría de sus ocupaciones).
EJEMPLOS_DE_GRUPO = (("5223", "COMV0108"), ("5322", "SSCS0108"), ("9313", "EOCB0208"))
# Relaciones que la regla da y no tienen sentido, comprobadas a mano contra el anexo (la línea que las da, la
# denominación y las unidades del certificado): se quitan y la validación comprueba que no aparecen. Una clave de 4
# cifras es un grupo ISCO-08 confirmado sin ocupación ESCO.
DESCARTADAS = (
    ("5223.6", "IMPP0208"),  # asistente de tienda: servicios estéticos, por «asesor/a de ventas de cosméticos»
    ("5223.6", "AGAJ0110"),  # asistente de tienda: floristería
    ("5223.6", "ARTB0112"),  # asistente de tienda: relojería
    ("5245.1", "COMV0108"),  # vendedor de gasolinera: actividades de venta, por el grupo de la CNO-94 5330
    ("2166.15", "AGAO0308M"),  # diseñador web: jardinería, por «diseñador de jardines»
    ("5223", "AGAJ0110"),  # grupo de vendedores en tiendas: floristería
    ("5223", "ARTB0112"),  # grupo de vendedores en tiendas: relojería
    ("5223", "TMVG0210"),  # grupo de vendedores en tiendas: recambios de vehículos
    ("5223", "IMPP0208"),  # grupo de vendedores en tiendas: servicios estéticos
    ("5120.1.3", "HOTR0508"),  # cocinero de parrilla: servicio de bar y cafetería, por «Encargado de bar-cafetería»
    ("4323.3", "COML0111"),  # supervisor de equipaje de aeropuerto: viajeros por carretera, por «transporte»
    ("3115.1.22", "FMEE0208"),  # inspector de motores de buques: montaje de maquinaria industrial, por «ajustador»
    ("7127.1", "FMEE0208"),  # instalador de calefacción y ventilación: montaje de maquinaria, por «instalador»
    ("7125.1", "SSCM0108"),  # cristalero (pone vidrios): limpieza de cristales, por «Cristalero de edificios»
    ("3141.2.4", "AGAJ0110"),  # técnico en botánica: floristería, por «Técnico en flores y/o jardinería»
    ("7523.1", "MAMD0109"),  # operario de clavadoras: barnices y lacas, por el código del peón de la madera
    ("3118.3.7", "FMEC0309"),  # diseño electromecánico: diseño naval, por «Diseñadores técnicos industriales»
    ("8211.2", "FMEM0111"),  # montador de motores náuticos: decoletaje, por «Montador-ajustador de máquinas»
    ("2320.1.16", "AGAJ0208"),  # profesor de FP de artes industriales: arte floral, por «Maestro de taller de artes»
    # Control de calidad de textil, piel y calzado, por «Técnicos en control de calidad, en general»:
    ("3111.3", "TCPF0312"),  # analista de alimentos
    ("3112.1.3", "TCPF0312"),  # inspector de calidad de la construcción
    ("3112.1.4", "TCPF0312"),  # especialista en calidad en la construcción
    ("3119.13", "TCPF0312"),  # calidad de infraestructuras de gasoductos y oleoductos
)
# Relaciones admitidas por la revisión, con la regla de docs/acreditacion/norma-fijada.md: una entrada operativa con los
# veredictos de dos revisiones independientes, cuatro juicios por relación
# (plataforma_datos/orquestacion/referencia-fuentes.md); el programa que la escribió no forma parte del producto. La
# revisión manda: se enseña cada relación de la lista cuya ocupación y cuyo certificado están en el paquete, la proponga
# la regla o no, y DESCARTADAS manda sobre todo.
# HUELLA_DE_LA_REGLA es la huella SHA-256 de ese documento, fijada aquí (una prueba la compara con el documento):
# cada fila lleva sus primeros LARGO_HUELLA_EN_LA_LISTA caracteres y una lista hecha con otra regla no se lee.
ADMITIDAS = DATOS / "revisiones" / FUENTE / "admitidas.tsv"
REGLA_DE_LA_REVISION = RAIZ / "docs" / "acreditacion" / "norma-fijada.md"
# Las que la misma revisión descartó (tres o más de los cuatro juicios X), ocupación ESCO a ocupación ESCO: las fuentes
# que relacionan certificados con grupos de ocupaciones enteros (`mercado/fuentes/perfiles/lector.py`,
# `cursos/fuentes/certificados2016/lector.py`) las quitan.
DESCARTADAS_EN_LA_REVISION = DATOS / "revisiones" / FUENTE / "descartadas.tsv"
HUELLA_DE_LA_REGLA: str | None = "a141f1b2c9ff92acc6b19845549c79a92a2ead02ea2d403040a64bbd779d56c8"
LARGO_HUELLA_EN_LA_LISTA = 12
# Los cuatro juicios de cada relación (revisión v2 y v3, revisores A y B) y cuántos tienen que ser C con cita literal.
JUICIOS_DE_LA_REVISION = ("v2_A", "v2_B", "v3_A", "v3_B")
MINIMO_DE_JUICIOS_C = 3
CABECERA_DE_LA_REVISION = (
    "esco",
    "certificado",
    "estratos",
    "en_la_cadena",
    "decision",
    *JUICIOS_DE_LA_REVISION,
    "cita",
    "fecha",
    "regla_sha256",
    "id",
)
# El tipo de una relación admitida que la regla no propone sale de por qué entró en la revisión (sus estratos): A1, el
# anexo nombra la ocupación con su nombre exacto, y VIGENTE-ocupacion, la cadena de Faro ya la propone como relación
# por la ocupación (admitidas.ESTRATOS_DE_LA_CADENA), son «ocupacion»; A2 (las palabras de una línea coinciden con un
# nombre de la ocupación), EST (un código que EURES da como variante estrecha) y VIGENTE-grupo (la cadena la propone
# por el grupo) son «grupo», la afirmación más débil.
ESTRATOS_POR_OCUPACION = frozenset({"A1", "VIGENTE-ocupacion"})
# Palabras que no distinguen un nombre de certificado de otro, y cuánto tiene que parecerse al del SOC el nombre de un
# anexo con su mismo código para ser el suyo (parecido).
PALABRAS_VACIAS = {"de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "al", "por", "para", "con"}
MIN_PARECIDO_MISMO_CODIGO = 0.25
# Erratas de nivel del BOE, comprobadas a mano: el nivel que vale es el del SOC.
ERRATAS_DE_NIVEL = {
    "QUIO0212": "El anexo del Real Decreto 989/2013 dice «nivel 2», pero su cualificación de referencia es QUI477_3 y "
    "el SOC lo da de nivel 3.",
}
# Certificados del SOC cuyos módulos formativos suman más horas que el certificado (AFDA0112: 730 frente a 660). Una de
# las dos cifras está mal y la causa en la fuente está sin confirmar: el motor no da las horas del certificado cuando
# no cuadran (src/dominio/acreditacion.ts), y la validación para si aparece uno nuevo.
HORAS_SIN_CUADRAR = frozenset(
    {
        "AFDA0112",
        "AFDA0212",
        "AFDA0611",
        "ARTB0111",
        "ARTB0211",
        "ELEE0109",
        "ELEE0209",
        "ELEQ0108",
        "ELEQ0208",
        "ELES0111",
        "ENAA0109",
        "EOCE0109",
        "FMEA0111",
        "FMEA0211",
        "HOTR0209",
        "IEXM0209",
        "IEXM0309",
        "IEXM0409",
        "IMAQ0210",
        "MAPN0109",
        "QUIM0309",
        "SEAD0111",
        "SEAD0112",
        "SEAD0512",
        "SSCE0112",
        "SSCE0212",
        "TCPF0209",
        "TCPF0309",
        "TCPP0712",
        "TMVG0210",
        "TMVU0110",
        "TMVU0111",
        "TMVU0210",
        "TMVU0212",
        "TMVU0311",
        "TMVU0312",
        "TMVU0412",
        "TMVU0512",
    }
)
# El código del SOC de una versión propia de un certificado lleva una letra detrás («AGAO0308M»): su anexo es el del
# código oficial, las ocho primeras posiciones.
LARGO_CODIGO_OFICIAL = 8


class Pagina(NamedTuple):
    """Una página que se descarga: su archivo en originales/, su dirección y su título en la procedencia."""

    archivo: str
    url: str
    titulo: str
    licencia: str = LICENCIA_BOE


class Texto(NamedTuple):
    """El texto de un real decreto: su número, su fecha, de qué archivo sale y sus líneas."""

    numero: str
    fecha: str
    archivo: str
    lineas: list[str]
