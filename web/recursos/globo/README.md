# Recursos del globo

Lo que dibuja el globo de «Datos globales» (`web/scripts/globo/`), servido por Faro desde su mismo origen: ninguna
petición a terceros. Los recursos y sus originales están identificados por huella en `procedencia.json`;
`pruebas/web-globo/globo-recursos.test.js` comprueba las huellas y tamaños de los recursos presentes.

- `tierra.jpg`: La imagen de satélite de la Tierra de la NASA (Blue Marble: Next Generation, julio de 2004, con relieve
  y fondo marino, NASA Earth Observatory), de 5400 × 2700 a 2048 × 1024 en JPEG sin metadatos, 219 KB. Dominio público
  en EE. UU. según las condiciones de uso de la NASA, que piden reconocerla como fuente sin sugerir su respaldo: el
  globo lo dice debajo de la escena.
- `fronteras.json`: Los 177 países de Natural Earth 5.1.2 a escala 1:110 m y Cataluña (la unión de sus cuatro
  provincias de la capa de regiones 1:10 m, simplificada a 0,01°), en centésimas de grado y en diferencias, 125 KB
  (35 KB con gzip). Dominio público. Fronteras de facto, el criterio de Natural Earth: el mapa no toma posición sobre
  las
  fronteras en disputa.
- `procedencia.json`: De cada original, su dirección, su página, su autoría, su licencia con sus palabras y su huella,
  con la fecha de consulta; de cada recurso, su huella, su tamaño y la orden que lo hizo.

## Reconstruir los recursos

La web usa los recursos preparados. Reconstruirlos requiere Node, las dependencias de desarrollo instaladas y
ffmpeg disponible en PATH. Para reproducir exactamente esta versión, utiliza las versiones registradas de ffmpeg
en `procedencia.json` y de Biome en `package-lock.json`.

Reúne en una carpeta los tres originales indicados en `procedencia.json`, con sus nombres originales:

- `world.topo.bathy.200407.3x5400x2700.jpg`.
- `ne_110m_admin_0_countries.geojson`.
- `ne_10m_admin_1_states_provinces.geojson`.

Ese archivo identifica las direcciones de origen, versiones, licencias y huellas. Conserva los originales como
insumos de mantenimiento, separados de los recursos que se sirven en la web. No se necesitan para abrir Faro.
La herramienta no descarga archivos y rechaza cualquier original cuya huella no coincida.

Desde la raíz del producto, en una copia que no esté sirviendo tráfico:

```sh
npm run globo:generar -- --originales "/ruta/Originales del globo"
npm run web:preparar
npm run verificar
```

La generación prepara y valida los tres resultados antes de sustituirlos. Si falla la preparación, conserva los
recursos anteriores. La sustitución de los tres archivos no es una transacción frente a interrupciones del sistema;
comprueba siempre el resultado antes de desplegar. Una versión distinta de ffmpeg puede producir otros bytes:
revisa la diferencia antes de aceptar nuevas huellas.
