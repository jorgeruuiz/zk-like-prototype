/**************************************************************************************************
 * @file    prover.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Definición de la clase InteractiveSumCheckProver, que implementa la lógica del prover en el
 * protocolo de sum-check.
 *************************************************************************************************/

import {
    DEFAULT_PASSWORD_BYTES,
    passwordToBits,
    sumField,
    toField,
} from './field.js';
import {
    buildEvaluationsFromBits,
    buildRoundPolynomial,
    foldEvaluations,
} from './protocol.js';
import {
    traceEnter,
    traceError,
    traceExit,
    traceSync,
    vectorSummary,
} from './trace.js';

/**
 * Prover interactivo de Sum-Check.
 *
 * Mantiene la tabla de evaluaciones actual y la va plegando con cada reto del
 * verificador. La tabla inicial se conserva porque también se reutiliza en la capa
 * de compromiso polinomial didáctico.
 */
export class InteractiveSumCheckProver {
    /**
     * Inicializa el prover a partir de la contraseña y los parámetros públicos.
     *
     * @param {Object} params Parámetros del prover.
     * @param {string} params.password Contraseña introducida por el usuario.
     * @param {Array<bigint|string>} params.weights Pesos públicos del desafío.
     * @param {Array<bigint|string>} params.point Punto final usado por el verificador.
     * @param {number} [params.expectedPasswordBytes] Longitud esperada de la contraseña.
     */
    constructor({
        password,
        weights,
        point,
        expectedPasswordBytes = DEFAULT_PASSWORD_BYTES,
    }) {
        const trace = traceEnter('InteractiveSumCheckProver', 'constructor', {
            expectedPasswordBytes,
            weights: vectorSummary(weights),
            point: vectorSummary(point),
        });

        try {
            this.bits = passwordToBits(password, expectedPasswordBytes);
            this.weights = weights.map((value) => toField(value));
            this.point = point.map((value) => toField(value));
            this.currentEvaluations = buildEvaluationsFromBits(
                this.bits,
                this.weights
            );
            this.initialEvaluations = [...this.currentEvaluations];
            this.roundIndex = 0;
            this.initialClaimValue = sumField(this.currentEvaluations);
            traceExit(trace, {
                bitLength: this.bits.length,
                rounds: this.point.length,
                initialClaim: this.initialClaimValue,
            });
        } catch (error) {
            traceError(trace, error);
            throw error;
        }
    }

    /** Claim inicial C = sum_x g(x). No es un compromiso criptográfico. */
    get initialClaim() {
        return traceSync(
            'InteractiveSumCheckProver',
            'get initialClaim',
            undefined,
            () => this.initialClaimValue,
            'flow'
        );
    }

    /** Tabla inicial g_0,...,g_{N-1}; se usa para la capa polinomial didáctica. */
    get evaluations() {
        return traceSync(
            'InteractiveSumCheckProver',
            'get evaluations',
            {
                evaluations: vectorSummary(this.initialEvaluations),
            },
            () => [...this.initialEvaluations],
            'flow'
        );
    }

    /** Valor final tras consumir todas las rondas: g(r_1,...,r_v). */
    get finalValue() {
        return traceSync(
            'InteractiveSumCheckProver',
            'get finalValue',
            {
                currentLength: this.currentEvaluations.length,
            },
            () => {
                if (this.currentEvaluations.length !== 1) {
                    throw new Error(
                        'Todavía no se han aplicado todas las rondas'
                    );
                }
                return this.currentEvaluations[0];
            },
            'flow'
        );
    }

    /**
     * Construye el mensaje de la ronda actual, formado por s_j(0) y s_j(1).
     *
     * @returns {{round: number, left: bigint, right: bigint}} Mensaje enviado al verificador.
     */
    buildCurrentRoundMessage() {
        return traceSync(
            'InteractiveSumCheckProver',
            'buildCurrentRoundMessage',
            {
                roundIndex: this.roundIndex,
                currentEvaluations: vectorSummary(this.currentEvaluations),
            },
            () => {
                if (this.roundIndex >= this.point.length) {
                    throw new Error('No quedan rondas por ejecutar');
                }

                const polynomial = buildRoundPolynomial(
                    this.currentEvaluations
                );
                return {
                    round: this.roundIndex,
                    left: polynomial.left,
                    right: polynomial.right,
                };
            },
            'flow'
        );
    }

    /**
     * Consume el reto correspondiente a la ronda actual y pliega la tabla de evaluaciones.
     */
    consumeRoundChallenge() {
        return traceSync(
            'InteractiveSumCheckProver',
            'consumeRoundChallenge',
            {
                roundIndex: this.roundIndex,
            },
            () => {
                if (this.roundIndex >= this.point.length) {
                    throw new Error('No quedan retos por consumir');
                }

                const challenge = this.point[this.roundIndex];
                this.currentEvaluations = foldEvaluations(
                    this.currentEvaluations,
                    challenge
                );
                this.roundIndex += 1;
            },
            'flow'
        );
    }
}
