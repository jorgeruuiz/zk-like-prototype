/**************************************************************************************************
 * @file    app.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Servidor Express para la aplicación de autenticación basada en el protocolo de sum-check.
 * Define las rutas para registro y login, mantiene sesiones temporales en memoria para los flujos
 * interactivos y usa cookies firmadas para la sesión web autenticada. También se comunica con la
 * base de datos PostgreSQL para almacenar los datos de verificación del protocolo sin almacenar
 * contraseñas ni secretos, y sirve los archivos estáticos de la interfaz.
 *************************************************************************************************/

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { checkDatabaseConnection } from '../database/db.js';
import {
    createUserVerificationData,
    findFiatShamirVerificationData,
    findInteractiveVerificationData,
} from '../database/user_repository.js';
import {
    DEFAULT_PASSWORD_BYTES,
    MIN_PASSWORD_BYTES,
    SumCheckVerifierSession,
    createPublicChallenge,
    randomFieldElement,
    toClientChallengePayload,
} from '../sum-check-protocol/verifier.js';
import {
    FIELD_PRIME,
    parseVector,
    serializeVector,
    toField,
} from '../sum-check-protocol/field.js';
import { verifyFiatShamirProof } from '../sum-check-protocol/fiat-shamir.js';
import {
    DEFAULT_DEMO_TAU,
    getDemoTau,
    setDemoTau,
    verifyPolynomialOpening,
} from '../sum-check-protocol/polynomial-commitment.js';
import {
    traceEnter,
    traceError,
    traceExit,
    traceStep,
    traceSync,
} from '../sum-check-protocol/trace.js';

// Inicialización del servidor Express y configuración del parsing de JSON.
// La interfaz usa peticiones al mismo origen, por lo que no es necesario habilitar CORS globalmente.
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/sum-check-protocol', express.static('sum-check-protocol'));

// Middleware de traza HTTP. Solo escribe en consola si ZKP_TRACE=1.
app.use((req, res, next) => {
    const trace = traceEnter('HTTP', `${req.method} ${req.path}`, {
        method: req.method,
        path: req.path,
        query: req.query,
    });

    res.on('finish', () => {
        traceExit(trace, { statusCode: res.statusCode });
    });

    next();
});

// ------------------------------------------------------------------------------------------------
// Constantes y utilidades para la sesión web autenticada, basada en cookies firmadas.
// ------------------------------------------------------------------------------------------------
const SESSION_TTL_MS = 15 * 60 * 1000;
const AUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const AUTH_COOKIE_NAME = 'zkp_auth';
const MAX_PASSWORD_BYTES = 256;
const MAX_USERNAME_LENGTH = 50;
const AUTH_SESSION_SECRET =
    process.env.AUTH_SESSION_SECRET || 'dev-only-change-this-secret';

if (!process.env.AUTH_SESSION_SECRET) {
    console.warn(
        '[AUTH] AUTH_SESSION_SECRET no esta definido. Usando clave local de demostracion.'
    );
}
const POLY_OPEN_DOMAIN = 'poly-opening-v1';
const TRUSTED_SETUP_PATH = path.resolve(
    './sum-check-protocol/trusted-setup.json'
);

let trustedSetup = null;

/**
 * Comprueba si un valor entero es potencia de dos.
 *
 * Se usa para garantizar que el número de bits permite ejecutar un plegado completo
 * en el protocolo Sum-Check, reduciendo la tabla a la mitad en cada ronda.
 *
 * @param {number} value Valor a comprobar.
 * @returns {boolean} true si value es potencia de dos.
 */
function isPowerOfTwo(value) {
    return traceSync(
        'app',
        'isPowerOfTwo',
        { value },
        () => value > 0 && (value & (value - 1)) === 0,
        'verbose'
    );
}

/**
 * Valida el tamaño de contraseña solicitado y calcula los parámetros derivados del protocolo.
 *
 * El tamaño en bytes se transforma en longitud en bits y número de rondas. Para este
 * prototipo se exige una potencia de dos para que la tabla de evaluaciones pueda plegarse
 * de forma regular.
 *
 * @param {string|number|undefined} rawValue Valor recibido desde la query o formulario.
 * @param {number} [fallback=DEFAULT_PASSWORD_BYTES] Tamaño por defecto si no se recibe valor.
 * @returns {{bytes: number, bitLength: number, rounds: number}} Parámetros de tamaño validados.
 * @throws {Error} Si el tamaño no es compatible con el plegado de Sum-Check.
 */
function resolvePasswordBytes(rawValue, fallback = DEFAULT_PASSWORD_BYTES) {
    return traceSync(
        'app',
        'resolvePasswordBytes',
        { rawValue, fallback },
        () => {
            let bytes = fallback;
            if (rawValue !== undefined) {
                const text = String(rawValue).trim();
                if (!/^\d+$/.test(text)) {
                    throw new Error('El tamaño en bytes debe ser un entero');
                }
                bytes = Number(text);
            }

            if (!Number.isSafeInteger(bytes)) {
                throw new Error('El tamaño en bytes debe ser un entero válido');
            }

            if (bytes < MIN_PASSWORD_BYTES) {
                throw new Error(
                    `El tamaño debe ser al menos ${MIN_PASSWORD_BYTES} bytes`
                );
            }

            if (bytes > MAX_PASSWORD_BYTES) {
                throw new Error(
                    `El tamaño debe ser como maximo ${MAX_PASSWORD_BYTES} bytes`
                );
            }

            if (!isPowerOfTwo(bytes)) {
                throw new Error('El tamaño en bytes debe ser potencia de 2');
            }

            const bitLength = bytes * 8;
            if (!isPowerOfTwo(bitLength)) {
                throw new Error('El tamaño en bits debe ser potencia de 2');
            }

            return { bytes, bitLength, rounds: Math.log2(bitLength) };
        },
        'flow'
    );
}

/**
 * Valida un escalar decimal recibido por la API y lo normaliza en el cuerpo finito.
 * Los clientes del prototipo envían estos valores como cadenas para evitar pérdidas de precisión.
 *
 * @param {unknown} value Valor recibido.
 * @param {string} label Nombre lógico usado en el mensaje de error.
 * @returns {string} Representación decimal normalizada en F_p.
 */
function normalizeFieldInput(value, label) {
    return traceSync(
        'app',
        'normalizeFieldInput',
        { label, type: typeof value },
        () => {
            let text;
            if (typeof value === 'string') {
                text = value.trim();
            } else if (
                typeof value === 'number' &&
                Number.isSafeInteger(value)
            ) {
                text = String(value);
            } else {
                throw new Error(`${label} debe ser un entero decimal`);
            }

            if (!/^-?\d+$/.test(text)) {
                throw new Error(`${label} debe ser un entero decimal`);
            }

            return toField(text).toString();
        },
        'flow'
    );
}

