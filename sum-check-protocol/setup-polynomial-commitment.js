/**
 * @file setup-polynomial-commitment.js
 * @author  Jorge Ruiz González (826685)
 * @date    16/06/2026
 * @description
 * Genera un trusted setup didáctico para la capa de compromiso polinomial.
 * IMPORTANTE: tau se guarda en claro y se publica; esto no ofrece seguridad criptografica real.
 */

import crypto from 'crypto';
import fs from 'fs';
import { FIELD_PRIME, toField } from './field.js';
import { traceSync } from './trace.js';

const SETUP_PATH = './sum-check-protocol/trusted-setup.json';

/**
 * Genera un elemento aleatorio no nulo del campo finito F_p.
 * @returns {bigint}
 */
function randomFieldElement() {
    return traceSync(
        'setup-polynomial-commitment',
        'randomFieldElement',
        undefined,
        () => {
            let value = 0n;

            while (value === 0n) {
                const bytes = crypto.randomBytes(32);
                value = toField(BigInt('0x' + bytes.toString('hex')));
            }

            return value;
        },
        'flow'
    );
}

if (fs.existsSync(SETUP_PATH)) {
    // Regenerar el setup invalida poly_commitment ya registrados porque dependen de tau.
    console.warn(
        '[POLY-SETUP] WARNING: existing trusted-setup.json will be overwritten.'
    );
    console.warn(
        '[POLY-SETUP] WARNING: registered users with poly_commitment may become incompatible.'
    );
    console.warn(
        '[POLY-SETUP] WARNING: after regenerating tau, users must be registered again ' +
            'or their poly_commitment must be recomputed.'
    );
}

const tau = randomFieldElement();

/**
 * Estructura didáctica de trusted setup que se serializa en disco.
 * En un KZG real, tau no se publicaria de esta manera.
 */
const setup = {
    scheme: 'educational-kzg-like',
    fieldPrime: FIELD_PRIME.toString(),
    maxDegree: 4096,
    tau: tau.toString(),
    warning:
        'Educational setup only. Tau is public/stored in this prototype and therefore this is not' +
        ' cryptographically secure. Regenerating this file invalidates existing poly_commitments.',
};

traceSync(
    'setup-polynomial-commitment',
    'writeTrustedSetup',
    { SETUP_PATH },
    () => {
        fs.writeFileSync(SETUP_PATH, JSON.stringify(setup, null, 2), 'utf8');
    },
    'flow'
);

// La salida es deliberadamente explícita para facilitar demo, memoria y depuración.
console.log('[POLY-SETUP] Educational trusted setup generated.');
console.log(`[POLY-SETUP] tau=${setup.tau}`);
console.log(
    '[POLY-SETUP] WARNING: tau is public; not cryptographically secure.'
);
console.log(
    '[POLY-SETUP] WARNING: existing users with poly_commitment must be re-registered.'
);
