/**************************************************************************************************
 * @file    login-app.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Lógica del lado del cliente para login interactivo, login Fiat-Shamir y apertura polinomial opcional.
 *************************************************************************************************/

import { passwordToBits } from '/sum-check-protocol/field.js';
import { buildEvaluationsFromBits } from '/sum-check-protocol/protocol.js';
import { InteractiveSumCheckProver } from '/sum-check-protocol/prover.js';
import { buildFiatShamirProof } from '/sum-check-protocol/fiat-shamir.js';
import {
    evaluationsToPolynomialCoefficients,
    openPolynomial,
    setDemoTau,
} from '/sum-check-protocol/polynomial-commitment.js';
import { traceAsync, traceSync } from '/sum-check-protocol/trace.js';

const btn = document.getElementById('btn');
const status = document.getElementById('s');
const benchBtn = document.getElementById('bench-btn');
const benchResult = document.getElementById('bench-result');
const fsModeToggle = document.getElementById('fs-mode');
const polyModeToggle = document.getElementById('poly-mode');
let polySetupPromise = null;

const BENCHMARK_WARMUP_RUNS = 5;
const BENCHMARK_MEASURED_RUNS = 30;
const BENCHMARK_CONFIGURATIONS = [
    {
        key: 'I',
        label: 'Interactivo',
        fiatShamir: false,
        polyCommitment: false,
    },
    {
        key: 'I+A',
        label: 'Interactivo + apertura',
        fiatShamir: false,
        polyCommitment: true,
    },
    {
        key: 'FS',
        label: 'Fiat-Shamir',
        fiatShamir: true,
        polyCommitment: false,
    },
    {
        key: 'FS+A',
        label: 'Fiat-Shamir + apertura',
        fiatShamir: true,
        polyCommitment: true,
    },
];

/**
 * Muestra el estado principal del login en pantalla.
 *
 * @param {string} message Texto a mostrar al usuario.
 */
function setStatus(message) {
    return traceSync(
        'login-app',
        'setStatus',
        { message },
        () => {
            status.innerText = message;
        },
        'verbose'
    );
}

/**
 * Actualiza el área de resultados del benchmark.
 *
 * @param {string} message Resultado o aviso del benchmark.
 */
function setBenchResult(message) {
    return traceSync(
        'login-app',
        'setBenchResult',
        { message },
        () => {
            if (benchResult) {
                benchResult.innerText = message;
            }
        },
        'verbose'
    );
}

/**
 * Lee usuario y contraseña desde el formulario de login.
 *
 * @returns {{username: string, password: string}} Valores introducidos por el usuario.
 */
function getLoginInputs() {
    return traceSync(
        'login-app',
        'getLoginInputs',
        undefined,
        () => {
            const username = document.getElementById('u').value.trim();
            const password = document.getElementById('p').value;
            return { username, password };
        },
        'flow'
    );
}

/**
 * Indica si el usuario ha seleccionado el modo Fiat-Shamir.
 *
 * @returns {boolean} true si el modo no interactivo está activado.
 */
function isFiatShamirSelected() {
    return traceSync(
        'login-app',
        'isFiatShamirSelected',
        undefined,
        () => {
            return Boolean(fsModeToggle && fsModeToggle.checked);
        },
        'verbose'
    );
}

/**
 * Indica si debe comprobarse la apertura del compromiso polinomial.
 *
 * @returns {boolean} true si la capa polinomial está activada.
 */
function isPolyCommitmentSelected() {
    return traceSync(
        'login-app',
        'isPolyCommitmentSelected',
        undefined,
        () => {
            return Boolean(polyModeToggle && polyModeToggle.checked);
        },
        'verbose'
    );
}

/**
 * Carga una sola vez el setup polinomial publicado por el servidor.
 *
 * En este prototipo tau es público para que el cliente pueda construir compromisos
 * y aperturas. Precisamente por eso la capa es didáctica y no criptográficamente segura.
 *
 * @returns {Promise<Object>} Setup recibido del servidor.
 */
async function ensurePolySetup() {
    return traceAsync(
        'login-app',
        'ensurePolySetup',
        undefined,
        async () => {
            if (polySetupPromise) {
                return polySetupPromise;
            }

            polySetupPromise = fetch('/api/poly-setup')
                .then(async (response) => {
                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(
                            data.error ||
                                'No se pudo cargar el setup polinomial'
                        );
                    }
                    if (!data.tau) {
                        throw new Error('Setup polinomial invalido');
                    }
                    setDemoTau(data.tau);
                    if (data.warning) {
                        console.warn(`[POLY-SETUP] ${data.warning}`);
                    }
                    return data;
                })
                .catch((error) => {
                    polySetupPromise = null;
                    throw error;
                });

            return polySetupPromise;
        },
        'flow'
    );
}

