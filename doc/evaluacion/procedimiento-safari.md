# Procedimiento de evaluación en Safari

## Preparación

1. Arrancar el prototipo sin trazas y abrir `http://localhost:3000` en Safari.
2. Cerrar otras aplicaciones o pestañas que puedan producir carga apreciable.
3. Mantener Safari en primer plano durante cada benchmark.
4. Anotar la versión indicada en `Safari > Acerca de Safari`.

## Cuentas de rendimiento

Registrar una cuenta por tamaño. Todas las contraseñas deben ser ASCII y tener exactamente la
longitud seleccionada.

| Usuario | Tamaño | Contraseña |
| --- | ---: | --- |
| `bench04` | 4 bytes | `a` repetida 4 veces |
| `bench08` | 8 bytes | `a` repetida 8 veces |
| `bench16` | 16 bytes | `a` repetida 16 veces |
| `bench32` | 32 bytes | `a` repetida 32 veces |
| `bench64` | 64 bytes | `a` repetida 64 veces |
| `bench128` | 128 bytes | `a` repetida 128 veces |
| `bench256` | 256 bytes | `a` repetida 256 veces |

Para generar una contraseña larga sin contar caracteres, puede evaluarse `'a'.repeat(128)` o
`'a'.repeat(256)` en la consola de Safari y copiar el resultado.

## Medición

Para cada cuenta:

1. Introducir el usuario y su contraseña en la pantalla de login.
2. Pulsar `Comparar rendimiento` una sola vez.
3. No cambiar de pestaña hasta que finalice.
4. Guardar el bloque que muestra los resultados de `I`, `I+A`, `FS` y `FS+A`.

El botón intercala las cuatro configuraciones, realiza cinco calentamientos y conserva treinta
mediciones por configuración. La salida visible contiene media, mediana y percentil 95. Las
muestras individuales y el identificador del navegador quedan disponibles en
`window.lastBenchmarkResult` desde el inspector web.

## Validación funcional

Realizar y documentar los siguientes casos desde la interfaz:

| Caso | Acción |
| --- | --- |
| Registro correcto | Registrar una cuenta nueva. |
| Usuario duplicado | Intentar registrar de nuevo el mismo nombre. |
| Cuatro configuraciones válidas | Autenticar con los cuatro estados posibles de los dos selectores. |
| Contraseña incorrecta interactiva | Usar otra contraseña ASCII de la misma longitud. |
| Contraseña incorrecta Fiat-Shamir | Repetir activando Fiat-Shamir. |
| Usuario inexistente | Intentar autenticar un nombre no registrado. |
| Sesión y logout | Acceder a la zona privada, cerrar sesión y volver a solicitarla. |

Si se quieren registrar los códigos HTTP, activar el menú de desarrollo de Safari y consultar la
pestaña `Red` del inspector. Para la memoria basta con una captura representativa de aceptación y
otra de rechazo; no es necesario incluir las treinta repeticiones.
