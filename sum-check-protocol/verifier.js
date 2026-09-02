/**************************************************************************************************
 * @file    verifier.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Implementación de la clase SumCheckVerifierSession, que gestiona el estado y la lógica del
 * verifier en el protocolo de sum-check. Nota: initialClaim es el claim inicial C, no un commitment.
 *************************************************************************************************/

import crypto from 'crypto';
import {
    FIELD_PRIME,
    add,
    mul,
    parseVector,
    serializeVector,
    sub,
    toField,
} from './field.js';
import {
    traceEnter,
    traceError,
    traceExit,
    traceSync,
    vectorSummary,
} from './trace.js';

export const MIN_PASSWORD_BYTES = 4;
export const DEFAULT_PASSWORD_BYTES = 8;
export const DEFAULT_PASSWORD_BITS = DEFAULT_PASSWORD_BYTES * 8;

/**
 * Comprueba si un entero positivo es potencia de dos.
 *
 * @param {number} value Valor a comprobar.
 * @returns {boolean} true si value es potencia de dos.
 */
function isPowerOfTwo(value) {
    return traceSync(
        'verifier',
        'isPowerOfTwo',
        { value },
        () => value > 0 && (value & (value - 1)) === 0,
        'verbose'
    );
}

/**
 * Valida la longitud en bits usada para construir la tabla de evaluaciones.
 *
 * @param {number} bitLength Longitud en bits.
 * @returns {number} Longitud validada.
 * @throws {Error} Si no es un entero positivo potencia de dos.
 */
function resolveBitLength(bitLength) {
    return traceSync(
        'verifier',
        'resolveBitLength',
        { bitLength },
        () => {
            if (!Number.isInteger(bitLength) || bitLength <= 0) {
                throw new Error('bitLength debe ser un entero positivo');
            }
            if (!isPowerOfTwo(bitLength)) {
                throw new Error('bitLength debe ser potencia de 2');
            }
            return bitLength;
        },
        'flow'
    );
}

/**
 * Genera un elemento aleatorio no nulo del campo F_p.
 *
 * @returns {bigint} Elemento aleatorio de F_p distinto de cero.
 */
export function randomFieldElement() {
    return traceSync(
        'verifier',
        'randomFieldElement',
        undefined,
        () => {
            let value = 0n;
            while (value === 0n) {
                const bytes = crypto.randomBytes(16);
                value = BigInt(`0x${bytes.toString('hex')}`) % FIELD_PRIME;
            }
            return value;
        },
        'flow'
    );
}

/**
 * Genera un vector de elementos aleatorios no nulos del campo.
 *
 * @param {number} length Longitud del vector.
 * @returns {bigint[]} Vector aleatorio en F_p.
 */
export function randomVector(length) {
    return traceSync(
        'verifier',
        'randomVector',
        { length },
        () => Array.from({ length }, () => randomFieldElement()),
        'flow'
    );
}

/**
 * Crea el desafío público usado en registro: pesos y punto de evaluación.
 *
 * @param {{bitLength?: number}} [params={}] Parámetros del desafío.
 * @returns {Object} Desafío público.
 */
export function createPublicChallenge({
    bitLength = DEFAULT_PASSWORD_BITS,
} = {}) {
    return traceSync(
        'verifier',
        'createPublicChallenge',
        { bitLength },
        () => {
            const resolvedBitLength = resolveBitLength(Number(bitLength));
            const rounds = Math.log2(resolvedBitLength);
            if (!Number.isInteger(rounds)) {
                throw new Error(
                    'bitLength debe ser potencia de 2 para definir rondas'
                );
            }

            const weights = randomVector(resolvedBitLength);
            const point = randomVector(rounds);
            const passwordBytes = resolvedBitLength / 8;
            if (!Number.isInteger(passwordBytes)) {
                throw new Error('bitLength debe ser multiplo de 8');
            }

            return {
                rounds,
                bitLength: resolvedBitLength,
                passwordBytes,
                modulus: FIELD_PRIME.toString(),
                weights,
                point,
            };
        },
        'flow'
    );
}

/**
 * Sesión de verificación para el Sum-Check interactivo.
 *
 * Mantiene el claim actual y el índice de ronda. La sesión vive solo durante un
 * intento de login y se elimina al terminar o fallar la verificación.
 */
export class SumCheckVerifierSession {
    /**
     * Crea una sesión de verificación interactiva para un usuario.
     *
     * @param {Object} params Datos registrados y logger opcional.
     * @param {string} params.username Nombre de usuario.
     * @param {bigint|string} params.initialClaim Claim inicial almacenado.
     * @param {bigint|string} params.finalValue Valor final esperado.
     * @param {Array<bigint|string>} params.challengePoint Punto de evaluación registrado.
     * @param {Function} [params.logger] Función de log.
     */
    constructor({
        username,
        initialClaim,
        finalValue,
        challengePoint,
        logger = () => {},
    }) {
        const trace = traceEnter('SumCheckVerifierSession', 'constructor', {
            username,
            initialClaim,
            finalValue,
            challengePoint: vectorSummary(challengePoint),
        });

        try {
            this.username = username;
            this.initialClaim = toField(initialClaim);
            this.finalValue = toField(finalValue);
            this.currentClaim = this.initialClaim;
            this.challengePoint = parseVector(challengePoint, 'challengePoint');
            this.roundIndex = 0;
            this.rounds = this.challengePoint.length;
            this.logger = logger;

            this.logger(
                `[SUMCHECK][${this.username}] Sesion iniciada: ` +
                    `initialClaim=${this.initialClaim.toString()}, rondas=${this.rounds}`
            );
            traceExit(trace, { rounds: this.rounds });
        } catch (error) {
            traceError(trace, error);
            throw error;
        }
    }