/**
 * Construye una apertura polinomial a partir de la tabla g_i del prover.
 *
 * @param {bigint[]} evaluations Tabla inicial de evaluaciones.
 * @param {string|bigint} openingPoint Punto z enviado o derivado por el servidor.
 * @returns {{point: bigint, value: bigint, proof: bigint}} Apertura polinomial.
 */
function buildPolynomialOpening(evaluations, openingPoint) {
    return traceSync(
        'login-app',
        'buildPolynomialOpening',
        { evaluationsLength: evaluations.length, openingPoint },
        () => {
            const coefficients =
                evaluationsToPolynomialCoefficients(evaluations);
            return openPolynomial(coefficients, openingPoint);
        },
        'flow'
    );
}

/**
 * Reconstruye la tabla g_i desde la contraseña y calcula la apertura polinomial.
 *
 * Se usa en login para demostrar que el polinomio abierto corresponde a la contraseña
 * introducida, reutilizando la misma aritmetización que en Sum-Check.
 *
 * @param {Object} params Datos públicos y punto de apertura.
 * @param {string} params.password Contraseña introducida por el usuario.
 * @param {string[]} params.weights Pesos públicos registrados.
 * @param {number} params.expectedPasswordBytes Longitud esperada de la contraseña.
 * @param {string} params.openingPoint Punto z de apertura.
 * @returns {{point: bigint, value: bigint, proof: bigint}} Apertura polinomial.
 */
function buildPolynomialOpeningFromPassword({
    password,
    weights,
    expectedPasswordBytes,
    openingPoint,
}) {
    return traceSync(
        'login-app',
        'buildPolynomialOpeningFromPassword',
        { weightsLength: weights.length, expectedPasswordBytes, openingPoint },
        () => {
            const bits = passwordToBits(password, expectedPasswordBytes);
            const evaluations = buildEvaluationsFromBits(bits, weights);
            return buildPolynomialOpening(evaluations, openingPoint);
        },
        'flow'
    );
}

/**
 * Calcula estadísticos simples para el benchmark de login.
 *
 * @param {number[]} values Mediciones en milisegundos.
 * @returns {{mean: number, median: number, p95: number}} Estadísticos en milisegundos.
 */
function computeStats(values) {
    return traceSync(
        'login-app',
        'computeStats',
        { valuesLength: values.length },
        () => {
            if (!values.length) {
                return { mean: 0, median: 0, p95: 0 };
            }
            const sorted = [...values].sort((a, b) => a - b);
            const mean =
                sorted.reduce((acc, value) => acc + value, 0) / sorted.length;
            const middle = Math.floor(sorted.length / 2);
            const median =
                sorted.length % 2 === 0
                    ? (sorted[middle - 1] + sorted[middle]) / 2
                    : sorted[middle];
            const p95Index = Math.min(
                sorted.length - 1,
                Math.ceil(sorted.length * 0.95) - 1
            );
            const round = (value) => Number(value.toFixed(2));
            return {
                mean: round(mean),
                median: round(median),
                p95: round(sorted[p95Index]),
            };
        },
        'flow'
    );
}

/**
 * Obtiene o crea el botón que permite continuar a la zona privada tras autenticar.
 *
 * @returns {HTMLButtonElement} Botón de navegación a private.html.
 */
function getContinueButton() {
    return traceSync(
        'login-app',
        'getContinueButton',
        undefined,
        () => {
            let button = document.getElementById('continue-btn');
            if (button) {
                return button;
            }

            button = document.createElement('button');
            button.id = 'continue-btn';
            button.className = 'continue-button';
            button.textContent = 'Continuar a la zona privada';
            button.addEventListener('click', () => {
                window.location.href = 'private.html';
            });

            status.insertAdjacentElement('afterend', button);
            return button;
        },
        'verbose'
    );
}

/**
 * Muestra el botón de acceso a la zona privada.
 */
function showContinueButton() {
    return traceSync(
        'login-app',
        'showContinueButton',
        undefined,
        () => {
            getContinueButton().style.display = 'block';
        },
        'verbose'
    );
}

/**
 * Oculta el botón de acceso a la zona privada cuando no hay login válido.
 */
