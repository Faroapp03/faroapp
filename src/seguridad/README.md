# Protección de datos, firmas y controles de acceso

`firma.ts` emite y comprueba HMAC-SHA-256 sobre la caducidad y el JSON canónico. Deriva una subclave por uso
mediante HKDF y admite una clave anterior durante la rotación. Una firma de un uso no acredita otro.
La firma tiene el formato `kid.caducidad.hmac`, con caducidad Unix en milisegundos de 13 cifras.

El secreto de texto requiere al menos 32 bytes UTF-8. También se admite una clave HMAC-SHA-256 de Web Crypto
que permita firmar y verificar. Las subclaves no se pueden extraer. Sin secreto configurado, la clave es efímera
y las firmas no sobreviven al proceso. El reloj y la vigencia deben producir la caducidad entera descrita.

La canonicalización rechaza texto Unicode malformado sin sustituirlo ni normalizarlo. El firmador rechaza esos datos;
su comprobador devuelve `false`. Los demás errores de datos no JSON y de Web Crypto se propagan.
La caducidad es inclusiva: la firma se rechaza cuando el reloj la supera.

Las pruebas de [firmas](../../pruebas/seguridad/firma.test.ts) contrastan los bytes con `node:crypto`, separación por uso,
rotación, caducidad y errores. Las pruebas de [JCS](../../pruebas/comun/jcs.test.ts) verifican la serialización canónica.
Estas firmas acreditan procedencia e integridad de los datos firmados; no cifran su contenido.

`limitador.ts` cuenta las lecturas de la API por red: 1.800 peticiones en una ventana de diez minutos.
Agrupa las direcciones IPv6 por prefijo /64. La ventana debe ser finita y positiva; una configuración inválida
falla al crear el limitador. Al llenarse la capacidad de clientes, primero retira los caducados y después
rechaza clientes nuevos, conservando los conocidos. Un máximo de cero cierra el acceso. El mismo algoritmo
genérico sirve a los límites de consultas y credenciales de los servicios factuales.

Las [invitaciones institucionales](../../docs/conectividad.md) requieren una sesión administrativa vigente.
El enlace caduca, solo puede consumirse una vez y no contiene una clave de consulta ya emitida. La activación
intercambia ese permiso por una clave que se muestra una sola vez; el almacén guarda únicamente su huella.
Las claves, cuotas, revocaciones y sesiones se mantienen en el almacén operativo. Ninguna clave institucional
concede autoridad administrativa. La página de activación excluye caché, precarga e informes del navegador.

Las pruebas de [límites](../../pruebas/seguridad/limitador.test.ts) y los circuitos de instituciones verifican
invitación, caducidad, consumo único, relevo y retirada en Node y Worker con almacenamiento real de prueba,
sin enviar secretos a servicios externos.

`privacidad.ts` compone la minimización de datos personales para navegador y servidor. Normaliza los acentos a NFC,
retira caracteres que ocultan identificadores y aplica las limpiezas en orden: cuentas y afiliación, identificadores,
direcciones, empresas y nombres. Ese orden evita confundir un documento con un portal o quitar solo una parte de
una empresa. Devuelve el texto resultante y el número de sustituciones; una segunda limpieza no vuelve a contarlas.

Los módulos `identificadores.ts`, `direcciones.ts` y `empresas.ts` reconocen formas específicas.
`patrones-de-nombres.ts`, `otras-personas.ts` y `nombres-de-persona.ts` usan el contexto y la lista oficial de
`datos/nombres.json` para conservar las palabras de oficio y quitar nombres donde hay evidencia suficiente.
Los patrones con estado se reinician antes de su recorrido; las lecturas son síncronas.

La minimización no garantiza anonimato: un nombre sin contexto reconocible puede permanecer. También puede
retirar una palabra ambigua si coincide con un apellido o con parte de una cuenta anunciada. El contexto y los
límites del reconocedor se comprueban con casos de conservación y de retirada. El consumidor debe aplicar `limpiarDatosPersonales` antes de procesar el texto y mantener el aviso de privacidad.
Las pruebas del corpus ES/CA comprueban que se retiran identificadores, se conserva el trabajo descrito y la
limpieza es idempotente. Los ensayos y mediciones independientes se conservan fuera del producto.

`texto-para-buscar.ts` compone esa misma minimización con la retirada de las marcas exactas del limpiador y la
agrupación de espacios. Conserva otros textos entre corchetes; la opción `omitirCorchetes` permite excluirlos
también. Así las marcas de sustitución no participan en las coincidencias del buscador. El consumidor valida
primero el tamaño de entrada y aplica después su límite de búsqueda. La función no guarda consultas ni conserva
el original; sus límites de reconocimiento son los del filtro compartido.

El reconocimiento de correos literales incluye los signos de `atext` de [RFC 5322, §3.2.3](https://www.rfc-editor.org/rfc/rfc5322#section-3.2.3),
además de las letras Unicode admitidas. Un signo como `{` o `!` pegado delante puede formar parte de la dirección
y se retira con ella. No es un validador completo de correo: las partes locales entre comillas, las formas obsoletas
y los dominios literales quedan fuera del alcance de este patrón. Las pruebas cubren signos, fronteras,
conservación del texto circundante e idempotencia.

`moderacion.ts` decide sobre las categorías declaradas por el moderador. Prioriza la ayuda ante intención o
instrucciones de autolesión; otras categorías bloquean siempre o a partir del umbral definido en el módulo.
Si falta una puntuación, una categoría marcada cuenta como alta. Sin moderador configurado se continúa;
si el moderador configurado falla, el error se propaga y el consumidor debe interrumpir la llamada posterior.
`avisos.ts` conserva los textos ES/CA que corresponden a estas decisiones.