/**
 * Normaliza y valida el nombre de usuario usado como identificador de cuenta.
 *
 * El cliente de login recorta espacios; aplicar la misma normalización en servidor evita
 * cuentas con espacios invisibles y mantiene estable el transcript de Fiat-Shamir.
 *
 * @param {unknown} value Valor recibido por API o ruta.
 * @returns {string} Nombre de usuario normalizado.
 */
function validateUsername(value) {
    return traceSync(
        'app',
        'validateUsername',
        { type: typeof value },
        () => {
            const username = typeof value === 'string' ? value.trim() : '';

            if (!username) {
                throw new Error('El nombre de usuario es obligatorio');
            }

            if (username.length > MAX_USERNAME_LENGTH) {
                throw new Error(
                    `El nombre de usuario no puede superar ${MAX_USERNAME_LENGTH} caracteres`
                );
            }

            return username;
        },
        'flow'
    );
}

/**
 * Normaliza un punto de apertura polinomial para evitar z=tau.
 *
 * En la identidad didáctica C_f - y = (tau - z) * pi, el caso realmente degenerado
 * es z=tau, porque anula el factor (tau-z). También se evita z=0 por claridad en
 * las trazas de la demo.
 *
 * @param {bigint|string|number} point Punto candidato.
 * @returns {bigint} Punto válido dentro de F_p.
 */
function normalizePolyOpeningPoint(point) {
    return traceSync(
        'app',
        'normalizePolyOpeningPoint',
        { point },
        () => {
            let normalized = toField(point);
            const tau = getDemoTau();

            if (normalized === 0n) {
                normalized = 1n;
            }

            if (normalized === tau) {
                normalized = addOneAvoidingTau(normalized, tau);
            }

            return normalized;
        },
        'flow'
    );
}

/**
 * Avanza desde un valor candidato hasta encontrar un punto distinto de 0 y tau.
 *
 * @param {bigint} value Valor inicial.
 * @param {bigint} tau Tau activo del setup didáctico.
 * @returns {bigint} Siguiente punto admisible.
 */
function addOneAvoidingTau(value, tau) {
    return traceSync(
        'app',
        'addOneAvoidingTau',
        { value, tau },
        () => {
            let candidate = toField(value + 1n);
            while (candidate === 0n || candidate === tau) {
                candidate = toField(candidate + 1n);
            }
            return candidate;
        },
        'flow'
    );
}

/**
 * Genera un punto aleatorio para abrir el compromiso polinomial en el login interactivo.
 *
 * El punto se guarda en la sesión del servidor. El cliente puede devolverlo para
 * trazabilidad, pero no decide el punto aceptado por el verificador.
 *
 * @returns {bigint} Punto z de apertura.
 */
function pickPolyOpeningPoint() {
    return traceSync(
        'app',
        'pickPolyOpeningPoint',
        undefined,
        () => {
            const tau = getDemoTau();
            let point = randomFieldElement();

            while (point === 0n || point === tau) {
                point = randomFieldElement();
            }

            return point;
        },
        'flow'
    );
}

/**
 * Deriva de forma determinista el punto z usado en Fiat-Shamir para la apertura polinomial.
 *
 * El separador de dominio evita mezclar este hash con el transcript de Sum-Check.
 * Así, la versión no interactiva no necesita almacenar una sesión en memoria para
 * recordar el punto de apertura.
 *
 * @param {Object} params Datos públicos de la cuenta.
 * @param {string} params.username Nombre de usuario.
 * @param {string|bigint} params.initialClaim Claim inicial de Sum-Check.
 * @param {string|bigint} params.polyCommitment Compromiso polinomial registrado.
 * @param {number} params.bitLength Longitud de la tabla de evaluaciones.
 * @returns {bigint} Punto z de apertura.
 */
function derivePolyOpeningPoint({
    username,
    initialClaim,
    polyCommitment,
    bitLength,
}) {
    return traceSync(
        'app',
        'derivePolyOpeningPoint',
        {
            username,
            initialClaim,
            polyCommitment,
            bitLength,
        },
        () => {
            const seed = [
                POLY_OPEN_DOMAIN,
                username,
                String(initialClaim),
                String(polyCommitment),
                String(bitLength),
            ].join('|');
            const digest = crypto
                .createHash('sha256')
                .update(seed)
                .digest('hex');
            return normalizePolyOpeningPoint(BigInt(`0x${digest}`));
        },
        'flow'
    );
}

/**
 * Carga trusted-setup.json y actualiza el tau usado por el compromiso polinomial didáctico.
 *
 * Si el fichero no existe, se usa un tau de respaldo solo para poder ejecutar la demo.
 * En la memoria conviene remarcar que este fallback, igual que el setup simulado, no
 * proporciona seguridad criptográfica real.
 */
function loadTrustedSetup() {
    return traceSync(
        'app',
        'loadTrustedSetup',
        { TRUSTED_SETUP_PATH },
        () => {
            try {
                const raw = fs.readFileSync(TRUSTED_SETUP_PATH, 'utf8');
                const parsed = JSON.parse(raw);
                if (
                    parsed.fieldPrime &&
                    String(parsed.fieldPrime) !== FIELD_PRIME.toString()
                ) {
                    throw new Error(
                        'trusted-setup.json pertenece a otro cuerpo finito'
                    );
                }
                const tau = toField(parsed.tau);
                if (tau === 0n) {
                    throw new Error('tau no puede ser cero');
                }
                setDemoTau(tau);
                trustedSetup = {
                    scheme: parsed.scheme ?? 'educational-kzg-like',
                    fieldPrime: parsed.fieldPrime ?? FIELD_PRIME.toString(),
                    maxDegree: parsed.maxDegree ?? null,
                    tau: tau.toString(),
                    warning:
                        parsed.warning ??
                        'Educational setup only: tau is public in this prototype and not cryptographically secure.',
                };
                console.log('[POLY-SETUP] Loaded educational trusted setup');
                console.log(`[POLY-SETUP] tau=${trustedSetup.tau}`);
                console.warn(`[POLY-SETUP] WARNING: ${trustedSetup.warning}`);
            } catch (error) {
                console.warn(
                    '[POLY-SETUP] trusted-setup.json not found or invalid.'
                );
                console.warn(
                    '[POLY-SETUP] Using fallback tau. Educational only.'
                );
                console.warn(
                    '[POLY-SETUP] Run npm run poly:setup to regenerate setup.'
                );

                setDemoTau(DEFAULT_DEMO_TAU);
                trustedSetup = {
                    scheme: 'educational-kzg-like',
                    fieldPrime: FIELD_PRIME.toString(),
                    maxDegree: null,
                    tau: DEFAULT_DEMO_TAU.toString(),
                    warning:
                        'Educational setup only: tau is public and regenerating it invalidates poly_commitments.',
                };
            }
        },
        'flow'
    );
}

loadTrustedSetup();