function hideContinueButton() {
    return traceSync(
        'login-app',
        'hideContinueButton',
        undefined,
        () => {
            const button = document.getElementById('continue-btn');
            if (button) {
                button.style.display = 'none';
            }
        },
        'verbose'
    );
}

/**
 * Ejecuta el flujo de login interactivo ronda a ronda contra el servidor.
 *
 * @returns {Promise<{success: boolean, clientMs?: number, serverMs?: number|null}>} Resultado y tiempos de ejecución.
 */
async function runInteractiveLogin() {
    return traceAsync(
        'login-app',
        'runInteractiveLogin',
        undefined,
        async () => {
            hideContinueButton();
            const startTime = performance.now();
            const { username, password } = getLoginInputs();

            if (!username || !password) {
                setStatus('Rellena todos los campos');
                return { success: false };
            }

            try {
                setStatus('Solicitando desafío público...');
                const challengeResponse = await fetch(
                    `/api/zkp/login-challenge/${encodeURIComponent(username)}`
                );
                const challengeData = await challengeResponse.json();

                if (!challengeResponse.ok) {
                    throw new Error(
                        challengeData.error || 'No se pudo obtener el desafío'
                    );
                }

                const expectedPasswordBytes =
                    challengeData.passwordBytes ??
                    Math.floor(challengeData.bitLength / 8);
                const passwordLength = new TextEncoder().encode(
                    password
                ).length;
                if (passwordLength !== expectedPasswordBytes) {
                    setStatus('Contraseña inválida');
                    return { success: false };
                }

                const wantsPoly = isPolyCommitmentSelected();
                if (wantsPoly && !challengeData.polyOpeningPoint) {
                    setStatus(
                        'El usuario no tiene compromiso polinomial registrado'
                    );
                    return { success: false };
                }

                if (wantsPoly) {
                    await ensurePolySetup();
                }

                const prover = new InteractiveSumCheckProver({
                    password,
                    weights: challengeData.weights,
                    point: challengeData.point,
                    expectedPasswordBytes,
                });

                const polyOpening =
                    wantsPoly && challengeData.polyOpeningPoint
                        ? buildPolynomialOpening(
                              prover.evaluations,
                              challengeData.polyOpeningPoint
                          )
                        : null;

                setStatus('Ejecutando rondas del protocolo Sum-Check...');
                for (let round = 0; round < challengeData.rounds; round += 1) {
                    const message = prover.buildCurrentRoundMessage();
                    const roundResponse = await fetch('/api/zkp/login-round', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            loginId: challengeData.loginId,
                            round: message.round,
                            left: message.left.toString(),
                            right: message.right.toString(),
                        }),
                    });

                    const roundData = await roundResponse.json();
                    if (!roundResponse.ok) {
                        throw new Error(
                            roundData.error || 'La ronda no es válida'
                        );
                    }

                    prover.consumeRoundChallenge();
                    setStatus(
                        `Ronda ${roundData.round}/${challengeData.rounds} verificada`
                    );
                }

                const finishPayload = {
                    loginId: challengeData.loginId,
                    foldedValue: prover.finalValue.toString(),
                    usePolyCommitment: wantsPoly,
                };
                if (polyOpening) {
                    finishPayload.polyOpeningPoint =
                        polyOpening.point.toString();
                    finishPayload.polyOpeningValue =
                        polyOpening.value.toString();
                    finishPayload.polyOpeningProof =
                        polyOpening.proof.toString();
                }

                const finishResponse = await fetch('/api/zkp/login-finish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(finishPayload),
                });

                const finishData = await finishResponse.json();
                if (!finishResponse.ok) {
                    throw new Error(
                        finishData.error || 'La prueba no es válida'
                    );
                }

                if (finishData.success) {
                    return {
                        success: true,
                        clientMs: Number(
                            (performance.now() - startTime).toFixed(3)
                        ),
                        serverMs:
                            finishData.elapsedMs !== undefined
                                ? Number(finishData.elapsedMs)
                                : null,
                    };
                }

                setStatus('Autenticación rechazada');
                hideContinueButton();
                return { success: false };
            } catch (error) {
                console.error('Error completo:', error);
                setStatus(`Error: ${error.message}`);
                hideContinueButton();
                return { success: false };
            }
        },
        'flow'
    );
}

/**
 * Ejecuta el login no interactivo generando una prueba Fiat-Shamir completa en el cliente.
 *
 * @returns {Promise<{success: boolean, clientMs?: number, serverMs?: number|null}>} Resultado y tiempos de ejecución.
 */
