/**************************************************************************************************
 * @file    server.js
 * @author  Jorge Ruiz González (826685)
 * @date    08/04/2026
 * @description
 * Punto de entrada del servidor HTTP. Mantiene separado el arranque de la definición de rutas.
 *************************************************************************************************/

import app from './app.js';

// ------------------------------------------------------------------------------------------------
// Punto de entrada del servidor HTTP.
// Mantiene separado el arranque de la definicion de rutas (app.js).
// ------------------------------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;

// ------------------------------------------------------------------------------------------------
// Arranque en modo escucha.
// ------------------------------------------------------------------------------------------------
/**
 * Arranca el servidor Express en el puerto configurado.
 */
app.listen(PORT, () => {
    console.log(`Servidor ZKP corriendo en http://localhost:${PORT}`);
});
