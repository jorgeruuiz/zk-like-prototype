import { readdirSync, statSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const SOURCE_DIRECTORIES = [
    'server',
    'database',
    'public',
    'sum-check-protocol',
    'scripts',
];

function collectJavaScriptFiles(directory) {
    return readdirSync(directory)
        .sort()
        .flatMap((entry) => {
            const filePath = path.join(directory, entry);
            if (statSync(filePath).isDirectory()) {
                return collectJavaScriptFiles(filePath);
            }
            return filePath.endsWith('.js') ? [filePath] : [];
        });
}

const files = SOURCE_DIRECTORIES.flatMap(collectJavaScriptFiles);
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

console.log(`Sintaxis JavaScript correcta en ${files.length} ficheros.`);
