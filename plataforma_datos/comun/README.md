# Datos comunes

Este tema agrupa los nombres oficiales de grupos del Idescat, las traducciones conservadas al catalán, los nombres y apellidos del INE y los nombres territoriales de Unicode CLDR. Cada fuente mantiene su identidad, sus validaciones y su casa operativa; compartir tema no combina sus poblaciones ni sus licencias.

Los originales y conjuntos siguen en `var/actualizacion/`. Idescat y territorios son entradas de otros productores; no adquieren una exportación pública independiente. Los exportadores existentes de catalán y nombres conservan su comportamiento.

La cadena solo valida `catalan`: no ejecuta sus etapas de descarga o preparación, no llama a modelos y no genera traducciones. El lector conserva sus otras órdenes individuales; su existencia no autoriza ejecutarlas durante una reconstrucción.

`fuentes/territorios/constantes.py` es el único propietario de la cita y licencia CLDR. No importa el agregado derivado. Los descriptores de cada fuente documentan la operación actual; sus README se generan con `python -m plataforma_datos.contratos.fuentes --tema comun`. Los lectores se invocan desde la raíz como `python -m plataforma_datos.comun.fuentes.<id>.lector`. Las pruebas están en `pruebas/`.

`config/identidad-web.json` contiene la identidad que consumen todos los transportes.
`perfil_web.py` valida ese contrato y contiene el único generador canónico. No
es una fuente estadística ni crea registros de datos. La cadena lo utiliza al
consultar; las pruebas comprueban identidad, negociación de idioma y compresión
sin abrir conexiones. El perfil HTML es explícito y nunca se aplica por defecto
al descargar una API o una fuente cuyo idioma deba conservarse.

El lector central admite solo el UA canónico de Chrome con versión completa de
cuatro componentes. El JSON exige las tres pistas coherentes con esa versión;
una configuración incompleta no se rellena silenciosamente. Una versión parcial o un
navegador alternativo no entra en el flujo normal. `validar_agente` conserva su
validación genérica para consumidores explícitos; no activa repuestos tras 403.

La marca GREASE, su versión y el orden de las tres marcas de `sec-ch-ua` se
calculan desde el major siguiendo `GetGreasedUserAgentBrandVersion`,
`GetRandomOrder` y `ShuffleBrandList` de
[Chromium](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/embedder_support/user_agent_utils.cc).
La permutación asigna posiciones de destino; Chrome 156 conserva exactamente su
cabecera previa. Esto no descubre versiones ni cambia precedencia de configuración.

El generador acepta la versión estable completa como metadato y reduce el UA a
`major.0.0.0`; las pistas usan el mismo major. Una configuración explícita que
exponga otro build no se corrige silenciosamente: el lector central la rechaza.
