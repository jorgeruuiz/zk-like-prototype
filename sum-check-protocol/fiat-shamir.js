/**************************************************************************************************
 * @file    fiat-shamir.js
 * @author  Jorge Ruiz Gonzalez (826685)
 * @date    22/04/2026
 * @description
 * Utilidades para transformar Sum-Check en una prueba no interactiva usando Fiat-Shamir.
 *************************************************************************************************/

import {
    DEFAULT_PASSWORD_BYTES,
    FIELD_PRIME,
    add,
    mul,
    sub,
    sumField,
    toField,
    passwordToBits,
} from './field.js';
import {
    buildEvaluationsFromBits,
    buildRoundPolynomial,
    foldEvaluations,
} from './protocol.js';
import { traceAsync, traceSync, vectorSummary } from './trace.js';

export const FS_DOMAIN = 'sumcheck-fs-v2';

/**
 * Convierte un array de bytes a una cadena hexadecimal.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
    return traceSync(
        'fiat-shamir',
        'bytesToHex',
        { byteLength: bytes.length },
        () =>
            Array.from(bytes, (value) =>
                value.toString(16).padStart(2, '0')
            ).join(''),
        'verbose'
    );
}

/**
 * Calcula un hash SHA-256 sobre un mensaje de texto.
 * Usa SubtleCrypto en navegador y crypto en Node.js.
 * @param {string} message
 * @returns {Promise<Uint8Array>}
 */
async function sha256Bytes(message) {
    return traceAsync(
        'fiat-shamir',
        'sha256Bytes',
        { messageLength: message.length },
        async () => {
            const data = new TextEncoder().encode(message);
            if (globalThis.crypto?.subtle) {
                const digest = await globalThis.crypto.subtle.digest(
                    'SHA-256',
                    data
                );
                return new Uint8Array(digest);
            }

            const { createHash } = await import('crypto');
            const hash = createHash('sha256')
                .update(Buffer.from(data))
                .digest();
            return new Uint8Array(hash);
        },
        'flow'
    );
}

/**
 * Reduce un hash al campo finito F_p.
 * @param {Uint8Array} bytes
 * @returns {bigint}
 */
function hashToField(bytes) {
    return traceSync(
        'fiat-shamir',
        'hashToField',
        { byteLength: bytes.length },
        () => {
            const hex = bytesToHex(bytes);
            let value = BigInt(`0x${hex}`) % FIELD_PRIME;
            if (value === 0n) {
                value = 1n;
            }
            return value;
        },
        'flow'
    );
}

/**
 * Normaliza un valor de campo para incluirlo en el transcript canónico.
 * @param {string|number|bigint} value
 * @returns {string}
 */
function toFieldString(value) {
    return toField(value).toString();
}

/**
 * Normaliza el vector de pesos que define la instancia pública del Sum-Check.
 * @param {Object} params
 * @param {Array} params.weights
 * @param {number} params.bitLength
 * @returns {Array<string>}
 */
function normalizeWeights({ weights, bitLength }) {
    return traceSync(
        'fiat-shamir',
        'normalizeWeights',
        {
            weights: vectorSummary(weights),
            bitLength,
        },
        () => {
            if (!Array.isArray(weights)) {
                throw new Error('weights debe ser un array');
            }

            if (weights.length !== bitLength) {
                throw new Error(
                    'weights debe tener la misma longitud que bitLength'
                );
            }

            return weights.map((value) => toFieldString(value));
        },
        'flow'
    );
}

/**
 * Normaliza un mensaje de ronda para incluirlo en el transcript acumulado.
 * @param {Object} message
 * @param {number} message.round
 * @param {string|number|bigint} message.left
 * @param {string|number|bigint} message.right
 * @returns {{round: number, left: string, right: string}}
 */
function normalizeRoundMessage(message) {
    return {
        round: Number(message.round),
        left: toFieldString(message.left),
        right: toFieldString(message.right),
    };
}

/**
 * Construye el enunciado público que queda ligado a todos los retos Fiat-Shamir.
 * @param {Object} params
 * @param {string} params.username
 * @param {bigint|string|number} params.initialClaim
 * @param {number} params.bitLength
 * @param {Array} params.weights
 * @param {bigint|string|number|null} [params.polyCommitment]
 * @returns {Object}
 */
