# Contratos compartidos

Esta carpeta contiene piezas que la aplicación y los motores pueden importar sin cargar la implementación
de otro motor ni un adaptador de ejecución.

- [Contratos](contratos/README.md): tipos, identidades y opciones que cruzan las fronteras entre componentes.
- [Utilidades](utilidades/README.md): operaciones puras utilizadas por esas capas.
- [`contacto-publico.js`](contacto-publico.js): el responsable y el correo públicos de quien publica la copia, con su
  validación. Es la única configuración de ese contacto y se comparte aquí porque la leen la web, el panel y el motor
  del dispositivo. Se entrega con los dos campos vacíos; la entidad que publica los completa antes de publicar, y
  después ejecuta `npm run comunes:generar`, que regenera su copia `web/scripts/contacto-publico.js`, y vuelve a
  construir la web. El [contacto de publicación](../docs/contacto-publicacion.md) detalla qué lo lee y qué valida.

No se adquieren fuentes, se abren conexiones ni se leen archivos aquí. Un cambio de contrato requiere revisar
sus consumidores y las pruebas de compatibilidad; un tipo compartido no convierte una entrada externa en válida.
Las pruebas de independencia de motores comprueban la dirección de las dependencias.
