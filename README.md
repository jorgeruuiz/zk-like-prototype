# Prototipo de autenticación ZK-like

Este repositorio contiene el prototipo desarrollado para el TFG sobre autenticación basada en pruebas de conocimiento cero. El sistema permite registrar usuarios y autenticarlos sin enviar la contraseña al servidor. Para ello, la contraseña se procesa en el navegador y se verifica mediante una adaptación didáctica del protocolo Sum-Check.

El proyecto incluye dos modos de autenticación:

- modo interactivo, en el que cliente y servidor intercambian las rondas del protocolo;
- modo no interactivo, basado en la transformación de Fiat-Shamir.

Además, se incorpora una extensión opcional de compromiso polinomial. Esta parte sirve para estudiar el flujo `Commit-Open-Verify`, pero no debe interpretarse como una implementación segura de KZG: el `trusted-setup.json` incluido es educativo y el valor `tau` es público en el propio prototipo.

## Estructura del proyecto

La organización principal del código es la siguiente:

```text
server/
  server.js              Punto de entrada del servidor HTTP.
  app.js                 Rutas, coordinación del protocolo y sesiones temporales.

database/
  db.js                  Configuración del pool de PostgreSQL.
  db_setup.js            Creación y migración de la tabla usuarios.
  user_repository.js     Operaciones de lectura y escritura sobre usuarios.

sum-check-protocol/
  field.js               Operaciones del cuerpo finito.
  protocol.js            Funciones comunes del protocolo.
  prover.js              Construcción de pruebas por parte del cliente.
  verifier.js            Verificación interactiva.
  fiat-shamir.js         Variante no interactiva.
  polynomial-commitment.js
                         Compromiso polinomial didáctico.

public/
  index.html             Autenticación y benchmark.
  register.html          Registro de usuarios.
  private.html           Página protegida tras login correcto.

scripts/
  start-docker.*         Arranque del sistema con Docker.
  stop-docker.*          Parada del sistema con Docker.
  clean.sh               Limpieza controlada de usuarios.
  rebuild.sh             Reconstrucción del entorno.
  generate_diagrams.sh   Generación de diagramas PlantUML.

doc/
  diagramas/             Fuentes PlantUML utilizadas en la memoria.
  evaluacion/            Procedimiento y resultados de la evaluación.
  memoria/               Memoria final del Trabajo Fin de Grado.
```

## Organización del acceso a datos

El directorio `database/` separa tres responsabilidades:

- `db.js` configura y exporta el pool de PostgreSQL, además del healthcheck de conexión.
- `db_setup.js` crea o migra el esquema.
- `user_repository.js` encapsula las operaciones de lectura y escritura de la tabla `usuarios`.

Las rutas de `server/app.js` coordinan HTTP, sesiones y verificación del protocolo mediante funciones
del repositorio. No contienen consultas SQL ni dependen de nombres de columnas o de la serialización
JSON usada por PostgreSQL.

## Requisitos

Para la ejecución con Docker:

- Docker Desktop, o Docker Engine con Docker Compose;
- PowerShell en Windows, o Bash en Linux/macOS.

Para la ejecución local sin Docker:

- Node.js 18.19 o posterior; se recomienda Node.js 22;
- PostgreSQL 16 o posterior;
- `psql` disponible en `PATH`;
- un fichero `.env` con los datos de conexión.

El prototipo se ha comprobado con Node.js 18.19.1 en WSL y con Node.js 22 en Docker.

La opción recomendada para probar el prototipo en otro equipo es Docker, ya que evita instalar y configurar PostgreSQL de forma manual.

## Ejecución con Docker

### Windows

Desde la raíz del repositorio:

```powershell
.\scripts\start-docker.ps1
```

El script intenta iniciar Docker Desktop si no está activo, levanta los servicios con Docker Compose, espera a que la aplicación responda en `/api/health` y abre el navegador.

También puede lanzarse mediante `npm`:

```powershell
npm run docker:start:windows
```

Para detener el sistema:

```powershell
.\scripts\stop-docker.ps1
```

Por defecto, la parada conserva la base de datos y las imágenes Docker. Esto permite reiniciar el prototipo sin perder los usuarios registrados.

### Linux y macOS

Los scripts equivalentes son:

```bash
bash scripts/start-docker.sh
bash scripts/stop-docker.sh
```

En macOS se intenta abrir Docker Desktop si no está activo. En Linux, dependiendo de la instalación, puede ser necesario iniciar manualmente el servicio `docker` o ejecutar los comandos con permisos adecuados.

### Arranque manual con Docker Compose

Si se prefiere no usar los scripts:

```bash
docker compose up --build -d
```

