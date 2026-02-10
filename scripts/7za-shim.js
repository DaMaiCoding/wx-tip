const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const logFile = path.resolve(__dirname, '../7za-shim.log');
function log(msg) {
    fs.appendFileSync(logFile, msg + '\n');
}

log(`[${new Date().toISOString()}] Shim started`);
log(`Args: ${JSON.stringify(process.argv)}`);

// Find the original 7za executable
let path7za;
try {
    const pkgPath = require.resolve('7zip-bin');
    const pkgDir = path.dirname(pkgPath);
    path7za = path.join(pkgDir, 'win', 'x64', '7za.exe');
} catch (e) {
    log(`Error resolving 7zip-bin: ${e.message}`);
    console.error('[Shim] Could not resolve 7zip-bin:', e);
    process.exit(1);
}

log(`Using original 7za: ${path7za}`);

// Remove -snld from arguments
const args = process.argv.slice(2);
const filteredArgs = args.filter(arg => arg !== '-snld');

if (args.length !== filteredArgs.length) {
    log('Removed -snld');
    filteredArgs.push('-xr!darwin');
    filteredArgs.push('-xr!linux');
    filteredArgs.push('-xr!*.dylib');
    filteredArgs.push('-xr!*.so');
}

log(`Filtered Args: ${JSON.stringify(filteredArgs)}`);

const child = spawn(path7za, filteredArgs, {
    stdio: 'inherit'
});

child.on('close', (code) => {
    log(`Exited with code ${code}`);
    process.exit(code);
});

child.on('error', (err) => {
    log(`Spawn error: ${err.message}`);
    console.error('[Shim] Failed to start 7za:', err);
    process.exit(1);
});