    /**
     * Verifica una ronda comprobando s_j(0)+s_j(1)=claim_j y actualiza el claim.
     *
     * @param {{round: number, left: bigint|string, right: bigint|string}} params Mensaje de ronda del prover.
     * @returns {{round: number, currentClaim: bigint, finished: boolean}} Estado posterior a la ronda.
     */
    verifyRound({ round, left, right }) {
        return traceSync(
            'SumCheckVerifierSession',
            'verifyRound',
            {
                round,
                expectedRound: this.roundIndex,
                left,
                right,
                currentClaim: this.currentClaim,
            },
            () => {
                if (Number(round) !== this.roundIndex) {
                    throw new Error('Ronda fuera de orden');
                }

                const leftField = toField(left);
                const rightField = toField(right);
                const roundNumber = this.roundIndex + 1;
                const a0 = leftField;
                const a1 = sub(rightField, leftField);

                this.logger(
                    `[SUMCHECK][${this.username}] Ronda ${roundNumber}/${this.rounds} -> ` +
                        `claim_j=${this.currentClaim.toString()}, s_j(0)=${leftField.toString()}, ` +
                        `s_j(1)=${rightField.toString()}, s_j(t)=${a0.toString()} + (${a1.toString()})*t`
                );

                if (add(leftField, rightField) !== this.currentClaim) {
                    this.logger(
                        `[SUMCHECK][${this.username}] Ronda ${roundNumber}: fallo de consistencia ` +
                            `(s_j(0)+s_j(1) != claim_j)`
                    );
                    throw new Error(
                        'La ronda no es consistente con el claim actual'
                    );
                }

                const challenge = this.challengePoint[this.roundIndex];
                this.currentClaim = add(
                    mul(leftField, sub(1n, challenge)),
                    mul(rightField, challenge)
                );

                this.logger(
                    `[SUMCHECK][${this.username}] Ronda ${roundNumber}: r_j=${challenge.toString()} -> ` +
                        `claim_{j+1}=${this.currentClaim.toString()}`
                );

                this.roundIndex += 1;

                return {
                    round: this.roundIndex,
                    currentClaim: this.currentClaim,
                    finished: this.roundIndex === this.rounds,
                };
            },
            'flow'
        );
    }

    /**
     * Comprueba el valor final plegado contra el claim final y el valor registrado.
     *
     * @param {bigint|string} foldedValue Valor final enviado por el prover.
     * @returns {boolean} true si la prueba interactiva se acepta.
     */
    verifyFinalValue(foldedValue) {
        return traceSync(
            'SumCheckVerifierSession',
            'verifyFinalValue',
            {
                foldedValue,
                currentClaim: this.currentClaim,
                registeredFinalValue: this.finalValue,
            },
            () => {
                if (this.roundIndex !== this.rounds) {
                    throw new Error('Aún faltan rondas por ejecutar');
                }

                const gAtRandomPoint = toField(foldedValue);
                this.logger(
                    `[SUMCHECK][${this.username}] Comprobacion final: g(r) recibido=${gAtRandomPoint.toString()}, ` +
                        `claim_final=${this.currentClaim.toString()}, g(r) esperado(registro)=${this.finalValue.toString()}`
                );

                const accepted =
                    gAtRandomPoint === this.currentClaim &&
                    gAtRandomPoint === this.finalValue;
                this.logger(
                    `[SUMCHECK][${this.username}] Resultado final: ${accepted ? 'ACEPTAR' : 'RECHAZAR'}`
                );
                return accepted;
            },
            'flow'
        );
    }
}

/**
 * Serializa un desafío público para enviarlo al navegador.
 *
 * @param {string} challengeId Identificador temporal del desafío.
 * @param {Object} challenge Desafío generado por createPublicChallenge.
 * @returns {Object} Payload seguro para el cliente.
 */
export function toClientChallengePayload(challengeId, challenge) {
    return traceSync(
        'verifier',
        'toClientChallengePayload',
        {
            challengeId,
            rounds: challenge.rounds,
            bitLength: challenge.bitLength,
        },
        () => ({
            challengeId,
            rounds: challenge.rounds,
            bitLength: challenge.bitLength,
            passwordBytes:
                challenge.passwordBytes ?? Math.floor(challenge.bitLength / 8),
            modulus: challenge.modulus,
            weights: serializeVector(challenge.weights),
            point: serializeVector(challenge.point),
        }),
        'flow'
    );
}
