/**************************************************************************************************
 * @file    register-app.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Lógica del lado del cliente para la aplicación de registro que utiliza el protocolo de sum-check.
 * El cliente calcula el claim inicial, el valor final y el compromiso polinomial didáctico.
 *************************************************************************************************/

import { InteractiveSumCheckProver } from '/sum-check-protocol/prover.js';
import { buildFiatShamirProof } from '/sum-check-protocol/fiat-shamir.js';
import {
    evaluationsToPolynomialCoefficients,
    commitPolynomial,
    setDemoTau,
} from '/sum-check-protocol/polynomial-commitment.js';
import { traceAsync, traceSync } from '/sum-check-protocol/trace.js';

const message = document.getElementById('m');
const passwordSizeSelect = document.getElementById('pw-bytes');
let registrationChallenge = null;
let currentPasswordBytes = 8;
let polySetupPromise = null;

/**
 * Muestra mensajes de estado en la pantalla de registro.
 *
 * @param {string} text Mensaje a mostrar.
 */
function setMessage(text) {
    return traceSync(
        'register-app',
        'setMessage',
        { text },
        () => {
            message.innerText = text;
        },
        'verbose'
    );
}

/**
 * Carga el setup polinomial antes de calcular el compromiso de registro.
 *
 * @returns {Promise<Object>} Setup didáctico recibido del servidor.
 */
async function ensurePolySetup() {
    return traceAsync(
        'register-app',
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
 * Calcula el compromiso polinomial didáctico C_f=f(tau) a partir de la tabla g_i.
 *
 * @param {bigint[]} evaluations Tabla inicial de evaluaciones del prover.
 * @returns {bigint} Compromiso polinomial.
 */
function buildPolynomialCommitment(evaluations) {
    return traceSync(
        'register-app',
        'buildPolynomialCommitment',
        { evaluationsLength: evaluations.length },
        () => {
            const coefficients =
                evaluationsToPolynomialCoefficients(evaluations);
            return commitPolynomial(coefficients);
        },
        'flow'
    );
}

/**
 * Solicita al servidor un desafío público de registro para el tamaño de contraseña elegido.
 *
 * @param {number} [bytes=currentPasswordBytes] Tamaño de contraseña en bytes.
 * @returns {Promise<void>}
 */
async function loadChallenge(bytes = currentPasswordBytes) {
    return traceAsync(
        'register-app',
        'loadChallenge',
        { bytes },
        async () => {
            currentPasswordBytes = bytes;
            const response = await fetch(
                `/api/zkp/register-challenge?bytes=${bytes}`
            );
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'No se pudo cargar el desafío');
            }

            registrationChallenge = data;
            currentPasswordBytes = data.passwordBytes ?? bytes;
            setMessage(
                `Desafío público cargado (${currentPasswordBytes} bytes). Ya puedes registrar la cuenta.`
            );
        },
        'flow'
    );
}

/**
 * Ejecuta el registro completo: Sum-Check interactivo, valor Fiat-Shamir y compromiso polinomial.
 *
 * Los valores derivados se envían al servidor sin enviar la contraseña.
 *
 * @returns {Promise<void>}
 */
async function register() {
    return traceAsync(
        'register-app',
        'register',
        undefined,
        async () => {
            const usernameInput = document.getElementById('u');
            const passwordInput = document.getElementById('p');
            const username = usernameInput.value.trim();

            if (!registrationChallenge) {
                setMessage('Espera a que cargue el desafío del servidor');
                return;
            }

            if (!username || !passwordInput.value) {
                setMessage('Rellena todos los campos');
                return;
            }

            setMessage('Construyendo claim inicial...');

            try {
                await ensurePolySetup();
                const expectedPasswordBytes =
                    registrationChallenge.passwordBytes ?? currentPasswordBytes;
                const prover = new InteractiveSumCheckProver({
                    password: passwordInput.value,
                    weights: registrationChallenge.weights,
                    point: registrationChallenge.point,
                    expectedPasswordBytes,
                });
                const polyCommitment = buildPolynomialCommitment(
                    prover.evaluations
                );

                for (
                    let round = 0;
                    round < registrationChallenge.rounds;
                    round += 1
                ) {
                    prover.buildCurrentRoundMessage();
                    prover.consumeRoundChallenge();
                }

                setMessage('Generando prueba Fiat-Shamir...');
                const fsProof = await buildFiatShamirProof({
                    username,
                    password: passwordInput.value,
                    weights: registrationChallenge.weights,
                    expectedPasswordBytes,
                    bitLength: registrationChallenge.bitLength,
                    polyCommitment,
                });

                if (fsProof.initialClaim !== prover.initialClaim) {
                    throw new Error('Claim inicial Fiat-Shamir incoherente');
                }

                setMessage('Enviando datos de registro al servidor...');
                const response = await fetch('/api/zkp/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        challengeId: registrationChallenge.challengeId,
                        username,
                        initialClaim: prover.initialClaim.toString(),
                        finalValue: prover.finalValue.toString(),
                        fsFinalValue: fsProof.finalValue.toString(),
                        polyCommitment: polyCommitment.toString(),
                    }),
                });

                const data = await response.json();
                if (data.success) {
                    setMessage(
                        'Registrado con éxito. Redirigiendo al login...'
                    );
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 2000);
                    return;
                }

                setMessage('Error: ' + (data.error || 'No se pudo registrar'));
            } catch (error) {
                setMessage(`Error: ${error.message}`);
            }
        },
        'flow'
    );
}

window.reg = register;

if (passwordSizeSelect) {
    passwordSizeSelect.addEventListener('change', () => {
        const nextBytes = Number.parseInt(passwordSizeSelect.value, 10);
        loadChallenge(nextBytes).catch((error) => {
            setMessage(`Error cargando desafío: ${error.message}`);
        });
    });
    currentPasswordBytes = Number.parseInt(passwordSizeSelect.value, 10) || 8;
}

loadChallenge(currentPasswordBytes).catch((error) => {
    setMessage(`Error cargando desafío: ${error.message}`);
});
