# Contacto de publicación

La única configuración de responsable y correo públicos está en
[`compartido/contacto-publico.js`](../compartido/contacto-publico.js). Ambos campos se entregan vacíos. Quien publique
la copia completa los datos de su entidad; el correo no es una credencial.

Después de cambiarlos, ejecutar `npm run comunes:generar` y `npm run web:preparar` (el motor empaqueta
`compartido/contacto-publico.js`). La publicación `web/scripts/contacto-publico.js` se genera: no se edita por separado.
La validación rechaza campos ajenos, controles en el nombre y direcciones que no tengan el formato admitido; no
comprueba que exista el buzón.

Privacidad, accesibilidad y el envío del diagnóstico leen esta configuración. Un campo vacío no se sustituye por la
identidad del autor del software. Sin correo no se crea un enlace de contacto ni se ofrece el envío del diagnóstico. El
programa de correo solo se abre por acción de la persona; Faro no envía correos.

Los identificadores de problemas HTTP pertenecen al contrato API y no son datos de contacto de publicación. El
responsable y su buzón se toman siempre de esta configuración.

Antes de publicar, la entidad responsable completa también la información jurídica de «Tus datos»: la base aplicable a
cada tratamiento, las condiciones y plazos del alojamiento, los destinatarios y, si proceden, las transferencias
internacionales. No se deduce una base jurídica del hecho de instalar el software ni se presenta la identidad del autor
como responsable del tratamiento. La página describe la minimización implementada; los registros del alojamiento
dependen del contrato y de la configuración de quien publica.

Referencias para esa configuración: [derechos ante el responsable,
AEPD](https://www.aepd.es/derechos-y-deberes/ejerce-tus-derechos) y [tratamiento del tráfico por
Cloudflare](https://www.cloudflare.com/privacypolicy/). El contacto vacío de la distribución no acredita que la
información de una publicación pública esté completa.
