# Diagramas simplificados para la memoria

Esta carpeta contiene las fuentes canónicas de los diagramas utilizados en el cuerpo principal del
TFG. Se mantiene una única versión de cada flujo para evitar divergencias entre diagramas
detallados y simplificados.

## Diagramas disponibles

1. `00_arquitectura_simplificada.puml`: módulos, ficheros principales y reparto de responsabilidades.
2. `01_flujo_global_simplificado.puml`: visión general de las funcionalidades.
3. `02_registro_simplificado.puml`: generación y persistencia de los datos de verificación.
4. `03_login_interactivo_simplificado.puml`: intercambio ronda a ronda de Sum-Check.
5. `04_login_fiat_shamir_simplificado.puml`: prueba no interactiva enviada en una petición.
6. `05_compromiso_polinomial_simplificado.puml`: extensión didáctica Commit–Open–Verify.
7. `06_despliegue_docker.puml`: despliegue reproducible de aplicación, inicialización y PostgreSQL.

## Criterio de simplificación

Se mantienen los actores, objetos, datos y decisiones que cambian el comportamiento o explican una
garantía del prototipo: procesamiento local de la contraseña, creación y destrucción del prover,
sesión verificadora del modo interactivo, transcript Fiat-Shamir, persistencia de datos de
verificación, apertura polinomial opcional y creación de la cookie tras una verificación correcta.

Se muestran objetos con estado y ciclo de vida relevante, como `InteractiveSumCheckProver`,
`SumCheckVerifierSession` y la prueba Fiat-Shamir. En cambio, se omiten funciones auxiliares,
serialización, operaciones elementales del cuerpo finito y trazas que no alteran el significado del
flujo.

Los diagramas con y sin compromiso polinomial se han unificado mediante bloques opcionales. Esto
evita duplicar casi todo el flujo y hace visible que el compromiso es una extensión de ambos modos de
autenticación, no un protocolo de login independiente.

En Fiat-Shamir, el compromiso `C_f` forma parte del enunciado siempre que exista en el registro; la
opción de la interfaz solo activa o desactiva la comprobación de su apertura. En el modo interactivo,
el vector de retos `r` se genera durante el desafío de registro, se persiste y se entrega completo al
cliente cuando comienza el login.

Los subdirectorios `svg/`, `png/` y `pdf/` contienen las salidas generadas para previsualización y
documentación. El directorio `pdf/cropped/` contiene los PDF vectoriales ajustados al contenido que
se emplean al insertar las figuras en LaTeX.

Para insertar las figuras en LaTeX deben utilizarse preferentemente los documentos de
`pdf/cropped/`. Estas versiones vectoriales ajustan el tamaño de la página al contenido del diagrama
y, por tanto, no introducen los márgenes blancos del formato A4:

```latex
\begin{figure}[p]
    \centering
    \includegraphics[
        width=\linewidth,
        height=0.90\textheight,
        keepaspectratio
    ]{doc/diagramas/memoria/pdf/cropped/00_arquitectura_simplificada.pdf}
    \caption{Arquitectura lógica del prototipo.}
\end{figure}
```

El script `scripts/generate_diagrams.sh`, invocado mediante `npm run doc:diagramas`, elimina las
salidas anteriores y regenera de forma conjunta todos los formatos.