function buildStatement({
    username,
    initialClaim,
    bitLength,
    weights,
    polyCommitment = null,
}) {
    return traceSync(
        'fiat-shamir',
        'buildStatement',
        {
            username,
            initialClaim,
            bitLength,
            weights: vectorSummary(weights),
            hasPolyCommitment:
                polyCommitment !== null && polyCommitment !== undefined,
        },
        () => {
            const resolvedBitLength = Number(bitLength);
            const rounds = Math.log2(resolvedBitLength);
            if (!Number.isInteger(rounds)) {
                throw new Error(
                    'bitLength debe ser potencia de 2 para definir rondas'
                );
            }

            return {
                domain: FS_DOMAIN,
                protocol: 'weighted-password-sumcheck',
                fieldPrime: FIELD_PRIME.toString(),
                username: String(username),
                bitLength: resolvedBitLength,
                rounds,
                initialClaim: toFieldString(initialClaim),
                weights: normalizeWeights({
                    weights,
                    bitLength: resolvedBitLength,
                }),
                polyCommitment:
                    polyCommitment !== null && polyCommitment !== undefined
                        ? toFieldString(polyCommitment)
                        : null,
            };
        },
        'flow'
    );
}

/**
 * Construye el transcript canónico usado para derivar retos en Fiat-Shamir.
 * @param {Object} params
 * @param {Object} params.statement Enunciado público normalizado.
 * @param {Array<{round: number, left: bigint, right: bigint}>} params.roundMessages
 * @returns {string}
 */
function buildTranscript({ statement, roundMessages }) {
    return traceSync(
        'fiat-shamir',
        'buildTranscript',
        {
            username: statement.username,
            bitLength: statement.bitLength,
            roundMessagesLength: Array.isArray(roundMessages)
                ? roundMessages.length
                : null,
        },
        () => {
            if (!Array.isArray(roundMessages) || roundMessages.length === 0) {
                throw new Error(
                    'El transcript Fiat-Shamir necesita al menos un mensaje de ronda'
                );
            }

            return JSON.stringify({
                statement,
                transcript: roundMessages.map(normalizeRoundMessage),
            });
        },
        'flow'
    );
}

/**
 * Deriva el reto de la ronda actual mediante Fiat-Shamir a partir del transcript acumulado.
 * @param {Object} params
 * @param {Object} params.statement Enunciado público normalizado.
 * @param {Array<{round: number, left: bigint, right: bigint}>} params.roundMessages
 * @returns {Promise<bigint>}
 */
export async function deriveChallenge({ statement, roundMessages }) {
    const latestRound =
        Array.isArray(roundMessages) && roundMessages.length > 0
            ? Number(roundMessages[roundMessages.length - 1].round)
            : null;

    return traceAsync(
        'fiat-shamir',
        'deriveChallenge',
        {
            username: statement?.username,
            bitLength: statement?.bitLength,
            round: latestRound,
            transcriptLength: Array.isArray(roundMessages)
                ? roundMessages.length
                : null,
        },
        async () => {
            const transcript = buildTranscript({ statement, roundMessages });
            const hashBytes = await sha256Bytes(transcript);
            return hashToField(hashBytes);
        },
        'flow'
    );
}

/**
 * Construye una prueba Fiat-Shamir completa a partir de la contraseña y los parámetros públicos.
 * @param {Object} params
 * @param {string} params.username
 * @param {string} params.password
 * @param {Array} params.weights
 * @param {number} [params.expectedPasswordBytes]
 * @param {number} [params.bitLength]
 * @param {bigint|string|number|null} [params.polyCommitment]
 * @returns {Promise<Object>} Prueba completa.
 * @returns {bigint} return.initialClaim Claim inicial de Sum-Check.
 * @returns {Array<{round: number, left: bigint, right: bigint}>} return.roundMessages Mensajes de ronda.
 * @returns {bigint} return.finalValue Valor final tras el plegado.
 */
