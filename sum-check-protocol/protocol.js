/**************************************************************************************************
 * @file    protocol.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Implementación de funciones clave para el protocolo de sum-check, incluyendo la construcción
 * tabular de g a partir de la contraseña, la generación de mensajes por ronda y el plegado de
 * evaluaciones en las rondas.
 *************************************************************************************************/

import { add, mul, sub, sumField, toField } from './field.js';
import { traceSync, vectorSummary } from './trace.js';

/**
 * Construye un vector de evaluaciones a partir de una secuencia de bits y un vector de pesos.
 * Cada evaluación g_i se calcula como b_i * weights_i, donde b_i es el bit i-ésimo de la
 * contraseña y weights_i es el peso público correspondiente.
 *
 * Esta tabla representa los valores de g sobre el hipercubo booleano. El protocolo trabaja
 * implícitamente con la extensión multilineal asociada para evaluar en puntos de F_p.
 * @param {Array<bigint>} bits
 * @param {Array<bigint>} weights
 * @returns {Array<bigint>}
 */
export function buildEvaluationsFromBits(bits, weights) {
    return traceSync(
        'protocol',
        'buildEvaluationsFromBits',
        {
            bits: vectorSummary(bits),
            weights: vectorSummary(weights),
        },
        () => {
            if (bits.length !== weights.length) {
                throw new Error('El número de bits y de pesos debe coincidir');
            }

            return bits.map((bit, index) => mul(bit, weights[index]));
        },
        'flow'
    );
}

/**
 * Construye el polinomio de una ronda a partir de las evaluaciones actuales.
 * El mensaje de ronda del prover incluye:
 * - left  = g_j(0) = suma de las evaluaciones correspondientes a x_j=0
 * - right = g_j(1) = suma de las evaluaciones correspondientes a x_j=1
 *
 * También se exponen los coeficientes a0 y a1 para trazabilidad y debug, aunque el protocolo solo
 * requiere left y right.
 * @param {Array<bigint>} evaluations
 * @returns {Object}
 */
export function buildRoundPolynomial(evaluations) {
    return traceSync(
        'protocol',
        'buildRoundPolynomial',
        {
            evaluations: vectorSummary(evaluations),
        },
        () => {
            if (evaluations.length % 2 !== 0) {
                throw new Error(
                    'El vector de evaluaciones debe tener longitud par'
                );
            }

            const half = evaluations.length / 2;
            const left = sumField(evaluations.slice(0, half));
            const right = sumField(evaluations.slice(half));

            return {
                left,
                right,
                a0: left,
                a1: sub(right, left),
            };
        },
        'flow'
    );
}

/**
 * Plega las evaluaciones en una ronda utilizando el reto proporcionado.
 * La nueva tabla de evaluaciones g_{j+1} se calcula como:
 *      g_{j+1}(...) = (1-r_j) * g_j(...,0,...) + r_j * g_j(...,1,...)
 *
 * El vector de evaluaciones se reduce a la mitad en cada ronda, avanzando hacia la evaluación
 * final g(r1,...,rv) en los elementos de F_p usados como retos del verificador.
 * @param {Array<bigint>} evaluations
 * @param {bigint|number|string} challenge
 * @returns {Array<bigint>}
 */
export function foldEvaluations(evaluations, challenge) {
    return traceSync(
        'protocol',
        'foldEvaluations',
        {
            evaluations: vectorSummary(evaluations),
            challenge,
        },
        () => {
            if (evaluations.length % 2 !== 0) {
                throw new Error(
                    'El vector de evaluaciones debe tener longitud par'
                );
            }

            const half = evaluations.length / 2;
            const folded = [];
            const r = toField(challenge);
            const oneMinusR = sub(1n, r);

            for (let index = 0; index < half; index += 1) {
                const left = toField(evaluations[index]);
                const right = toField(evaluations[index + half]);
                folded.push(add(mul(left, oneMinusR), mul(right, r)));
            }

            return folded;
        },
        'flow'
    );
}
