# Confianza TLS del mantenimiento Python

El mantenimiento HTTPS utiliza **certifi 2026.10.23**, fijado en los requisitos y
el lock de ruedas. La versión de Python, OpenSSL o pip no sustituye por sí sola
la actualización de las raíces de confianza. No se modifica el almacén del
sistema operativo.

`plataforma_datos/comun/confianza_tls.py` verifica la versión instalada y los bytes
de `certifi/cacert.pem`, dentro de la dependencia instalada, antes de construir el contexto. Exige certificado válido,
hostname correcto y TLS 1.2 o superior. No carga CA del sistema, HOME, cwd o
variables `SSL_CERT_FILE`/`SSL_CERT_DIR`, ni habilita `SSLKEYLOGFILE`.

Los clientes urllib común, Cibernàrium y bootstrap reciben ese contexto
explícitamente. El cliente urllib3 de mantenimiento también lo recibe. El SDK
S3 recibe la ruta de la misma CA ya verificada; conserva firmas, autenticación,
destinos y límites. Como el SDK oficial interpreta `SSLKEYLOGFILE` al crear su
propio contexto, una variable no vacía se rechaza antes de construir la sesión.
No se modifica el entorno para ocultar esa configuración.

El contrato `.python-version` fija Python **3.12.15**: el provisionador selecciona
esa versión y el producto admite versiones finales desde ese parche dentro de
la misma rama 3.12. Bootstrap y verificador reutilizan la misma comprobación
local; una versión mayor de otra rama no se admite implícitamente. El campo
`python` del lock identifica la rama, no sustituye este mínimo de parche.

## Preparación sin confianza circular

La carpeta entregada incluye una semilla pública en
`plataforma_datos/comun/confianza_tls/`: PEM íntegro, licencia original y
procedencia de la rueda oficial. La semilla procede del mismo artefacto fijado,
no de un almacén particular ni de una selección manual de raíces.

El preparador verifica la semilla antes del primer envío, sin importar certifi.
Descarga solo las ruedas fijadas, con HTTPS, límites, identidad y pausas del
transporte vigente, y comprueba sus tamaños y SHA-256. Después crea un venv
**nuevo** e instala desde archivos locales:

1. Pip **26.2.2** como única primera rueda.
2. Las demás dependencias, incluido certifi fijado.
3. `pip check` y la comprobación de versión de pip, versión de certifi e igualdad
   de la CA con la semilla admitida.

Las invocaciones de pip usan aislamiento, `--no-index`, `--no-deps`,
`--require-hashes`, solo ruedas y ninguna caché. El pip inicial de ensurepip
instala únicamente un archivo local verificado; no acredita la procedencia de
la semilla ni necesita una consulta TLS. Un fallo no acredita la instalación y
retira solo la reserva propia del preparador. Nunca se actualiza un venv
preexistente, compartido o ajeno.

La ausencia o alteración del paquete, la versión, la CA, la semilla o su
procedencia produce un error; no permite volver al almacén antiguo. El checkout
y el venv deben permanecer privados y sin escritores concurrentes durante su
uso. Las rutas se resuelven desde los archivos del producto y del paquete.

## Actualización de la confianza

Una actualización requiere verificar el artefacto oficial y cambiar juntos el
pin de certifi, requisitos, lock, semilla íntegra, licencia, procedencia y huellas
del helper. La semilla y el certifi instalado deben conservar exactamente los
mismos bytes. `procedencia.json` conserva la URL, versión, tamaño, SHA-256 y
fecha de adquisición real del artefacto. La fecha de instalación no acredita
una nueva adquisición de datos.

Este paquete oficial de certificados coincide con la lista de raíces de Mozilla del 20/10/2026 (118 raíces). No contiene
emSign ECC Root CA-G3 (huella SHA-256 `86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b`) ni emSign Root
CA - C1 ni emSign ECC Root CA - C3, que Mozilla retiró. Las raíces se cambian solo actualizando el artefacto oficial
completo; no se editan a mano.

La fuente `version_certifi` (`plataforma_datos/comun/fuentes/version_certifi/`) observa cada 30 días la última versión
publicada en `https://pypi.org/pypi/certifi/json` (una petición, con la pausa común por dominio). Si es distinta de la
fijada, su conjunto validado lleva un aviso con forma cerrada (`clave`, `fijada`, `publicada`, `consultado` y `texto` en
castellano y catalán) para el panel. No cambia nada: renovar el almacén sigue siendo una decisión con revisión. Está
registrada como productor candidato, como `versiones_navegadores`.

## Intermedios conocidos

Algunos servidores públicos no envían su cadena de certificados entera: falta el certificado que emitió el suyo, y
la verificación falla con `unable to get local issuer certificate` aunque la raíz esté en la lista. Faro no relaja la
verificación para ellos (la cadena parcial, `VERIFY_X509_PARTIAL_CHAIN`, sigue apagada): lleva una lista corta y
cerrada de certificados intermedios, `INTERMEDIOS` en `confianza_tls.py`, que `contexto_tls()` carga junto a las raíces
solo para completar cadenas. Un intermedio nunca es una raíz de confianza: una hoja emitida por él solo se verifica si
la cadena termina en una raíz de la lista.