export async function buildFiatShamirProof({
    username,
    password,
    weights,
    expectedPasswordBytes = DEFAULT_PASSWORD_BYTES,
    bitLength,
    polyCommitment = null,
}) {
    return traceAsync(
        'fiat-shamir',
        'buildFiatShamirProof',
        {
            username,
            weights: vectorSummary(weights),
            expectedPasswordBytes,
            bitLength,
            hasPolyCommitment:
                polyCommitment !== null && polyCommitment !== undefined,
        },
        async () => {
            const bits = passwordToBits(password, expectedPasswordBytes);
            const resolvedBitLength = bitLength ?? bits.length;
            if (resolvedBitLength !== bits.length) {
                throw new Error(
                    'bitLength no coincide con la longitud real de la password'
                );
            }

            const rounds = Math.log2(resolvedBitLength);
            if (!Number.isInteger(rounds)) {
                throw new Error(
                    'bitLength debe ser potencia de 2 para definir rondas'
                );
            }

            const fieldWeights = weights.map((value) => toField(value));
            let evaluations = buildEvaluationsFromBits(bits, fieldWeights);
            const initialClaim = sumField(evaluations);
            const statement = buildStatement({
                username,
                initialClaim,
                bitLength: resolvedBitLength,
                weights: fieldWeights,
                polyCommitment,
            });
            const roundMessages = [];

            for (let round = 0; round < rounds; round += 1) {
                const polynomial = buildRoundPolynomial(evaluations);
                const left = polynomial.left;
                const right = polynomial.right;
                const roundMessage = { round, left, right };
                const challenge = await deriveChallenge({
                    statement,
                    roundMessages: [...roundMessages, roundMessage],
                });
                roundMessages.push(roundMessage);
                evaluations = foldEvaluations(evaluations, challenge);
            }

            if (evaluations.length !== 1) {
                throw new Error('La prueba no se redujo a un unico valor');
            }

            return {
                transcriptVersion: FS_DOMAIN,
                initialClaim,
                roundMessages,
                finalValue: evaluations[0],
            };
        },
        'flow'
    );
}

/**
 * Verifica una prueba Fiat-Shamir reconstruyendo los retos y comprobando el claim final.
 * @param {Object} params
 * @param {string} params.username
 * @param {bigint} params.initialClaim
 * @param {number} params.bitLength
 * @param {Array} params.weights
 * @param {Array<{round: number, left: bigint, right: bigint}>} params.roundMessages
 * @param {bigint} params.expectedFinalValue
 * @param {bigint} params.reportedFinalValue
 * @param {bigint|string|number|null} [params.polyCommitment]
 * @returns {Promise<{accepted: boolean, claimFinal: bigint}>}
 */
export async function verifyFiatShamirProof({
    username,
    initialClaim,
    bitLength,
    weights,
    roundMessages,
    expectedFinalValue,
    reportedFinalValue,
    polyCommitment = null,
}) {
    return traceAsync(
        'fiat-shamir',
        'verifyFiatShamirProof',
        {
            username,
            bitLength,
            weights: vectorSummary(weights),
            roundMessagesLength: Array.isArray(roundMessages)
                ? roundMessages.length
                : null,
            expectedFinalValue,
            reportedFinalValue,
            hasPolyCommitment:
                polyCommitment !== null && polyCommitment !== undefined,
        },
        async () => {
            if (!Array.isArray(roundMessages)) {
                throw new Error('roundMessages debe ser un array');
            }

            if (
                expectedFinalValue === undefined ||
                expectedFinalValue === null
            ) {
                throw new Error('No hay valor final Fiat-Shamir registrado');
            }

            const resolvedBitLength = Number(bitLength);
            const rounds = Math.log2(resolvedBitLength);
            if (!Number.isInteger(rounds)) {
                throw new Error(
                    'bitLength debe ser potencia de 2 para definir rondas'
                );
            }

            if (roundMessages.length !== rounds) {
                throw new Error('Numero de rondas incorrecto');
            }

            const initialClaimField = toField(initialClaim);
            const statement = buildStatement({
                username,
                initialClaim: initialClaimField,
                bitLength: resolvedBitLength,
                weights,
                polyCommitment,
            });
            const transcriptMessages = [];
            let currentClaim = initialClaimField;

            for (let round = 0; round < rounds; round += 1) {
                const message = roundMessages[round];
                if (Number(message.round) !== round) {
                    throw new Error('Ronda fuera de orden');
                }

                const leftField = toField(message.left);
                const rightField = toField(message.right);
                if (add(leftField, rightField) !== currentClaim) {
                    throw new Error(
                        'La ronda no es consistente con el claim actual'
                    );
                }

                transcriptMessages.push({
                    round,
                    left: leftField,
                    right: rightField,
                });
                const challenge = await deriveChallenge({
                    statement,
                    roundMessages: transcriptMessages,
                });

                currentClaim = add(
                    mul(leftField, sub(1n, challenge)),
                    mul(rightField, challenge)
                );
            }

            const reported = toField(reportedFinalValue);
            const expected = toField(expectedFinalValue);
            const accepted = reported === currentClaim && reported === expected;

            return {
                accepted,
                claimFinal: currentClaim,
            };
        },
        'flow'
    );
}
