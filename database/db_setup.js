/**************************************************************************************************
 * @file    db_setup.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Script de preparación de la base de datos. Crea o migra la tabla usuarios manteniendo compatibilidad
 * con versiones anteriores del prototipo.
 *************************************************************************************************/

import { pool } from './db.js';

// ------------------------------------------------------------------------------------------------
// Función para asegurar que la tabla 'usuarios' existe, si no, la crea.
// ------------------------------------------------------------------------------------------------
/**
 * Crea la tabla usuarios si no existe y añade las columnas que puedan faltar.
 *
 * La migración conserva initialClaim como nombre correcto del claim inicial de Sum-Check.
 * La columna antigua commitment, si existe, se usa solo para migrar datos previos.
 *
 * @returns {Promise<void>}
 */
async function ensureTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            "initialClaim" TEXT NOT NULL DEFAULT '0',
            final_value TEXT NOT NULL DEFAULT '0',
            final_value_fs TEXT,
            weights_json TEXT NOT NULL DEFAULT '[]',
            challenge_point_json TEXT NOT NULL DEFAULT '[]',
            bit_length INTEGER NOT NULL DEFAULT 64,
            poly_commitment TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await pool.query(
        'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS "initialClaim" TEXT NOT NULL DEFAULT \'0\''
    );
    await pool.query(
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS final_value TEXT NOT NULL DEFAULT '0'"
    );
    await pool.query(
        'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS final_value_fs TEXT'
    );
    await pool.query(
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS weights_json TEXT NOT NULL DEFAULT '[]'"
    );
    await pool.query(
        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS challenge_point_json TEXT NOT NULL DEFAULT '[]'"
    );
    await pool.query(
        'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bit_length INTEGER NOT NULL DEFAULT 64'
    );
    await pool.query(
        'ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS poly_commitment TEXT'
    );

    // Compatibilidad con versiones antiguas que usaban la columna commitment.
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'usuarios'
                  AND column_name = 'commitment'
            ) THEN
                EXECUTE 'UPDATE usuarios SET "initialClaim" = commitment '
                    || 'WHERE "initialClaim" = ''0'' AND commitment IS NOT NULL';
            END IF;
        END $$;
    `);

    console.log("Tabla 'usuarios' preparada correctamente en PostgreSQL.");
}

/**
 * Ejecuta la preparación de la base de datos y cierra el pool al terminar.
 *
 * @returns {Promise<void>}
 */
async function setup() {
    try {
        await ensureTable();
    } catch (err) {
        console.error('Error al crear o migrar la tabla:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

setup();
