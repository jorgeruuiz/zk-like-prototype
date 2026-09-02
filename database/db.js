/**************************************************************************************************
 * @file    db.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Configuración del pool de conexiones PostgreSQL usado por el servidor Express.
 *************************************************************************************************/

import pg from 'pg';
import dotenv from 'dotenv';

// ------------------------------------------------------------------------------------------------
// Carga opcional de .env para la ejecución local.
// En Docker, Compose inyecta estas variables directamente en process.env.
// ------------------------------------------------------------------------------------------------
dotenv.config();

// ------------------------------------------------------------------------------------------------
// Validacion minima de configuracion requerida.
// ------------------------------------------------------------------------------------------------
const dbName = process.env.DB_NAME;
if (!dbName) {
    throw new Error('DB_NAME no esta definido en el entorno');
}

// ------------------------------------------------------------------------------------------------
// Pool de conexiones reutilizable para todas las rutas del servidor.
// ------------------------------------------------------------------------------------------------
const pool = new pg.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    database: dbName,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
});

/**
 * Comprueba que PostgreSQL acepta consultas.
 *
 * @returns {Promise<void>}
 */
async function checkDatabaseConnection() {
    await pool.query('SELECT 1');
}

export { checkDatabaseConnection, pool };
