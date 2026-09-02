/**************************************************************************************************
 * @file    field.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Implementación de operaciones en un campo finito de gran orden para el protocolo de sum-check.
 * Este módulo se usa tanto en el servidor (verifier) como en el navegador (prover) para mantener
 * coherencia algebraica en todas las operaciones del protocolo.
 *************************************************************************************************/

import { traceSync, vectorSummary } from './trace.js';

// Número primo grande para definir el campo finito F_p.
// Primo de 64 bits usado para el campo de trabajo del prototipo.
export const FIELD_PRIME = 18446744073709551557n;
export const DEFAULT_PASSWORD_BYTES = 8;

/**
 * Función de normalización modular para asegurar que los resultados siempre estén en el rango
 * [0, FIELD_PRIME - 1]. Esto es crucial para mantener la coherencia algebraica en el protocolo.
 * @param {bigint} value
 * @returns {bigint}
 */
export function mod(value) {
    return traceSync(
        'field',
        'mod',
        { type: typeof value },
        () => {
            const normalized = value % FIELD_PRIME;
            return normalized >= 0n ? normalized : normalized + FIELD_PRIME;
        },
        'verbose'
    );
}

/**
 * Convierte un valor a un elemento del campo finito para asegurar que todas las operaciones
 * se realicen dentro del mismo marco algebraico.
 * @param {bigint|number|string} value
 * @returns {bigint}
 */
export function toField(value) {
    return traceSync(
        'field',
        'toField',
        { type: typeof value },
        () => {
            if (typeof value === 'bigint') {
                return mod(value);
            }

            if (typeof value === 'number') {
                return mod(BigInt(value));
            }

            if (typeof value === 'string') {
                return mod(BigInt(value));
            }

            throw new TypeError(
                'No se puede convertir el valor al campo finito'
            );
        },
        'verbose'
    );
}

// ------------------------------------------------------------------------------------------------
// OPERACIONES ARITMÉTICAS EN F_p
// ------------------------------------------------------------------------------------------------

/**
 * Realiza la suma de dos elementos en el campo finito F_p.
 * @param {bigint|number|string} a
 * @param {bigint|number|string} b
 * @returns {bigint}
 */
export function add(a, b) {
    return traceSync(
        'field',
        'add',
        undefined,
        () => mod(toField(a) + toField(b)),
        'verbose'
    );
}

/**
 * Realiza la resta de dos elementos en el campo finito F_p.
 * @param {bigint|number|string} a
 * @param {bigint|number|string} b
 * @returns {bigint}
 */
export function sub(a, b) {
    return traceSync(
        'field',
        'sub',
        undefined,
        () => mod(toField(a) - toField(b)),
        'verbose'
    );
}

/**
 * Realiza la multiplicación de dos elementos en el campo finito F_p.
 * @param {bigint|number|string} a
 * @param {bigint|number|string} b
 * @returns {bigint}
 */
export function mul(a, b) {
    return traceSync(
        'field',
        'mul',
        undefined,
        () => mod(toField(a) * toField(b)),
        'verbose'
    );
}

/**
 * Realiza la suma de una lista de elementos en el campo finito F_p.
 * @param {Array<bigint|number|string>} values
 * @returns {bigint}
 */
export function sumField(values) {
    return traceSync(
        'field',
        'sumField',
        { values: vectorSummary(values) },
        () =>
            values.reduce((accumulator, value) => add(accumulator, value), 0n),
        'flow'
    );
}

// ------------------------------------------------------------------------------------------------
// FUNCIONES DE CONVERSIÓN Y SERIALIZACIÓN DE VECTORES
// ------------------------------------------------------------------------------------------------

/**
 * Serializa un vector de valores como cadenas decimales normalizadas en el campo finito.
 * @param {Array<bigint|number|string>} values
 * @returns {Array<string>}
 */
export function serializeVector(values) {
    return traceSync(
        'field',
        'serializeVector',
        { values: vectorSummary(values) },
        () => values.map((value) => toField(value).toString()),
        'flow'
    );
}

/**
 * Convierte un vector recibido desde JSON a elementos del campo finito.
 * @param {Array<bigint|number|string>} values
 * @param {string} label
 * @returns {Array<bigint>}
 */
export function parseVector(values, label = 'vector') {
    return traceSync(
        'field',
        'parseVector',
        { label, values: vectorSummary(values) },
        () => {
            if (!Array.isArray(values)) {
                throw new Error(`${label} debe ser un array`);
            }
            return values.map((value) => toField(value));
        },
        'flow'
    );
}

// ------------------------------------------------------------------------------------------------
// TRANSFORMACIONES PARA EL PROTOCOLO DE SUM-CHECK (PARSEO DE CONTRASEÑA, PLEGADO DE EVALUACIONES,
// ETC.)
// ------------------------------------------------------------------------------------------------

/**
 * Convierte una contraseña a una secuencia de bytes de longitud exacta.
 * @param {string} password
 * @param {number} expectedBytes
 * @returns {Uint8Array}
 */
export function passwordToExactBytes(
    password,
    expectedBytes = DEFAULT_PASSWORD_BYTES
) {
    return traceSync(
        'field',
        'passwordToExactBytes',
        { expectedBytes },
        () => {
            if (!/^[\x00-\x7F]*$/.test(password)) {
                throw new Error(
                    'La contraseña debe contener solo caracteres ASCII'
                );
            }

            const encoder = new TextEncoder();
            const bytes = encoder.encode(password);

            if (bytes.length !== expectedBytes) {
                throw new Error(
                    `La contraseña debe tener exactamente ${expectedBytes} bytes`
                );
            }

            return bytes;
        },
        'flow'
    );
}

/**
 * Convierte una secuencia de bytes a bits big-endian.
 * @param {Uint8Array} bytes
 * @returns {Array<bigint>}
 */
export function bytesToBits(bytes) {
    return traceSync(
        'field',
        'bytesToBits',
        { byteLength: bytes.length },
        () => {
            const bits = [];

            for (const byte of bytes) {
                for (let bit = 7; bit >= 0; bit -= 1) {
                    bits.push(BigInt((byte >> bit) & 1));
                }
            }

            return bits;
        },
        'flow'
    );
}

/**
 * Wrapper que convierte una contraseña a su representación en bits para el protocolo de sum-check.
 * Internamente convierte a bytes y luego a bits, asegurando la longitud correcta.
 * @param {string} password
 * @param {number} expectedBytes
 * @return {Array<bigint>}
 */
export function passwordToBits(
    password,
    expectedBytes = DEFAULT_PASSWORD_BYTES
) {
    return traceSync(
        'field',
        'passwordToBits',
        { expectedBytes },
        () => bytesToBits(passwordToExactBytes(password, expectedBytes)),
        'flow'
    );
}
