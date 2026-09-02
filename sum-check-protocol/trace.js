/**************************************************************************************************
 * @file    trace.js
 * @author  Jorge Ruiz González (826685)
 * @date    18/06/2026
 * @description
 * Logger de trazas activable para reconstruir flujos de ejecución y diagramas de secuencia.
 *
 * Activación en servidor:
 *   ZKP_TRACE=1 npm start
 *   ZKP_TRACE=1 ZKP_TRACE_LEVEL=verbose npm start
 *
 * Activación en navegador, desde la consola:
 *   localStorage.setItem('ZKP_TRACE', '1'); location.reload();
 *   localStorage.setItem('ZKP_TRACE_LEVEL', 'verbose'); location.reload();
 *
 * Desactivación en navegador:
 *   localStorage.removeItem('ZKP_TRACE'); localStorage.removeItem('ZKP_TRACE_LEVEL'); location.reload();
 *************************************************************************************************/

const DEFAULT_LEVEL = 'flow';
let traceCounter = 0;
let traceDepth = 0;
let manualEnabled = null;
let manualLevel = null;

function hasProcessEnv() {
    return typeof process !== 'undefined' && Boolean(process.env);
}

function hasLocalStorage() {
    try {
        return (
            typeof globalThis !== 'undefined' &&
            Boolean(globalThis.localStorage)
        );
    } catch {
        return false;
    }
}

function readTraceFlag() {
    if (manualEnabled !== null) {
        return manualEnabled;
    }

    if (hasProcessEnv()) {
        const raw = process.env.ZKP_TRACE;
        return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
    }

    if (hasLocalStorage()) {
        const raw = globalThis.localStorage.getItem('ZKP_TRACE');
        return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
    }

    return false;
}

function readTraceLevel() {
    if (manualLevel) {
        return manualLevel;
    }

    if (hasProcessEnv() && process.env.ZKP_TRACE_LEVEL) {
        return String(process.env.ZKP_TRACE_LEVEL).toLowerCase();
    }

    if (hasLocalStorage()) {
        const raw = globalThis.localStorage.getItem('ZKP_TRACE_LEVEL');
        if (raw) {
            return String(raw).toLowerCase();
        }
    }

    return DEFAULT_LEVEL;
}

function isVerboseLevel() {
    const level = readTraceLevel();
    return level === 'verbose' || level === 'debug' || level === 'all';
}

function shouldTrace(level = 'flow') {
    if (!readTraceFlag()) {
        return false;
    }
    if (level === 'verbose') {
        return isVerboseLevel();
    }
    return true;
}

function sanitizeValue(value, depth = 0) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'string'
    ) {
        if (typeof value === 'string' && value.length > 120) {
            return `${value.slice(0, 117)}...`;
        }
        return value;
    }
    if (Array.isArray(value)) {
        const head = value
            .slice(0, 4)
            .map((item) => sanitizeValue(item, depth + 1));
        if (value.length > 4) {
            head.push(`... len=${value.length}`);
        }
        return head;
    }
    if (typeof value === 'object') {
        if (depth >= 2) {
            return '[Object]';
        }
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            if (/password|secret|token|cookie/i.test(key)) {
                output[key] = '[REDACTED]';
            } else {
                output[key] = sanitizeValue(item, depth + 1);
            }
        }
        return output;
    }
    return String(value);
}

function detailsToText(details) {
    if (details === undefined || details === null) {
        return '';
    }
    try {
        const sanitized = sanitizeValue(details);
        if (sanitized === undefined) {
            return '';
        }
        return ` ${JSON.stringify(sanitized)}`;
    } catch {
        return ` ${String(details)}`;
    }
}

function indent() {
    return '  '.repeat(Math.max(0, traceDepth));
}

function nowMs() {
    if (
        typeof performance !== 'undefined' &&
        typeof performance.now === 'function'
    ) {
        return performance.now();
    }
    return Date.now();
}

export function setTraceEnabled(enabled, level = DEFAULT_LEVEL) {
    manualEnabled = Boolean(enabled);
    manualLevel = level;
}

export function isTraceEnabled(level = 'flow') {
    return shouldTrace(level);
}

export function traceEnter(
    scope,
    functionName,
    details = undefined,
    level = 'flow'
) {
    if (!shouldTrace(level)) {
        return null;
    }

    const context = {
        id: ++traceCounter,
        scope,
        functionName,
        level,
        startedAt: nowMs(),
    };

    console.log(
        `[TRACE ${String(context.id).padStart(4, '0')}] ${indent()}-> ` +
            `${scope}.${functionName}${detailsToText(details)}`
    );
    traceDepth += 1;
    return context;
}

export function traceExit(context, details = undefined) {
    if (!context) {
        return;
    }

    traceDepth = Math.max(0, traceDepth - 1);
    const elapsed = Math.round((nowMs() - context.startedAt) * 100) / 100;
    console.log(
        `[TRACE ${String(context.id).padStart(4, '0')}] ${indent()}<- ` +
            `${context.scope}.${context.functionName} (${elapsed} ms)${detailsToText(details)}`
    );
}

export function traceError(context, error) {
    if (!context) {
        return;
    }

    traceDepth = Math.max(0, traceDepth - 1);
    const elapsed = Math.round((nowMs() - context.startedAt) * 100) / 100;
    const message = error && error.message ? error.message : String(error);
    console.log(
        `[TRACE ${String(context.id).padStart(4, '0')}] ${indent()}xx ` +
            `${context.scope}.${context.functionName} (${elapsed} ms) error=${message}`
    );
}

export function traceStep(scope, message, details = undefined, level = 'flow') {
    if (!shouldTrace(level)) {
        return;
    }
    console.log(
        `[TRACE ----] ${indent()}.. ${scope}.${message}${detailsToText(details)}`
    );
}

export function traceSync(
    scope,
    functionName,
    details,
    callback,
    level = 'flow'
) {
    const context = traceEnter(scope, functionName, details, level);
    try {
        const result = callback();
        traceExit(context);
        return result;
    } catch (error) {
        traceError(context, error);
        throw error;
    }
}

export async function traceAsync(
    scope,
    functionName,
    details,
    callback,
    level = 'flow'
) {
    const context = traceEnter(scope, functionName, details, level);
    try {
        const result = await callback();
        traceExit(context);
        return result;
    } catch (error) {
        traceError(context, error);
        throw error;
    }
}

export function vectorSummary(values) {
    if (!Array.isArray(values)) {
        return values;
    }
    return {
        length: values.length,
        head: values
            .slice(0, 4)
            .map((value) =>
                typeof value === 'bigint' ? value.toString() : value
            ),
    };
}