async function runFiatShamirLogin() {
    return traceAsync(
        'login-app',
        'runFiatShamirLogin',
        undefined,
        async () => {
            hideContinueButton();
            const startTime = performance.now();
            const { username, password } = getLoginInputs();

            if (!username || !password) {
                setStatus('Rellena todos los campos');
                return { success: false };
            }

            try {
                setStatus('Solicitando desafío Fiat-Shamir...');
                const challengeResponse = await fetch(
                    `/api/zkp/login-challenge-fs/${encodeURIComponent(username)}`
                );
                const challengeData = await challengeResponse.json();

                if (!challengeResponse.ok) {
                    throw new Error(
                        challengeData.error || 'No se pudo obtener el desafío'
                    );
                }

                const expectedPasswordBytes =
                    challengeData.passwordBytes ??
                    Math.floor(challengeData.bitLength / 8);
                const passwordLength = new TextEncoder().encode(
                    password
                ).length;
                if (passwordLength !== expectedPasswordBytes) {
                    setStatus('Contraseña inválida');
                    return { success: false };
                }

                const wantsPoly = isPolyCommitmentSelected();
                if (wantsPoly && !challengeData.polyOpeningPoint) {
                    setStatus(
                        'El usuario no tiene compromiso polinomial registrado'
                    );
                    return { success: false };
                }

                if (wantsPoly) {
                    await ensurePolySetup();
                }

                setStatus('Generando prueba Fiat-Shamir...');
                const proof = await buildFiatShamirProof({
                    username,
                    password,
                    weights: challengeData.weights,
                    expectedPasswordBytes,
                    bitLength: challengeData.bitLength,
                    polyCommitment: challengeData.polyCommitment,
                });

                const polyOpening =
                    wantsPoly && challengeData.polyOpeningPoint
                        ? buildPolynomialOpeningFromPassword({
                              password,
                              weights: challengeData.weights,
                              expectedPasswordBytes,
                              openingPoint: challengeData.polyOpeningPoint,
                          })
                        : null;

                const roundMessages = proof.roundMessages.map((message) => ({
                    round: message.round,
                    left: message.left.toString(),
                    right: message.right.toString(),
                }));

                const proofPayload = {
                    username,
                    roundMessages,
                    foldedValue: proof.finalValue.toString(),
                    usePolyCommitment: wantsPoly,
                };
                if (polyOpening) {
                    proofPayload.polyOpeningPoint =
                        polyOpening.point.toString();
                    proofPayload.polyOpeningValue =
                        polyOpening.value.toString();
                    proofPayload.polyOpeningProof =
                        polyOpening.proof.toString();
                }

                setStatus('Enviando prueba al servidor...');
                const proofResponse = await fetch('/api/zkp/login-fs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(proofPayload),
                });

                const proofData = await proofResponse.json();
                if (!proofResponse.ok) {
                    throw new Error(
                        proofData.error || 'La prueba no es válida'
                    );
                }

                if (proofData.success) {
                    return {
                        success: true,
                        clientMs: Number(
                            (performance.now() - startTime).toFixed(3)
                        ),
                        serverMs:
                            proofData.elapsedMs !== undefined
                                ? Number(proofData.elapsedMs)
                                : null,
                    };
                }

                setStatus('Autenticación rechazada');
                hideContinueButton();
                return { success: false };
            } catch (error) {
                console.error('Error completo:', error);
                setStatus(`Error: ${error.message}`);
                hideContinueButton();
                return { success: false };
            }
        },
        'flow'
    );
}

/**
 * Selecciona el flujo de login según el modo elegido en la interfaz.
 *
 * @returns {Promise<{success: boolean, clientMs?: number, serverMs?: number|null}>} Resultado del login.
 */
async function runSingleLogin() {
    return traceAsync(
        'login-app',
        'runSingleLogin',
        undefined,
        async () => {
            if (isFiatShamirSelected()) {
                return runFiatShamirLogin();
            }
            return runInteractiveLogin();
        },
        'flow'
    );
}