La aplicación quedará disponible en:

```text
http://localhost:3000
```

El despliegue define tres servicios:

- `db`: base de datos PostgreSQL;
- `db-init`: contenedor temporal que ejecuta `npm run db:setup`;
- `app`: servidor Node.js/Express.

El servidor no se inicia hasta que PostgreSQL está saludable y el esquema de base de datos se ha preparado correctamente.

Para consultar el estado o los logs:

```bash
docker compose ps
docker compose logs -f app
```

## Configuración de Docker

Los dos modos de ejecución usan configuraciones independientes:

- `.env` se usa al ejecutar Node.js y PostgreSQL directamente en el equipo.
- `.env.docker` se usa únicamente para sustituir variables de `compose.yaml`.
- `.env.docker.example` es una plantilla sin secretos que puede versionarse.

El fichero `.env.docker.example` contiene una plantilla de variables para Docker. Para usar valores propios:

```powershell
Copy-Item .env.docker.example .env.docker
```

En Linux/macOS:

```bash
cp .env.docker.example .env.docker
```

Después deben cambiarse, como mínimo, estos valores:

```env
DOCKER_DB_PASSWORD=replace-with-a-random-password
DOCKER_AUTH_SESSION_SECRET=replace-with-a-long-random-secret
```

Si no existe `.env.docker`, `compose.yaml` usa valores de demostración. Esto es cómodo para pruebas locales, pero no es apropiado para un despliegue compartido.

Dentro de los contenedores no se copia ningún fichero `.env`. Docker Compose transforma las variables `DOCKER_DB_*` en las variables `DB_*` que lee el servidor mediante `process.env`.

Importante: si ya existe el volumen de PostgreSQL, cambiar `.env.docker` no cambia las credenciales internas de esa base de datos. Para crear una base nueva con las nuevas credenciales hay que eliminar el volumen:

```powershell
.\scripts\stop-docker.ps1 -RemoveData
.\scripts\start-docker.ps1
```

## Parada, limpieza y reconstrucción

Comandos habituales en Windows:

```powershell
# Detener contenedores conservando datos e imágenes
.\scripts\stop-docker.ps1

# Detener y eliminar también la base de datos persistida
.\scripts\stop-docker.ps1 -RemoveData

# Detener y eliminar las imágenes construidas por el proyecto
.\scripts\stop-docker.ps1 -RemoveImages

# Detener el prototipo e intentar cerrar Docker Desktop
.\scripts\stop-docker.ps1 -StopDockerDesktop
```

Comandos equivalentes en Linux/macOS:

```bash
bash scripts/stop-docker.sh
bash scripts/stop-docker.sh --remove-data
bash scripts/stop-docker.sh --remove-images
bash scripts/stop-docker.sh --stop-docker
```

El script `clean.sh` vacía únicamente la tabla `usuarios` y reinicia su secuencia de identificadores. No elimina imágenes Docker, volúmenes ni dependencias:

```bash
bash scripts/clean.sh --docker
bash scripts/clean.sh --local
```

Para omitir la confirmación interactiva puede añadirse `--yes`.

El script `rebuild.sh` reconstruye el entorno sin borrar datos por defecto:

```bash
bash scripts/rebuild.sh --docker
bash scripts/rebuild.sh --local
```

Opciones útiles:

```bash
# Reconstruir y vaciar únicamente la tabla usuarios
bash scripts/rebuild.sh --docker --reset-users

# Reconstruir Docker eliminando el volumen PostgreSQL
bash scripts/rebuild.sh --docker --reset-data

# Reconstruir imágenes sin usar la caché de Docker
bash scripts/rebuild.sh --docker --no-cache
```

En modo local, `rebuild.sh` ejecuta `npm ci`, comprueba PostgreSQL y aplica `db_setup.js`. En modo
Docker reconstruye las imágenes y utiliza el flujo normal `db -> db-init -> app`. Ninguno de los dos
borra datos salvo que se indique explícitamente.

## Comparación de rendimiento

El botón **Comparar rendimiento** evalúa desde el navegador las cuatro configuraciones de
autenticación. Intercala cinco ejecuciones de calentamiento y treinta mediciones de cada
configuración, y muestra la media, la mediana y el percentil 95 de la latencia observada por el
cliente. El resultado completo, incluidas las muestras individuales y el identificador del
navegador, queda disponible en la consola como `window.lastBenchmarkResult`.

Durante esta operación los logs muestran varias entradas de login iguales. Son iteraciones
solicitadas por el navegador, no procesos del servidor ejecutándose de forma autónoma.

## Ejecución local sin Docker