Hoy son los dos que completan la cadena de `agora.fundae.es` (FUNDAE): «AC SERVIDORES SEGUROS TIPO2 G2R» y «AC RAIZ
FNMT-RCM SERVIDORES SEGUROS G2R», que encadenan con la raíz «AC RAIZ FNMT-RCM». Cada uno es un PEM en
`plataforma_datos/comun/confianza_tls/intermedios/` y se declara en el código y en `procedencia.json` con su nombre,
huella SHA-256 y tamaño del certificado en DER, emisor esperado, caducidad, origen (dirección pública o quién lo envió) y
fecha de obtención.

Antes de cargar cada uno, `contexto_tls()` comprueba que el archivo es un PEM regular (no un enlace), que su huella y
su tamaño son exactamente los declarados, que es una autoridad (`CA:TRUE`), que no es autofirmado, que su emisor es el
declarado y que no ha caducado. Si falla cualquiera, ese certificado no se carga, el contexto sigue con los demás y se
escribe un aviso por la salida de errores, una vez por proceso. Lo que dependa del intermedio descartado vuelve a fallar
con el error de verificación de siempre hasta que se revise.

Para añadir un intermedio:

1. Descargar el certificado de la dirección que indica el campo `CA Issuers` del certificado que no se verifica
   (`openssl s_client -connect servidor:443 -showcerts` y `openssl x509 -noout -text`) o tomarlo de la cadena que
   envía el servidor; anotar la dirección y la fecha.
2. Guardarlo como PEM, sin cambiar el certificado, en `confianza_tls/intermedios/`, y calcular su huella y su tamaño en
   DER (`openssl x509 -in archivo.pem -outform DER | openssl dgst -sha256`).
3. Comprobar que encadena con una raíz de la lista: `openssl verify -CAfile <cacert.pem> -untrusted <intermedios.pem>
   <hoja.pem>` debe dar `OK`, y la raíz de la cadena debe estar en `confianza_tls/cacert.pem`.
4. Declararlo en `INTERMEDIOS` y en `procedencia.json` (con los mismos datos), y actualizar `PROCEDENCIA_SHA256` y
   `PROCEDENCIA_BYTES` con los del nuevo `procedencia.json`.
5. Comprobar con `plataforma_datos.comun.pruebas.test_confianza_tls` y, con red, que la conexión funciona con
   `contexto_tls()`.

Para retirar uno (porque caduca o porque el servidor ya envía su cadena completa): quitarlo de `INTERMEDIOS`, de
`procedencia.json` y de la carpeta, y actualizar las mismas dos constantes. Un intermedio caducado ya no se carga solo.
Las rutas de bootstrap (`contexto_tls_bootstrap()` y `ruta_ca_runtime_verificada()`) no usan intermedios.

## Cifrados heredados por dominio

Un servidor que solo ofrece un cifrado antiguo no conecta con los cifrados modernos de Faro. `CIFRADOS_HEREDADOS`, en
`confianza_tls.py`, es una lista cerrada de dominios exactos (sin comodines ni subdominios) a los que se les permite,
además de los modernos, un cifrado concreto, con su motivo y la fecha de la evidencia. `contexto_tls(dominio)` devuelve
para ellos un contexto idéntico al normal (mismas raíces e intermedios, misma verificación del certificado y del nombre,
misma versión mínima, TLS 1.2) más ese cifrado. Cualquier otro dominio recibe el contexto de siempre.

`plataforma_datos/comun/red.py` pide el contexto en cada conexión, según el dominio al que va a conectar, así que una
redirección a otro dominio vuelve al contexto normal. El resto de clientes (Cibernàrium, mantenimiento, S3 y bootstrap)
conectan con sus servidores propios y no usan esta lista.

| Dominio | Cifrado | Motivo | Evidencia |
| --- | --- | --- | --- |
| `portaldogc.gencat.cat` | `AES256-SHA` (TLS 1.2) | Solo negocia este cifrado, sin secreto hacia delante; rechaza ECDHE y GCM. Su certificado se verifica igual. | 15/11/2026 |

Para añadir un dominio hace falta una evidencia de que el servidor no ofrece ningún cifrado moderno (la negociación
falla con `SSLV3_ALERT_HANDSHAKE_FAILURE` y funciona al permitir ese cifrado) y que su certificado se verifica con
normalidad. Se retira en cuanto el servidor negocie un cifrado moderno.

Esta política cubre el HTTPS Python del producto y el bootstrap de sus ruedas.
Git, curl, npm, Node, los navegadores y los provisionadores externos mantienen
sus propios almacenes y requieren sus comprobaciones correspondientes. No se
modifican sus políticas ni se declara realizada una consulta remota por haber
instalado dependencias. El comportamiento de URL HTTP permanece sin cambios.