btn.onclick = async () =>
    traceAsync('login-app', 'btn.onclick', undefined, async () => {
        setBenchResult('');
        const result = await runSingleLogin();
        if (result?.success) {
            const modeLabel = isFiatShamirSelected()
                ? 'Fiat-Shamir'
                : 'Interactivo';
            const polyLabel = isPolyCommitmentSelected()
                ? ' + compromiso polinomial'
                : '';
            const serverText =
                result.serverMs !== null
                    ? ` / ${result.serverMs} ms backend`
                    : '';
            setStatus(
                `Autenticado (${modeLabel}${polyLabel}) en ${result.clientMs} ms cliente${serverText}`
            );
            showContinueButton();
        }
    });

if (benchBtn) {
    benchBtn.onclick = async () =>
        traceAsync('login-app', 'benchBtn.onclick', undefined, async () => {
            setBenchResult('Preparando benchmark comparativo...');
            hideContinueButton();

            const { username, password } = getLoginInputs();
            if (!username || !password) {
                setStatus('');
                setBenchResult(
                    'Completa usuario y contraseña antes del benchmark.'
                );
                return;
            }

            const initialFiatShamir = fsModeToggle.checked;
            const initialPolyCommitment = polyModeToggle.checked;
            const measurements = Object.fromEntries(
                BENCHMARK_CONFIGURATIONS.map((configuration) => [
                    configuration.key,
                    [],
                ])
            );
            const totalRuns = BENCHMARK_WARMUP_RUNS + BENCHMARK_MEASURED_RUNS;

            btn.disabled = true;
            benchBtn.disabled = true;
            fsModeToggle.disabled = true;
            polyModeToggle.disabled = true;

            try {
                for (let iteration = 0; iteration < totalRuns; iteration += 1) {
                    const isWarmup = iteration < BENCHMARK_WARMUP_RUNS;
                    const phaseIteration = isWarmup
                        ? iteration + 1
                        : iteration - BENCHMARK_WARMUP_RUNS + 1;
                    const phaseRuns = isWarmup
                        ? BENCHMARK_WARMUP_RUNS
                        : BENCHMARK_MEASURED_RUNS;

                    for (const configuration of BENCHMARK_CONFIGURATIONS) {
                        fsModeToggle.checked = configuration.fiatShamir;
                        polyModeToggle.checked = configuration.polyCommitment;
                        setStatus(
                            `${isWarmup ? 'Calentamiento' : 'Medición'} ` +
                                `${phaseIteration}/${phaseRuns}: ${configuration.label}`
                        );

                        const result = await runSingleLogin();
                        if (!result?.success) {
                            throw new Error(
                                `falló la configuración ${configuration.label}`
                            );
                        }

                        if (!isWarmup) {
                            measurements[configuration.key].push(
                                result.clientMs
                            );
                        }
                    }
                }

                const configurations = Object.fromEntries(
                    BENCHMARK_CONFIGURATIONS.map((configuration) => [
                        configuration.key,
                        {
                            label: configuration.label,
                            ...computeStats(measurements[configuration.key]),
                            samplesMs: measurements[configuration.key],
                        },
                    ])
                );
                const benchmarkResult = {
                    measuredAt: new Date().toISOString(),
                    userAgent: navigator.userAgent,
                    username,
                    passwordBytes: new TextEncoder().encode(password).length,
                    warmupRuns: BENCHMARK_WARMUP_RUNS,
                    measuredRuns: BENCHMARK_MEASURED_RUNS,
                    configurations,
                };

                window.lastBenchmarkResult = benchmarkResult;
                console.info(
                    '[BENCHMARK_RESULT]',
                    JSON.stringify(benchmarkResult, null, 2)
                );

                const lines = BENCHMARK_CONFIGURATIONS.map((configuration) => {
                    const stats = configurations[configuration.key];
                    return (
                        `${configuration.key}: media ${stats.mean} ms, ` +
                        `mediana ${stats.median} ms, p95 ${stats.p95} ms`
                    );
                });

                setStatus(
                    `Benchmark completado: ${BENCHMARK_MEASURED_RUNS} muestras ` +
                        `por configuración`
                );
                setBenchResult(
                    `${benchmarkResult.passwordBytes} bytes\n${lines.join('\n')}`
                );
                showContinueButton();
            } catch (error) {
                console.error('Error durante el benchmark:', error);
                setStatus('Benchmark cancelado');
                setBenchResult(`Benchmark cancelado: ${error.message}.`);
                hideContinueButton();
            } finally {
                fsModeToggle.checked = initialFiatShamir;
                polyModeToggle.checked = initialPolyCommitment;
                btn.disabled = false;
                benchBtn.disabled = false;
                fsModeToggle.disabled = false;
                polyModeToggle.disabled = false;
            }
        });
}