// ------------------------------------------------------------------------------------------------
// Endpoint de salud usado por Docker y por comprobaciones operativas.
// Verifica tanto el proceso HTTP como la conectividad con PostgreSQL.
// ------------------------------------------------------------------------------------------------
app.get('/api/health', async (req, res) => {
    try {
        await checkDatabaseConnection();
        return res.json({ status: 'ok' });
    } catch (error) {
        console.error('[HEALTH] PostgreSQL no disponible:', error.message);
        return res.status(503).json({
            status: 'unavailable',
            database: false,
        });
    }
});

// ------------------------------------------------------------------------------------------------
// FUNCIONES AUXILIARES PARA MANEJO DE AUTENTICACIÓN Y SESIONES CON COOKIES FIRMADAS
// ------------------------------------------------------------------------------------------------

/**
 * Formatea un vector de valores para su impresión en logs, limitando el número de elementos mostrados
 * y mostrando la longitud total si excede el límite. Esto es útil para visualizar los parámetros del
 * campo finito y los desafíos del protocolo sin saturar los logs con grandes cantidades de datos.
 * @param {Array<number>} values
 * @param {number} maxItems
 * @returns
 */
function formatVector(values, maxItems = 6) {
    return traceSync(
        'app',
        'formatVector',
        {
            length: Array.isArray(values) ? values.length : null,
            maxItems,
        },
        () => {
            const text = values.map((value) => String(value));
            if (text.length <= maxItems) {
                return `[${text.join(', ')}]`;
            }

            const head = text.slice(0, maxItems).join(', ');
            return `[${head}, ...] (len=${text.length})`;
        },
        'verbose'
    );
}

/**
 * Analiza las cookies de una solicitud HTTP.
 * @param {Object} req
 * @returns {Object}
 */
function parseCookies(req) {
    const raw = req.headers.cookie;
    if (!raw) {
        return {};
    }

    return raw.split(';').reduce((acc, part) => {
        const [name, ...rest] = part.trim().split('=');
        if (!name) {
            return acc;
        }

        try {
            acc[name] = decodeURIComponent(rest.join('='));
        } catch {
            // Una cookie mal codificada se ignora en lugar de convertir la petición en un error 500.
        }
        return acc;
    }, {});
}

/**
 * Codifica un valor en base64url para su uso en tokens de autenticación.
 * @param {string} value
 * @returns {string}
 */