La ejecución local requiere una base PostgreSQL accesible desde el equipo. El servidor lee la configuración desde `.env`.

Puede partirse del fichero de ejemplo:

```bash
cp .env.example .env
```

En PowerShell, el comando equivalente es:

```powershell
Copy-Item .env.example .env
```

Ejemplo de variables:

```env
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=server_zkp
AUTH_SESSION_SECRET=change-this-secret
PORT=3000
```

Instalación y arranque:

```bash
npm ci
npm run db:setup
npm start
```

Para desarrollo:

```bash
npm run dev
```

El servidor quedará disponible en `http://localhost:3000`.

### Ejecución local desde WSL

Con Node.js, npm, PostgreSQL y `psql` instalados dentro de WSL, los mismos comandos pueden
ejecutarse desde la raíz del repositorio montado en `/mnt/c`. El script de reconstrucción comprueba
la conexión, instala exactamente `package-lock.json` y prepara el esquema:

```bash
bash scripts/rebuild.sh --local
npm start
```

## Uso básico del prototipo

Una vez arrancado el sistema:

1. Abrir `http://localhost:3000`.
2. Registrar un usuario desde la página de registro.
3. Iniciar sesión desde la página de login.
4. Elegir, desde la interfaz, el modo de autenticación: interactivo o Fiat-Shamir, con apertura polinomial opcional.
5. Acceder a la página privada si la verificación finaliza correctamente.

La contraseña se procesa en el navegador. El servidor almacena datos de verificación asociados al usuario, pero no almacena la contraseña original.

## Trazas y comprobaciones

Para activar trazas del protocolo en ejecución local:

```bash
npm run start:trace
npm run start:trace:verbose
```

En Docker pueden activarse mediante `.env.docker`:

```env
ZKP_TRACE=1
ZKP_TRACE_LEVEL=flow
```

El botón de benchmark de la interfaz ejecuta varias autenticaciones consecutivas. Si aparecen varias entradas de login seguidas en los logs, normalmente se trata de esas iteraciones solicitadas por el navegador, no de procesos autónomos del servidor. `ZKP_TRACE=0` desactiva las trazas estructuradas adicionales; los mensajes operativos básicos del protocolo permanecen visibles.

Para comprobar sintaxis JavaScript:

```bash
npm run check:js
```

Para comprobar o aplicar el formato configurado con Prettier:

```bash
npm run format:check
npm run format
```

El proyecto no incorpora una batería de pruebas automáticas. El comando siguiente lo indica
explícitamente y termina correctamente:

```bash
npm test
```

Para comprobar las dependencias instaladas en producción:

```bash
npm audit --omit=dev
```

## Memoria

La memoria final del Trabajo Fin de Grado está disponible en
[`doc/memoria/memoria_ruiz_gonzalez_jorge.pdf`](doc/memoria/memoria_ruiz_gonzalez_jorge.pdf).

## Diagramas

Las fuentes canónicas de los diagramas PlantUML utilizados en la memoria se encuentran en:

```text
doc/diagramas/memoria/
```

Para regenerar conjuntamente las salidas SVG, PNG, PDF y PDF recortado se requieren PlantUML y Graphviz. Desde WSL, Linux o macOS se ejecuta:

```bash
npm run doc:diagramas
```

Las salidas se escriben en los subdirectorios `svg/`, `png/`, `pdf/` y `pdf/cropped/`. Son artefactos reproducibles y están excluidos del control de versiones; los ficheros `.puml`, el estilo y el script constituyen las fuentes que deben conservarse en el repositorio.

## Notas sobre Docker Desktop

Al ejecutar `docker compose down`, Docker elimina los contenedores y la red del proyecto, pero conserva imágenes y volúmenes. Esto es normal:

- las imágenes quedan en disco como caché para no reconstruir todo en el siguiente arranque;
- la imagen base `postgres:17-alpine` puede permanecer descargada y reutilizarse;
- el volumen PostgreSQL conserva los usuarios registrados;
- si Docker Desktop sigue abierto, puede seguir consumiendo memoria aunque no haya contenedores en ejecución.

Para liberar también datos o imágenes se deben usar las opciones `-RemoveData`, `--remove-data`, `-RemoveImages` o `--remove-images`, según el sistema operativo.

## Alcance

Este repositorio es un prototipo académico. El objetivo es mostrar el flujo de autenticación, la representación algebraica de la contraseña y la coordinación entre cliente, servidor y base de datos.

No debe usarse como sistema de autenticación real. En particular, la parte de compromiso polinomial es deliberadamente didáctica y no proporciona las garantías criptográficas de una implementación KZG segura.

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Véase el fichero [`LICENSE`](LICENSE).
