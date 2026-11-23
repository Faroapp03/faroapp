# Idiomas

Los diccionarios castellano y catalán contienen los textos preparados de la web. No llaman a un traductor externo
ni a IA durante el uso. El catalán está traducido con IA; conserva las claves y marcadores del castellano y requiere
revisión lingüística humana antes de atribuirle una revisión profesional.

- `es.js` y `ca.js` reúnen las siete partes de cada lengua en un objeto plano, conservando su orden.
- `es/` y `ca/` agrupan páginas, la guía «Qué es la IA», créditos, créditos de datos globales, instalación,
  recorrido y lecturas.
- `cargar.js` importa el idioma solicitado y lo registra en [textos.js](../scripts/textos.js).

## Carga y cambio

[idioma-inicial.js](../scripts/idioma-inicial.js) decide el idioma antes del primer pintado. Manda la elección válida
guardada en `faro-idioma`; si falta, usa catalán cuando sea el primer idioma del navegador, y castellano en los demás
casos. Precarga un diccionario y apunta su manifiesto. En catalán retira la ocultación al traducir o tras 1,5 segundos.

[idioma.js](../scripts/idioma.js) espera el diccionario elegido. Si falla, intenta el castellano; si ninguno llega,
conserva el HTML. Un fallo de carga permite reintentar con `#reintento-N`: cambia la identidad del módulo de entrada,
pero sus importaciones estáticas conservan su URL. Recuperar una parte fallida depende del cargador del navegador.
Una versión nueva del service worker impide solicitar un diccionario pendiente desde una página ya controlada por
la versión anterior. Los diccionarios cargados se reutilizan.

El cambio reescribe contenido y atributos marcados, conserva los hijos de las plantillas y atiende el último idioma
pedido. Emplea nodos de texto y atributos, sin interpretar etiquetas. Un dato externo se presenta como literal o como
dato con versiones por lengua, con su atributo `lang`.

## Claves y marcadores

Cada clave identifica un texto completo por ámbito, como `comun.menu.abrir`. `{nombre}` representa un valor del script;
`{0}`, `{1}` y los demás índices representan los hijos originales del elemento. Ambas lenguas conservan los mismos
marcadores. Los textos literales exigidos por licencias y los datos oficiales conservan su idioma y procedencia.

Para añadir textos, mantener ambos diccionarios y sus marcadores. Un mismo texto en castellano se dice de una sola
manera en catalán en todo el sitio: lo exige `pruebas/web-idiomas/textos.test.ts`, que nombra las excepciones.
Para contenido dinámico, usar `traducible` con `escribir` o `escribirAtributo`; `texto` resuelve de inmediato y sirve
para mensajes que no se vuelven a pintar.
Las pruebas de la familia están en [pruebas/web-idiomas](../../pruebas/web-idiomas/). La concordancia con páginas y
consumidores completos se comprueba cuando estos están disponibles; estas pruebas no afirman esa cobertura.

## Términos para revisar

El catalán es estándar (IEC, con la ortografía de 2016: «dona», «soc»), con tuteo como el castellano, botones en
infinitivo como en el castellano y la terminología de ocupación y formación que usan el SOC y la Generalitat
(«ocupació», «formació per a l'ocupació», «especialitats formatives»). Estas son las decisiones que un revisor de
catalán puede querer mirar:

1. **Nombres propios de los créditos.** Se conservan tal cual; si tienen un nombre oficial en catalán, se usa ese.
2. **Tiempo dedicado a una tarea.** «Mucho / Algo / Poco» es «Molt / Una mica / Poc». «Una mica» es más largo y
   puede sonar a «poco»; alternativa: «Força».
3. **«Feina» y «treball».** «Feina» para el trabajo de la persona («la teva feina», «tipus de feina») y «treball» en
   nombres y usos formales («IA, treball i formació», «Observatori del Treball», «lloc de treball»).
4. **Reinicio del recorrido.** «Començar de nou» (`que-es-faro.nuevo.local`) describe la acción de reiniciar el recorrido.
5. **Rótulos de los navegadores** (`instalacion.*`): «Instal·la l'aplicació», «Afegeix a la pantalla d'inici» y
   «Comparteix» deben coincidir con los de Chrome, Safari y Android en catalán.
6. **Cita del INE.** Se conserva literal, en castellano, como la publica el INE («Elaboración propia con datos
   extraídos del sitio web del INE: www.ine.es»), también en el informe en catalán, donde va marcada con su idioma
   (`lang="es"`, `src/presentacion/informe-breve/contexto-sectorial.ts`, `publicado`); la de la CNO-11, igual.
7. **Licencia.** «Creative Commons Reconeixement 4.0 (CC BY 4.0)», el nombre oficial en catalán.
8. **Franjas del informe** (`informacion-y-creditos.oit.texto`): «baix, mitjà, alt», en masculino como las etiquetas
   del informe; coinciden con las que usa el motor en el informe en catalán.
9. **Ejemplo de la palabra siguiente** (`entender-ia.ejemplo.*`): las frases y las palabras se han adaptado para que
   continúen bien en catalán («Aquest matí he anat al… metge»); los porcentajes son los mismos, inventados.
10. **Detalles de estilo.** «Anar al contingut» (enlace de salto), «Tasca 2 treta» (al quitar una tarea), «tot
    Catalunya», «Ordre» (la tecla Comando de los Mac) y los numerales femeninos («dues tasques»).

11. **Guía «Qué es la IA»** (`entender-ia.*`, en `ca/guia-ia.js`): «spam» y no «correu brossa», como el castellano
    dice «spam» y no «correo no deseado»; «Desafiament», «Precaucions», «Data de tall», «Biaix» y «donar hora». El
    glosario se ordena en la página con el orden alfabético catalán (scripts/glosario.js).

Si una persona revisa el catalán, se anota aquí y en la cabecera de `ca.js`, con la fecha y quién lo hizo.