function toBase64Url(value) {
    return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * Firma un payload utilizando HMAC-SHA256.
 * @param {string} encodedPayload
 * @returns {string}
 */
function signPayload(encodedPayload) {
    return crypto
        .createHmac('sha256', AUTH_SESSION_SECRET)
        .update(encodedPayload)
        .digest('base64url');
}

/**
 * Crea un token de autenticación firmado para un usuario dado.
 * El token incluye el nombre de usuario y una fecha de expiración, y se firma para evitar manipulaciones.
 * @param {string} username
 * @return {string}
 */
function createAuthToken(username) {
    const payload = {
        username,
        exp: Date.now() + AUTH_SESSION_TTL_MS,
    };

    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = signPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

/**
 * Verifica un token de autenticación firmado. Comprueba la firma y la expiración del token, y devuelve
 * el payload si es válido o null si no lo es. Esto se utiliza para validar las cookies de sesión en cada
 * solicitud protegida.
 * El token debe tener el formato "payload.signature", donde el payload es un JSON codificado en base64url
 * y la firma es un HMAC-SHA256 del payload utilizando el secreto del servidor. La función también verifica
 * que el token no haya expirado para garantizar que las sesiones sean temporales y seguras.
 * @param {string} token
 * @return {Object|null}
 */
function verifyAuthToken(token) {
    if (!token || !token.includes('.')) {
        return null;
    }

    const [encodedPayload, signature] = token.split('.');
    const expectedSignature = signPayload(encodedPayload);

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');
    if (
        sigBuf.length !== expBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expBuf)
    ) {
        return null;
    }

    try {
        const payload = JSON.parse(
            Buffer.from(encodedPayload, 'base64url').toString('utf8')
        );
        if (
            !payload.username ||
            !payload.exp ||
            Date.now() > Number(payload.exp)
        ) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

/**
 * Serializa una cookie para su envío en la respuesta HTTP.
 * @param {string} name
 * @param {string} value
 * @param {Object} param2
 * @returns {string}
 */
function serializeCookie(
    name,
    value,
    {
        maxAge,
        httpOnly = true,
        path = '/',
        sameSite = 'Lax',
        secure = false,
    } = {}
) {
    let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;

    if (httpOnly) {
        cookie += '; HttpOnly';
    }

    if (secure) {
        cookie += '; Secure';
    }

    if (Number.isFinite(maxAge)) {
        cookie += `; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
    }

    return cookie;
}

/**
 * Establece una cookie de autenticación en la respuesta HTTP.
 * @param {*} res
 * @param {*} username
 */
function setAuthCookie(res, username) {
    const token = createAuthToken(username);
    res.setHeader(
        'Set-Cookie',
        serializeCookie(AUTH_COOKIE_NAME, token, {
            maxAge: Math.floor(AUTH_SESSION_TTL_MS / 1000),
            secure: process.env.NODE_ENV === 'production',
        })
    );
}

/**
 * Limpia la cookie de autenticación en la respuesta HTTP, estableciendo un valor vacío y una expiración
 * inmediata. Esto se utiliza para cerrar sesión en el cliente eliminando la cookie de sesión.
 * @param {*} res
 */
function clearAuthCookie(res) {
    res.setHeader(
        'Set-Cookie',
        serializeCookie(AUTH_COOKIE_NAME, '', { maxAge: 0 })
    );
}

/**
 * Obtiene la sesión de autenticación del usuario a partir de las cookies de la solicitud HTTP.
 * Analiza las cookies, verifica el token de autenticación firmado y devuelve el payload del token si es
 * válido, o null si no lo es.
 * @param {*} req
 * @returns {Object|null}
 */
function getAuthSession(req) {
    const cookies = parseCookies(req);
    return verifyAuthToken(cookies[AUTH_COOKIE_NAME]);
}

// ------------------------------------------------------------------------------------------------
// FIN DE FUNCIONES AUXILIARES PARA MANEJO DE AUTENTICACIÓN Y SESIONES
// ------------------------------------------------------------------------------------------------

// Mapas en memoria para almacenar desafíos de registro y sesiones de login activas.
const registrationChallenges = new Map();
const loginSessions = new Map();

/**
 * Limpia las sesiones que han expirado de un mapa dado. Se utiliza para mantener los mapas de desafíos
 * y sesiones limpios de entradas antiguas que ya no son válidas, evitando así el consumo innecesario
 * de memoria con sesiones expiradas.
 * @param {Map} map
 */
function cleanupSessions(map) {
    const now = Date.now();

    for (const [sessionId, session] of map.entries()) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            map.delete(sessionId);
        }
    }
}

/**
 * Recupera una entrada temporal y la invalida si ya ha superado su TTL.
 *
 * El barrido periódico evita acumulación en memoria, pero esta comprobación evita aceptar
 * una sesión caducada durante la ventana entre dos ejecuciones del limpiador.
 *
 * @param {Map} map Mapa temporal de sesiones o desafíos.
 * @param {string} sessionId Identificador de la entrada.
 * @returns {Object|null} Entrada vigente, o null si no existe o ha expirado.
 */
function getActiveTemporaryEntry(map, sessionId) {
    const session = map.get(sessionId);
    if (!session) {
        return null;
    }

    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        map.delete(sessionId);
        return null;
    }

    return session;
}

// ------------------------------------------------------------------------------------------------
// Ejecutamos la limpieza cada 5 minutos. En un entorno real se usaria una solucion mas robusta.
// ------------------------------------------------------------------------------------------------
setInterval(
    () => {
        cleanupSessions(registrationChallenges);
        cleanupSessions(loginSessions);
    },
    5 * 60 * 1000
).unref();

// ------------------------------------------------------------------------------------------------
// RUTAS DEL SERVIDOR PARA REGISTRO Y LOGIN CON PROTOCOLO DE SUM-CHECK
// ------------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------------
// Ruta para iniciar el proceso de registro, que crea un desafío público para el cliente y lo
// almacena temporalmente en memoria. El desafío incluye los parámetros necesarios para que el
// cliente construya su compromiso localmente y ejecute el protocolo de sum-check durante el
// registro. El desafío se asocia a un ID único.
// ------------------------------------------------------------------------------------------------
/**
 * GET /api/zkp/register-challenge
 * Genera los pesos públicos y el punto de evaluación que se usarán durante el registro.
 */
app.get('/api/zkp/register-challenge', (req, res) => {
    // --------------------------------------------------------------------------------------------
    // Crea un desafío público para el registro. Este desafío incluye los parámetros
    // necesarios para que el cliente construya su compromiso localmente y ejecute el protocolo de
    // sum-check durante el registro
    // --------------------------------------------------------------------------------------------
    let resolved;
    try {
        resolved = resolvePasswordBytes(req.query.bytes);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const challengeId = crypto.randomUUID();
    const challenge = createPublicChallenge({ bitLength: resolved.bitLength });

    registrationChallenges.set(challengeId, {
        createdAt: Date.now(),
        challenge,
    });

    // Imprimimos en logs el desafío creado para el registro, incluyendo los parámetros del campo
    // finito y los retos públicos, para facilitar la depuración y el seguimiento de las sesiones
    // de registro que se están creando en el servidor.
    console.log(
        `[ZKP][REGISTER] Desafio creado id=${challengeId} ` +
            `(v=${challenge.rounds}, bits=${challenge.bitLength}, ` +
            `bytes=${challenge.passwordBytes}, p=${challenge.modulus})`
    );
    console.log(
        `[ZKP][REGISTER] Cuerpo F_p: p=${FIELD_PRIME.toString()} | ` +
            `r=${formatVector(serializeVector(challenge.point))} | ` +
            `weights=${formatVector(serializeVector(challenge.weights))}`
    );

    res.json(toClientChallengePayload(challengeId, challenge));
});

// -----------------------------------------------------------------------------
// Trusted setup simulado para compromisos polinomiales (didactico y publico).
// -----------------------------------------------------------------------------
/**
 * GET /api/poly-setup
 * Devuelve al cliente el setup polinomial didáctico cargado por el servidor.
 */
app.get('/api/poly-setup', (req, res) => {
    if (!trustedSetup) {
        loadTrustedSetup();
    }

    return res.json(trustedSetup);
});

// ------------------------------------------------------------------------------------------------
// Ruta para manejar el proceso de registro. Recibe del cliente el claim inicial del protocolo
// Sum-Check, los valores finales esperados y, opcionalmente, el compromiso polinomial C_f=f(tau).
// El servidor almacena estos datos junto con los parametros de verificación del protocolo, sin almacenar
// la contraseña ni ningun secreto del cliente.
// ------------------------------------------------------------------------------------------------
/**
 * POST /api/zkp/register
 * Guarda el claim inicial, los valores finales y el compromiso polinomial calculados por el cliente.
 */
app.post('/api/zkp/register', async (req, res) => {
    // --------------------------------------------------------------------------------------------
    // Obtiene los datos enviados por el cliente para el registro, incluyendo el ID del desafio, el
    // nombre de usuario, el claim inicial C del Sum-Check y el valor final g(r) tras ejecutar el
    // protocolo. Tambien puede recibirse el compromiso polinomial C_f=f(tau), calculado por el
    // cliente a partir de la misma tabla de evaluaciones.
    // --------------------------------------------------------------------------------------------

    // Notese que el servidor no recibe ni almacena la contraseña ni ningun secreto del cliente.
    // initialClaim es el claim inicial del Sum-Check, no un compromiso criptografico.
    const {
        challengeId,
        username: rawUsername,
        initialClaim,
        finalValue,
        fsFinalValue,
        polyCommitment,
    } = req.body;

    let username;
    try {
        username = validateUsername(rawUsername);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    if (
        !challengeId ||
        initialClaim === undefined ||
        finalValue === undefined ||
        fsFinalValue === undefined
    ) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    // --------------------------------------------------------------------------------------------
    // Recupera el desafio asociado al ID proporcionado por el cliente. Si el desafio no existe o ha
    // expirado, devuelve un error. Este paso asegura que el cliente esta respondiendo a un desafio
    // valido generado previamente para el proceso de registro.
    // --------------------------------------------------------------------------------------------
    const challenge = getActiveTemporaryEntry(
        registrationChallenges,
        challengeId
    );
    if (!challenge) {
        return res
            .status(400)
            .json({ error: 'El desafio de registro no existe o expiro' });
    }

    // Normaliza el compromiso polinomial recibido, si el cliente lo ha enviado.
    // El servidor no reconstruye aqui el polinomio f(X): recibe C_f=f(tau) calculado por el cliente
    // y lo almacena como ancla algebraica para futuras aperturas.
    let normalizedInitialClaim;
    let normalizedFinalValue;
    let normalizedFsFinalValue;
    let normalizedPolyCommitment;
    try {
        normalizedInitialClaim = normalizeFieldInput(
            initialClaim,
            'initialClaim'
        );
        normalizedFinalValue = normalizeFieldInput(finalValue, 'finalValue');
        normalizedFsFinalValue = normalizeFieldInput(
            fsFinalValue,
            'fsFinalValue'
        );
        normalizedPolyCommitment =
            polyCommitment !== undefined && polyCommitment !== null
                ? normalizeFieldInput(polyCommitment, 'polyCommitment')
                : null;
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    // Log de los datos recibidos para el registro. Se separa initialClaim del compromiso polinomial
    // para evitar confundir el claim inicial de Sum-Check con C_f=f(tau).
    console.log(
        `[ZKP][REGISTER] Recibido usuario=${username} challengeId=${challengeId} ` +
            `initialClaim=${normalizedInitialClaim} g(r)=${normalizedFinalValue} ` +
            `fs=${normalizedFsFinalValue}`
    );

    if (normalizedPolyCommitment !== null) {
        console.log(
            `[POLY-COMMITMENT][REGISTER] Recibido compromiso polinomial: ` +
                `C_f=f(tau)=${normalizedPolyCommitment}`
        );
    } else {
        console.log(
            '[POLY-COMMITMENT][REGISTER] No se ha recibido compromiso polinomial'
        );
    }

    // --------------------------------------------------------------------------------------------
    // Almacena en la base de datos los datos de verificación del protocolo para el usuario registrado:
    // claim inicial C, valor final g(r), valor final de Fiat-Shamir, parametros del desafio y, si se
    // ha activado la extension, el compromiso polinomial C_f=f(tau).
    // Si el usuario ya existe, el registro se rechaza para evitar duplicados.
    // --------------------------------------------------------------------------------------------
    try {
        await createUserVerificationData({
            username,
            initialClaim: normalizedInitialClaim,
            interactiveFinalValue: normalizedFinalValue,
            fiatShamirFinalValue: normalizedFsFinalValue,
            weights: serializeVector(challenge.challenge.weights),
            challengePoint: serializeVector(challenge.challenge.point),
            bitLength: challenge.challenge.bitLength,
            polyCommitment: normalizedPolyCommitment,
        });

        // Log de confirmacion de que el usuario ha sido guardado correctamente en la base de datos.
        console.log(
            `[ZKP][REGISTER] Usuario=${username} guardado con ` +
                `initialClaim=${normalizedInitialClaim} y g(r)=${normalizedFinalValue}`
        );

        if (normalizedPolyCommitment !== null) {
            console.log(
                `[POLY-COMMITMENT][REGISTER] Compromiso persistido en BD para ` +
                    `usuario=${username}: poly_commitment=${normalizedPolyCommitment}`
            );
        }

        console.log(
            `[ZKP][REGISTER] Parametros persistidos: bitLength=${challenge.challenge.bitLength}, ` +
                `rounds=${challenge.challenge.point.length}, p=${FIELD_PRIME.toString()}`
        );

        // Despues de almacenar los datos, se elimina el desafio de registro de la memoria para evitar
        // reutilizaciones.
        registrationChallenges.delete(challengeId);

        res.json({ success: true });
    } catch (error) {
        if (error?.code === '23505') {
            return res
                .status(409)
                .json({ error: 'El nombre de usuario ya existe' });
        }

        // Log de error en caso de que ocurra un problema al guardar el usuario en la base de datos.
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ------------------------------------------------------------------------------------------------
// Ruta para iniciar el proceso de login, que recupera los datos de verificación del usuario y crea una
// sesión de verifier para manejar las rondas interactivas del protocolo de sum-check durante el login.
// ------------------------------------------------------------------------------------------------
/**
 * GET /api/zkp/login-challenge/:username
 * Prepara una sesión interactiva de Sum-Check para el usuario indicado.
 */
app.get('/api/zkp/login-challenge/:username', async (req, res) => {
    // --------------------------------------------------------------------------------------------
    // Recupera el nombre de usuario de los parámetros de la ruta y valida que se haya proporcionado.
    // Este paso es necesario para identificar al usuario que intenta iniciar sesión y recuperar sus
    // datos de verificación del protocolo para iniciar la sesión de verifier.
    // --------------------------------------------------------------------------------------------
    let username;
    try {
        username = validateUsername(req.params.username);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const verificationData =
            await findInteractiveVerificationData(username);
        if (!verificationData) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const challengePoint = parseVector(
            verificationData.challengePoint,
            'challengePoint'
        );
        const weights = parseVector(verificationData.weights, 'weights');
        const polyOpeningPoint = verificationData.polyCommitment
            ? pickPolyOpeningPoint()
            : null;
        const loginId = crypto.randomUUID();

        console.log(
            `[ZKP][LOGIN] Inicio de sesion id=${loginId} usuario=${username} ` +
                `con initialClaim=${verificationData.initialClaim}, rondas=${challengePoint.length}`
        );
        console.log(
            `[ZKP][LOGIN] Cuerpo F_p: p=${FIELD_PRIME.toString()} | ` +
                `r=${formatVector(serializeVector(challengePoint))} | ` +
                `weights=${formatVector(serializeVector(weights))} | ` +
                `g(r)_registro=${String(verificationData.finalValue)}`
        );

        // --------------------------------------------------------------------------------------------
        // Crea una sesión de verifier para el proceso de login del usuario, utilizando los datos de verificación
        // recuperados de la base de datos. La sesión se almacena en memoria asociada a un ID de login
        // único, que se enviará al cliente para que lo utilice en las rondas interactivas del protocolo.
        // Esta sesión manejará la lógica de verificación de cada ronda y la verificación final del login.
        // --------------------------------------------------------------------------------------------
        loginSessions.set(loginId, {
            createdAt: Date.now(),
            startedAt: Date.now(),
            verifier: new SumCheckVerifierSession({
                username,
                initialClaim: toField(verificationData.initialClaim),
                finalValue: toField(verificationData.finalValue),
                challengePoint,
                logger: (message) =>
                    console.log(`[ZKP][LOGIN:${loginId}] ${message}`),
            }),
            weights,
            challengePoint,
            polyCommitment: verificationData.polyCommitment,
            polyOpeningPoint,
        });

        // Responde al cliente con los datos necesarios para iniciar el proceso de login.
        // No se envía final_value ni otros valores finales de verificación que solo necesita
        // el servidor para comprobar la prueba.
        res.json({
            loginId,
            username,
            rounds: challengePoint.length,
            bitLength: verificationData.bitLength,
            passwordBytes: Math.floor(verificationData.bitLength / 8),
            weights: serializeVector(weights),
            point: serializeVector(challengePoint),
            modulus: FIELD_PRIME.toString(),
            polyOpeningPoint: polyOpeningPoint
                ? polyOpeningPoint.toString()
                : null,
        });
    } catch (error) {
        // Log de error en caso de que ocurra un problema al preparar el login, para facilitar la
        // depuración.
        console.error('Error preparando login:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ------------------------------------------------------------------------------------------------
// Ruta para iniciar el proceso de login no interactivo (Fiat-Shamir), que entrega los parámetros
// de verificación al cliente sin crear una sesion de verifier en el servidor.
// ------------------------------------------------------------------------------------------------
/**
 * GET /api/zkp/login-challenge-fs/:username
 * Entrega los parámetros necesarios para construir una prueba Fiat-Shamir en el cliente.
 */
app.get('/api/zkp/login-challenge-fs/:username', async (req, res) => {
    let username;
    try {
        username = validateUsername(req.params.username);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const verificationData = await findFiatShamirVerificationData(username);
        if (!verificationData) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (!verificationData.finalValue) {
            return res.status(400).json({
                error: 'El usuario no tiene datos Fiat-Shamir. Registra de nuevo.',
            });
        }

        const weights = parseVector(verificationData.weights, 'weights');
        const bitLength = verificationData.bitLength;
        const rounds = Math.log2(bitLength);
        const polyOpeningPoint = verificationData.polyCommitment
            ? derivePolyOpeningPoint({
                  username,
                  initialClaim: verificationData.initialClaim,
                  polyCommitment: verificationData.polyCommitment,
                  bitLength,
              })
            : null;

        console.log(
            `[ZKP][LOGIN-FS] Inicio de sesion usuario=${username} ` +
                `con initialClaim=${verificationData.initialClaim}, rondas=${rounds}`
        );

        res.json({
            username,
            rounds,
            bitLength,
            passwordBytes: Math.floor(bitLength / 8),
            weights: serializeVector(weights),
            modulus: FIELD_PRIME.toString(),
            polyCommitment: verificationData.polyCommitment,
            polyOpeningPoint: polyOpeningPoint
                ? polyOpeningPoint.toString()
                : null,
        });
    } catch (error) {
        console.error('Error preparando login Fiat-Shamir:', error);
        res.status(500).json({ error: 'Error interno' });
    }
});

// ------------------------------------------------------------------------------------------------
// Ruta para manejar cada ronda del proceso de login interactivo, que recibe las respuestas del cliente
// para cada ronda del protocolo de sum-check y las verifica utilizando la sesión de verifier asociada
// al ID de login. El servidor valida la consistencia de las respuestas con el claim actual y actualiza
// el claim para la siguiente ronda, devolviendo al cliente el resultado de la verificación de la ronda.
// ------------------------------------------------------------------------------------------------
/**
 * POST /api/zkp/login-round
 * Verifica una ronda del Sum-Check interactivo y devuelve el claim actualizado.
 */
app.post('/api/zkp/login-round', (req, res) => {
    // ------------------------------------------------------------------------------------------------
    // Obtiene los datos enviados por el cliente para la ronda de login, incluyendo el ID de login, el
    // número de ronda, y las respuestas left y right. Valida que se hayan recibido todos los datos
    // necesarios para continuar con la verificación de la ronda.
    // ------------------------------------------------------------------------------------------------
    const { loginId, round, left, right } = req.body;

    if (
        !loginId ||
        round === undefined ||
        left === undefined ||
        right === undefined
    ) {
        clearAuthCookie(res);
        return res.status(400).json({ error: 'Faltan datos de la ronda' });
    }

    // ------------------------------------------------------------------------------------------------
    // Recupera la sesión de verifier asociada al ID de login proporcionado por el cliente. Si la sesión
    // no existe o ha expirado, devuelve un error. Este paso es crucial para asegurar que el cliente está
    // respondiendo a una sesión de login válida que se generó previamente al iniciar el proceso de login.
    // ------------------------------------------------------------------------------------------------
    const session = getActiveTemporaryEntry(loginSessions, loginId);
    if (!session) {
        clearAuthCookie(res);
        return res.status(404).json({ error: 'Sesion de login no encontrada' });
    }

    // ------------------------------------------------------------------------------------------------
    // Verifica la ronda del protocolo de sum-check utilizando la sesión de verifier. El servidor valida la
    // consistencia de las respuestas left y right con el claim actual, y actualiza el claim para la
    // siguiente ronda. Devuelve al cliente el resultado de la verificación de la ronda, incluyendo el
    // nuevo claim actualizado y si se ha terminado el proceso de login.
    // ------------------------------------------------------------------------------------------------
    try {
        const currentClaim = session.verifier.currentClaim;
        console.log(
            `[ZKP][LOGIN:${loginId}] Entrada ronda=${Number(round) + 1}/${session.verifier.rounds} ` +
                `claim_j=${currentClaim.toString()} s_j(0)=${String(left)} s_j(1)=${String(right)}`
        );

        // Verificación de la ronda: el servidor utiliza la sesión de verifier para verificar las
        // respuestas left y right enviadas por el cliente, comparándolas con el claim actual.
        const roundResult = session.verifier.verifyRound({
            round,
            left,
            right,
        });

        // Log del resultado de la ronda, mostrando el nuevo claim actualizado y si se ha terminado el
        // proceso de login.
        console.log(
            `[ZKP][LOGIN:${loginId}] Salida ronda=${roundResult.round}/${session.verifier.rounds} ` +
                `claim_actualizado=${roundResult.currentClaim.toString()} finished=${roundResult.finished}`
        );

        // Devuelve al cliente el resultado de la ronda, incluyendo el nuevo claim actualizado y si se ha
        // terminado el proceso de login. El cliente utilizará esta información para continuar con las rondas
        // siguientes o para finalizar el proceso de login.
        res.json({
            success: true,
            round: roundResult.round,
            currentClaim: roundResult.currentClaim.toString(),
            finished: roundResult.finished,
            elapsedMs: Date.now() - session.startedAt,
        });
    } catch (error) {
        // En caso de error durante la verificación de la ronda, se elimina la sesión de login para evitar
        // que el cliente continúe con un proceso de login inválido, y se devuelve un error al cliente. El
        // log del error incluye el ID de login para facilitar la depuración.
        loginSessions.delete(loginId);
        clearAuthCookie(res);
        console.log(`[ZKP][LOGIN:${loginId}] Error en ronda: ${error.message}`);
        return res.status(400).json({ error: error.message });
    }
});

// ------------------------------------------------------------------------------------------------
// Ruta para finalizar el proceso de login, que recibe el valor final plegado enviado por el cliente tras
// ejecutar el protocolo de sum-check, y lo verifica utilizando la sesión de verifier asociada al ID de
// login. El servidor acepta el login solo si el valor plegado coincide con el claim final y con el valor
// guardado en el registro para ese usuario. Si la verificación es exitosa, se crea una sesión
// autenticada para el usuario; de lo contrario, se rechaza el login.
// ------------------------------------------------------------------------------------------------
/**
 * POST /api/zkp/login-finish
 * Cierra el login interactivo verificando el valor final y, si procede, la apertura polinomial.
 */
app.post('/api/zkp/login-finish', (req, res) => {
    // ------------------------------------------------------------------------------------------------
    // Obtiene los datos enviados por el cliente para finalizar el login, incluyendo el ID de login y el
    // valor final plegado. Valida que se hayan recibido todos los datos necesarios para continuar con
    // la verificación final del login.
    // ------------------------------------------------------------------------------------------------
    const {
        loginId,
        foldedValue,
        polyOpeningPoint,
        polyOpeningValue,
        polyOpeningProof,
        usePolyCommitment,
    } = req.body;

    if (!loginId || foldedValue === undefined) {
        clearAuthCookie(res);
        return res.status(400).json({ error: 'Faltan datos finales' });
    }

    const session = getActiveTemporaryEntry(loginSessions, loginId);
    if (!session) {
        clearAuthCookie(res);
        return res.status(404).json({ error: 'Sesion de login no encontrada' });
    }

    let isValid = false;

    try {
        // Log de los datos recibidos para finalizar el login, incluyendo el valor plegado enviado por el
        // cliente, el claim final esperado por la sesión del verifier, y el valor g(r) registrado para
        // el usuario. Esto es útil para depurar la verificación final del login y entender por qué un login
        // puede estar fallando.
        console.log(
            `[ZKP][LOGIN:${loginId}] Finalizar: foldedValue=${String(foldedValue)} ` +
                `claim_final=${session.verifier.currentClaim.toString()} ` +
                `g(r)_registro=${session.verifier.finalValue.toString()}`
        );

        // Verificacion final: comparar el valor plegado enviado por el prover con g(r)
        // esperado por la sesion del verifier.
        isValid = session.verifier.verifyFinalValue(foldedValue);

        const wantsPoly = usePolyCommitment === true;
        console.log(`[POLY-COMMITMENT][LOGIN] enabled=${wantsPoly}`);
        if (wantsPoly && !session.polyCommitment) {
            loginSessions.delete(loginId);
            clearAuthCookie(res);
            return res.status(400).json({
                error: 'El usuario no tiene compromiso polinomial registrado',
            });
        }

        if (session.polyCommitment && wantsPoly) {
            if (!session.polyOpeningPoint) {
                loginSessions.delete(loginId);
                clearAuthCookie(res);
                return res.status(400).json({
                    error: 'Punto de apertura polinomial no disponible',
                });
            }

            if (
                polyOpeningPoint === undefined ||
                polyOpeningValue === undefined ||
                polyOpeningProof === undefined
            ) {
                loginSessions.delete(loginId);
                clearAuthCookie(res);
                return res.status(400).json({
                    error: 'Faltan datos de apertura polinomial',
                });
            }

            const expectedPoint = toField(session.polyOpeningPoint);
            const reportedPoint = toField(polyOpeningPoint);
            console.log(
                `[POLY-COMMITMENT][LOGIN] z=${expectedPoint.toString()} ` +
                    `received_z=${reportedPoint.toString()}`
            );
            console.log(
                `[POLY-COMMITMENT][LOGIN] C_f=${String(session.polyCommitment)} ` +
                    `y=${String(polyOpeningValue)} pi=${String(polyOpeningProof)}`
            );
            if (reportedPoint !== expectedPoint) {
                loginSessions.delete(loginId);
                clearAuthCookie(res);
                return res.status(400).json({
                    error: 'Punto de apertura polinomial incorrecto',
                });
            }

            const polyValid = verifyPolynomialOpening({
                commitment: session.polyCommitment,
                point: expectedPoint,
                value: polyOpeningValue,
                proof: polyOpeningProof,
            });

            if (!polyValid) {
                console.warn(
                    '[POLY-COMMITMENT][LOGIN] opening_valid=false. ' +
                        'Si se ha regenerado trusted-setup.json, vuelve a registrar el usuario.'
                );

                loginSessions.delete(loginId);
                clearAuthCookie(res);
                return res.status(400).json({
                    error:
                        'Apertura polinomial no valida. Si se ha regenerado el trusted setup, ' +
                        'vuelve a registrar el usuario.',
                });
            }

            console.log(`[POLY-COMMITMENT][LOGIN] opening_valid=${polyValid}`);
        }
    } catch (error) {
        // En caso de error durante la verificación final, se elimina la sesión de login para evitar que el
        // cliente continúe con un proceso de login inválido, y se devuelve un error al cliente. El log del
        // error incluye el ID de login para facilitar la depuración.
        loginSessions.delete(loginId);
        clearAuthCookie(res);
        console.log(
            `[ZKP][LOGIN:${loginId}] Error en verificacion final: ${error.message}`
        );
        return res.status(400).json({ error: error.message });
    }

    // Después de la verificación final, se elimina la sesión de login para limpiar la memoria, ya que el
    // proceso de login ha finalizado, ya sea con éxito o con fallo.
    loginSessions.delete(loginId);

    // Log del resultado final del login, indicando si fue exitoso o no para el usuario. Esto es útil para
    // tener un registro de los intentos de login y su resultado.
    console.log(
        `[ZKP] Usuario ${session.verifier.username}: ${isValid ? 'EXITO' : 'FALLO'}`
    );

    // Si el login es exitoso, se crea una sesión autenticada para el usuario estableciendo una cookie de
    // autenticación firmada. Si el login falla, se limpia cualquier cookie de autenticación existente para
    // asegurar que no haya sesiones inválidas. Finalmente, se responde al cliente con el resultado del
    // login para que pueda actuar en consecuencia (por ejemplo, redirigir a la zona privada si el login fue
    // exitoso).
    if (isValid) {
        setAuthCookie(res, session.verifier.username);
    } else {
        clearAuthCookie(res);
    }

    // Devuelve al cliente el resultado del login, indicando si fue exitoso o no. El cliente utilizará
    // esta información para decidir si redirigir al usuario a la zona privada o mostrar un mensaje de
    // error.
    res.json({ success: isValid, elapsedMs: Date.now() - session.startedAt });
});

// ------------------------------------------------------------------------------------------------
// Ruta para finalizar el login no interactivo (Fiat-Shamir). El cliente envia el transcript de
// rondas y el valor final, y el servidor verifica la prueba deterministicamente.
// ------------------------------------------------------------------------------------------------
/**
 * POST /api/zkp/login-fs
 * Verifica una prueba Fiat-Shamir completa y, opcionalmente, su apertura polinomial.
 */
app.post('/api/zkp/login-fs', async (req, res) => {
    const startedAt = Date.now();
    const {
        username: rawUsername,
        roundMessages,
        foldedValue,
        polyOpeningPoint,
        polyOpeningValue,
        polyOpeningProof,
        usePolyCommitment,
    } = req.body;

    let username;
    try {
        username = validateUsername(rawUsername);
    } catch (error) {
        clearAuthCookie(res);
        return res.status(400).json({ error: error.message });
    }

    if (!Array.isArray(roundMessages) || foldedValue === undefined) {
        clearAuthCookie(res);
        return res.status(400).json({ error: 'Faltan datos de la prueba' });
    }

    let verificationData;
    try {
        verificationData = await findFiatShamirVerificationData(username);
        if (!verificationData) {
            clearAuthCookie(res);
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Error preparando login Fiat-Shamir:', error);
        return res.status(500).json({ error: 'Error interno' });
    }

    if (!verificationData.finalValue) {
        clearAuthCookie(res);
        return res.status(400).json({
            error: 'El usuario no tiene datos Fiat-Shamir. Registra de nuevo.',
        });
    }

    let isValid = false;
    let polyValid = true;
    try {
        const weights = parseVector(verificationData.weights, 'weights');
        const verification = await verifyFiatShamirProof({
            username,
            initialClaim: verificationData.initialClaim,
            bitLength: verificationData.bitLength,
            weights,
            roundMessages,
            expectedFinalValue: verificationData.finalValue,
            reportedFinalValue: foldedValue,
            polyCommitment: verificationData.polyCommitment,
        });

        const wantsPoly = usePolyCommitment === true;
        console.log(`[POLY-COMMITMENT][LOGIN-FS] enabled=${wantsPoly}`);
        if (wantsPoly && !verificationData.polyCommitment) {
            clearAuthCookie(res);
            return res.status(400).json({
                error: 'El usuario no tiene compromiso polinomial registrado',
            });
        }

        if (verificationData.polyCommitment && wantsPoly) {
            if (
                polyOpeningPoint === undefined ||
                polyOpeningValue === undefined ||
                polyOpeningProof === undefined
            ) {
                clearAuthCookie(res);
                return res.status(400).json({
                    error: 'Faltan datos de apertura polinomial',
                });
            }

            const expectedPoint = derivePolyOpeningPoint({
                username,
                initialClaim: verificationData.initialClaim,
                polyCommitment: verificationData.polyCommitment,
                bitLength: verificationData.bitLength,
            });
            const reportedPoint = toField(polyOpeningPoint);
            console.log(
                `[POLY-COMMITMENT][LOGIN-FS] expected_z=${expectedPoint.toString()} ` +
                    `received_z=${reportedPoint.toString()}`
            );
            console.log(
                `[POLY-COMMITMENT][LOGIN-FS] C_f=${String(verificationData.polyCommitment)} ` +
                    `y=${String(polyOpeningValue)} pi=${String(polyOpeningProof)}`
            );
            if (reportedPoint !== expectedPoint) {
                clearAuthCookie(res);
                return res.status(400).json({
                    error: 'Punto de apertura polinomial incorrecto',
                });
            }

            polyValid = verifyPolynomialOpening({
                commitment: verificationData.polyCommitment,
                point: expectedPoint,
                value: polyOpeningValue,
                proof: polyOpeningProof,
            });

            if (!polyValid) {
                console.warn(
                    '[POLY-COMMITMENT][LOGIN-FS] opening_valid=false. ' +
                        'Si se ha regenerado trusted-setup.json, vuelve a registrar el usuario.'
                );

                clearAuthCookie(res);
                return res.status(400).json({
                    error:
                        'Apertura polinomial no valida. Si se ha regenerado el trusted setup, ' +
                        'vuelve a registrar el usuario.',
                });
            }

            console.log(
                `[POLY-COMMITMENT][LOGIN-FS] opening_valid=${polyValid}`
            );
        }

        isValid = verification.accepted && polyValid;
    } catch (error) {
        console.log(`[ZKP][LOGIN-FS] Error en verificacion: ${error.message}`);
        clearAuthCookie(res);
        return res.status(400).json({ error: error.message });
    }

    console.log(
        `[ZKP][LOGIN-FS] Usuario ${username}: ${isValid ? 'EXITO' : 'FALLO'}`
    );

    if (isValid) {
        setAuthCookie(res, username);
    } else {
        clearAuthCookie(res);
    }

    return res.json({ success: isValid, elapsedMs: Date.now() - startedAt });
});

// ------------------------------------------------------------------------------------------------
// Ruta para comprobar el estado de la sesión autenticada del usuario. El servidor verifica la cookie de
// autenticación firmada en la solicitud y devuelve si el usuario está autenticado, junto con su nombre
// de usuario y la fecha de expiración de la sesión. Esta ruta se puede utilizar desde el frontend para
// verificar si el usuario tiene una sesión activa y mostrar la interfaz adecuada (por ejemplo, mostrar el
// botón de login o el acceso a la zona privada).
// ------------------------------------------------------------------------------------------------
/**
 * GET /api/auth/session
 * Comprueba si existe una sesión web válida para proteger la zona privada.
 */
app.get('/api/auth/session', (req, res) => {
    const session = getAuthSession(req);
    if (!session) {
        return res.status(401).json({ authenticated: false });
    }

    return res.json({
        authenticated: true,
        username: session.username,
        expiresAt: session.exp,
    });
});

// ------------------------------------------------------------------------------------------------
// Ruta para manejar el logout del usuario, que limpia la cookie de autenticación en el navegador. Esto
// invalida la sesión del usuario en el cliente, ya que la cookie de sesión ya no será válida para futuras
// solicitudes protegidas. El servidor no mantiene estado de sesiones, por lo que no es necesario hacer
// nada más para invalidar la sesión en el servidor.
// ------------------------------------------------------------------------------------------------
/**
 * POST /api/auth/logout
 * Cierra la sesión web eliminando la cookie firmada.
 */
app.post('/api/auth/logout', (req, res) => {
    clearAuthCookie(res);
    return res.json({ success: true });
});

// --------------------------------------------------------------------------------------------------
// Middleware para proteger la zona privada, que verifica que el usuario tenga una sesión autenticada
// antes de permitir el acceso a los archivos estáticos de la zona privada. Si el usuario no tiene una
// sesión válida, se redirige a la página de inicio.
// . ------------------------------------------------------------------------------------------------
/**
 * GET /private.html
 * Protege la página privada redirigiendo al login si no hay sesión válida.
 */
app.get('/private.html', (req, res, next) => {
    const session = getAuthSession(req);
    if (!session) {
        return res.redirect('/index.html');
    }

    return next();
});

// Middleware para servir los archivos estáticos de la carpeta "public", que incluye la interfaz de usuario
// y el código del protocolo en el cliente.
app.use(express.static('public'));

// Respuesta JSON uniforme para errores inesperados que alcancen Express.
app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    const status =
        Number.isInteger(error?.status) && error.status >= 400
            ? error.status
            : 500;
    const message =
        error?.type === 'entity.parse.failed'
            ? 'El cuerpo JSON no es válido'
            : status === 413
              ? 'El cuerpo de la petición es demasiado grande'
              : status < 500
                ? 'Petición no válida'
                : 'Error interno';

    if (status >= 500) {
        console.error(
            `[HTTP] Error no controlado en ${req.method} ${req.path}:`,
            error
        );
    } else {
        console.warn(
            `[HTTP] ${req.method} ${req.path}: ${message} (${status})`
        );
    }
    return res.status(status).json({ error: message });
});

export default app;
