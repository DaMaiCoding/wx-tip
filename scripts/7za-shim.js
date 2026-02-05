const { path7za } = require('7zip-bin');
const { spawn } = require('child_process');

// Remove -snld from arguments
const args = process.argv.slice(2);
const filteredArgs = args.filter(arg => arg !== '-snld');

if (args.length !== filteredArgs.length) {
    console.log('[Shim] 7za called with -snld, removing it.');
    // Add exclusions to avoid symlink errors on Windows for non-Windows files
    filteredArgs.push('-xr!darwin');
    filteredArgs.push('-xr!linux');
    console.log('[Shim] Added exclusions for darwin and linux.');
}

const child = spawn(path7za, filteredArgs, {
    stdio: 'inherit'
});

child.on('close', (code) => {
    process.exit(code);
});

child.on('error', (err) => {
    console.error('[Shim] Failed to start 7za:', err);
    process.exit(1);
});
