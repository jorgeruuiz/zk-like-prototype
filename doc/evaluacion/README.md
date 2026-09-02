# Resultados de evaluación

Esta carpeta conserva las evidencias utilizadas en el capítulo de evaluación de la memoria. Las
mediciones se realizaron contra el despliegue Docker Compose local del prototipo.

## Entornos

- macOS 26.5.1, Apple M1 con 8 núcleos y 16 GB de memoria: Safari 26.5 y Firefox 152.0.6.
- Windows 11 Home 25H2, AMD Ryzen 7 5800HS y 16 GB de memoria: Edge 149.0.4022.98,
  Chrome 148.0.7778.178 y Firefox 152.0.6.
- Docker Engine 29.5.3 y Docker Compose 5.1.4.
- Aplicación: Node.js 22.23.1 sobre Debian 12.
- Base de datos: PostgreSQL 17.10.
- Dirección utilizada desde los navegadores: `http://localhost:3000`.

No deben publicarse números de serie, UUID ni otros identificadores únicos de los equipos.

## Metodología

La validación funcional registra una cuenta aislada y comprueba:

- las cuatro configuraciones de autenticación;
- el rechazo de usuario duplicado y usuario inexistente;
- el rechazo de contraseña incorrecta en modo interactivo y Fiat--Shamir;
- la creación de la cookie, el acceso a la zona privada y el cierre de sesión.

El rendimiento se mide para contraseñas de 4, 8, 16, 32, 64, 128 y 256 bytes. Para cada tamaño se
ejecutan cinco repeticiones de calentamiento y treinta repeticiones medidas. Dentro de cada
repetición se recorren las cuatro configuraciones antes de comenzar la siguiente, siempre en el
mismo orden. Las trazas están desactivadas y el setup polinomial se carga durante el calentamiento.

La métrica principal es la latencia extremo a extremo observada desde el navegador mediante
`performance.now()`: generación local de la prueba, comunicación HTTP y respuesta del servidor.
Los valores `elapsedMs` devueltos por los dos modos no deben compararse entre sí, ya que cubren
intervalos diferentes en la implementación.

El número de peticiones no se obtiene mediante una medición de tráfico. Se deduce de los endpoints
que forman cada flujo: el modo interactivo utiliza una petición inicial, una por ronda y una de
finalización (`r + 2`), mientras que Fiat--Shamir utiliza una inicial y otra final (`2`). La apertura
polinomial se incorpora a la petición final y no añade intercambios. La carga única de
`GET /api/poly-setup`, realizada antes de las mediciones, queda fuera de este recuento.

## Ficheros

- `resultados-funcionales.json`: resultados de aceptación, rechazo y sesión web.
- `resultados-rendimiento-safari.json`: exportación original de las mediciones de Safari.
- `resultados-rendimiento-final.csv`: resumen final de media, mediana y percentil 95 para las cinco
  combinaciones de navegador y entorno incluidas en la memoria.
