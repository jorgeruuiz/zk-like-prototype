/**************************************************************************************************
 * @file polynomial-commitment.js
 * @author  Jorge Ruiz González (826685)
 * @date    16/06/2026
 * @description
 * Compromiso polinomial didáctico inspirado en la identidad de apertura de KZG sobre F_p.
 *
 * IMPORTANTE: esta construcción NO es criptográficamente segura. Sirve para ilustrar la estructura:
 *
 *   Setup  -> tau de demostración cargado desde trusted-setup.json
 *   Commit -> C_f = f(tau)
 *   Open   -> y=f(z), pi=q(tau)
 *   Verify -> C_f-y = (tau-z)pi
 *
 * En un KZG real, tau no sería público ni conocido por las partes. Se publicaría una SRS con
 * potencias codificadas de tau en un grupo criptográfico.
 *************************************************************************************************/

import { add, mul, sub, toField } from './field.js';
import { traceSync, vectorSummary } from './trace.js';

/** Tau de respaldo para la demo si no se carga trusted-setup.json. */
export const DEFAULT_DEMO_TAU = 17n;

/**
 * Tau didáctico actualmente activo.
 * ATENCIÓN: este valor es público en el prototipo, por lo que NO ofrece seguridad real.
 */
let demoTau = DEFAULT_DEMO_TAU;

/**
 * Actualiza el valor didáctico de tau usado por la capa polinomial.
 * En esta demostración tau es público, por lo que la construcción no es segura criptográficamente.
 * @param {bigint|number|string} value
 * @returns {void}
 */
export function setDemoTau(value) {
    return traceSync(
        'polynomial-commitment',
        'setDemoTau',
        { value },
        () => {
            const next = toField(value);
            if (next === 0n) {
                throw new Error('tau no puede ser cero');
            }
            demoTau = next;
        },
        'flow'
    );
}

/**
 * Devuelve el tau didáctico activo.
 * @returns {bigint}
 */
export function getDemoTau() {
    return traceSync(
        'polynomial-commitment',
        'getDemoTau',
        undefined,
        () => demoTau,
        'flow'
    );
}

/**
 * Construye una representación univariante de la tabla:
 *
 *   f(X) = g_0 + g_1 X + ... + g_{N-1} X^{N-1}
 *
 * Esta representación es didáctica y se usa para ilustrar Commit/Open/Verify.
 *
 * @param {Array<bigint|number|string>} evaluations Tabla inicial g_i.
 * @returns {bigint[]} Coeficientes del polinomio f(X).
 */
export function evaluationsToPolynomialCoefficients(evaluations) {
    return traceSync(
        'polynomial-commitment',
        'evaluationsToPolynomialCoefficients',
        {
            evaluations: vectorSummary(evaluations),
        },
        () => evaluations.map((value) => toField(value)),
        'flow'
    );
}

/**
 * Evalúa un polinomio en forma de coeficientes mediante el método de Horner.
 * @param {Array<bigint|number|string>} coefficients
 * @param {bigint|number|string} point
 * @returns {bigint}
 */
export function evaluatePolynomial(coefficients, point) {
    return traceSync(
        'polynomial-commitment',
        'evaluatePolynomial',
        {
            coefficients: vectorSummary(coefficients),
            point,
        },
        () => {
            const x = toField(point);
            let result = 0n;

            for (let i = coefficients.length - 1; i >= 0; i -= 1) {
                result = add(mul(result, x), coefficients[i]);
            }

            return result;
        },
        'flow'
    );
}

/**
 * Calcula q(X) = (f(X)-y)/(X-z) mediante división sintética.
 *
 * @param {Array<bigint|number|string>} coefficients Coeficientes de f(X).
 * @param {bigint|number|string} z Punto de apertura.
 * @param {bigint|number|string} y Valor f(z).
 * @returns {bigint[]} Coeficientes del cociente q(X).
 */
export function quotientByLinearFactor(coefficients, z, y) {
    return traceSync(
        'polynomial-commitment',
        'quotientByLinearFactor',
        {
            coefficients: vectorSummary(coefficients),
            z,
            y,
        },
        () => {
            if (coefficients.length < 2) {
                return [0n];
            }

            const point = toField(z);
            const value = toField(y);
            const degree = coefficients.length - 1;
            const quotient = new Array(degree);

            quotient[degree - 1] = toField(coefficients[degree]);

            for (let i = degree - 2; i >= 0; i -= 1) {
                quotient[i] = add(
                    coefficients[i + 1],
                    mul(point, quotient[i + 1])
                );
            }

            const remainder = add(coefficients[0], mul(point, quotient[0]));

            if (remainder !== value) {
                throw new Error(
                    'La división no es exacta: y no coincide con f(z)'
                );
            }

            return quotient;
        },
        'flow'
    );
}

/**
 * Calcula el compromiso didáctico C_f=f(tau).
 *
 * @param {Array<bigint|number|string>} coefficients Coeficientes de f(X).
 * @returns {bigint} Compromiso polinomial didáctico.
 */
export function commitPolynomial(coefficients) {
    return traceSync(
        'polynomial-commitment',
        'commitPolynomial',
        {
            coefficients: vectorSummary(coefficients),
        },
        () => evaluatePolynomial(coefficients, demoTau),
        'flow'
    );
}

/**
 * Construye una apertura didáctica en el punto indicado.
 * El punto z no puede coincidir con tau porque invalidaría la identidad de apertura.
 * @param {Array<bigint|number|string>} coefficients
 * @param {bigint|number|string} point
 * @returns {{point: bigint, value: bigint, proof: bigint}}
 */
export function openPolynomial(coefficients, point) {
    return traceSync(
        'polynomial-commitment',
        'openPolynomial',
        {
            coefficients: vectorSummary(coefficients),
            point,
        },
        () => {
            const z = toField(point);

            if (z === demoTau) {
                throw new Error(
                    'El punto de apertura no puede coincidir con tau'
                );
            }

            const value = evaluatePolynomial(coefficients, z);
            const quotient = quotientByLinearFactor(coefficients, z, value);
            const proof = evaluatePolynomial(quotient, demoTau);

            return {
                point: z,
                value,
                proof,
            };
        },
        'flow'
    );
}

/**
 * Verifica una apertura didáctica mediante la identidad C_f-y = (tau-z)pi.
 *
 * @param {Object} params Apertura a verificar.
 * @param {bigint|number|string} params.commitment Compromiso C_f=f(tau) almacenado.
 * @param {bigint|number|string} params.point Punto z de apertura.
 * @param {bigint|number|string} params.value Valor y=f(z) declarado.
 * @param {bigint|number|string} params.proof Prueba pi=q(tau).
 * @returns {boolean} true si la apertura es coherente con el compromiso.
 */
export function verifyPolynomialOpening({ commitment, point, value, proof }) {
    return traceSync(
        'polynomial-commitment',
        'verifyPolynomialOpening',
        {
            commitment,
            point,
            value,
            proof,
        },
        () => {
            const z = toField(point);

            if (z === demoTau) {
                return false;
            }

            const left = sub(commitment, value);
            const right = mul(sub(demoTau, z), proof);

            return left === right;
        },
        'flow'
    );
}
