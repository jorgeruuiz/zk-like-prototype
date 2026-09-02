/**************************************************************************************************
 * @file    user_repository.js
 * @author  Jorge Ruiz González (826685)
 * @date    24/06/2026
 * @description
 * Repositorio de acceso a los datos de verificación de la tabla usuarios.
 *
 * Encapsula las consultas SQL y la representación persistente de los vectores. El servidor trabaja
 * con propiedades de dominio en camelCase y no necesita conocer nombres de columnas ni formatos JSON.
 *************************************************************************************************/

import { pool } from './db.js';

/**
 * Convierte un vector persistido como JSON en un array.
 *
 * @param {string} value JSON almacenado en PostgreSQL.
 * @param {string} fieldName Nombre lógico usado en mensajes de error.
 * @returns {Array<unknown>} Vector deserializado.
 */
function parseStoredVector(value, fieldName) {
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) {
            throw new Error('el valor no es un array');
        }
        return parsed;
    } catch (error) {
        throw new Error(
            `Datos persistidos inválidos en ${fieldName}: ${error.message}`
        );
    }
}

/**
 * Inserta los datos de verificación generados durante el registro.
 *
 * @param {Object} data Datos públicos y valores esperados del protocolo.
 * @param {string} data.username Nombre único de usuario.
 * @param {string|bigint|number} data.initialClaim Claim inicial de Sum-Check.
 * @param {string|bigint|number} data.interactiveFinalValue Valor g(r) interactivo.
 * @param {string|bigint|number|null} data.fiatShamirFinalValue Valor final Fiat-Shamir.
 * @param {Array<string|bigint|number>} data.weights Pesos públicos.
 * @param {Array<string|bigint|number>} data.challengePoint Punto r interactivo.
 * @param {number} data.bitLength Longitud de la tabla de evaluaciones.
 * @param {string|bigint|number|null} data.polyCommitment Compromiso polinomial opcional.
 * @returns {Promise<void>}
 */
export async function createUserVerificationData({
    username,
    initialClaim,
    interactiveFinalValue,
    fiatShamirFinalValue,
    weights,
    challengePoint,
    bitLength,
    polyCommitment,
}) {
    await pool.query(
        `
            INSERT INTO usuarios (
                username,
                "initialClaim",
                final_value,
                final_value_fs,
                weights_json,
                challenge_point_json,
                bit_length,
                poly_commitment
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
        `,
        [
            username,
            String(initialClaim),
            String(interactiveFinalValue),
            fiatShamirFinalValue !== undefined && fiatShamirFinalValue !== null
                ? String(fiatShamirFinalValue)
                : null,
            JSON.stringify(weights.map((value) => String(value))),
            JSON.stringify(challengePoint.map((value) => String(value))),
            Number(bitLength),
            polyCommitment !== undefined && polyCommitment !== null
                ? String(polyCommitment)
                : null,
        ]
    );
}

/**
 * Recupera los datos usados para una sesión Sum-Check interactiva.
 *
 * @param {string} username Nombre de usuario.
 * @returns {Promise<Object|null>} Datos de verificación o null si no existe.
 */
export async function findInteractiveVerificationData(username) {
    const result = await pool.query(
        `
            SELECT
                "initialClaim" AS "initialClaim",
                final_value AS "finalValue",
                weights_json AS "weightsJson",
                challenge_point_json AS "challengePointJson",
                bit_length AS "bitLength",
                poly_commitment AS "polyCommitment"
            FROM usuarios
            WHERE username = $1
        `,
        [username]
    );

    if (result.rows.length === 0) {
        return null;
    }

    const row = result.rows[0];
    return {
        initialClaim: row.initialClaim,
        finalValue: row.finalValue,
        weights: parseStoredVector(row.weightsJson, 'weights'),
        challengePoint: parseStoredVector(
            row.challengePointJson,
            'challengePoint'
        ),
        bitLength: Number(row.bitLength),
        polyCommitment: row.polyCommitment,
    };
}

/**
 * Recupera los datos usados para construir o verificar una prueba Fiat-Shamir.
 *
 * @param {string} username Nombre de usuario.
 * @returns {Promise<Object|null>} Datos de verificación o null si no existe.
 */
export async function findFiatShamirVerificationData(username) {
    const result = await pool.query(
        `
            SELECT
                "initialClaim" AS "initialClaim",
                final_value_fs AS "finalValue",
                weights_json AS "weightsJson",
                bit_length AS "bitLength",
                poly_commitment AS "polyCommitment"
            FROM usuarios
            WHERE username = $1
        `,
        [username]
    );

    if (result.rows.length === 0) {
        return null;
    }

    const row = result.rows[0];
    return {
        initialClaim: row.initialClaim,
        finalValue: row.finalValue,
        weights: parseStoredVector(row.weightsJson, 'weights'),
        bitLength: Number(row.bitLength),
        polyCommitment: row.polyCommitment,
    };
}
