const { execSync } = require('child_process');
const path = require('path');

const cacheDir = path.resolve(__dirname, '../.cache') + path.sep; // Ensure trailing slash
const projectDir = path.resolve(__dirname, '..');

console.log(`Setting ELECTRON_BUILDER_CACHE to: ${cacheDir}`);

// Set environment variables
process.env.ELECTRON_BUILDER_CACHE = cacheDir;
process.env.CSC_SKIP = 'true';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

// Run electron-builder
try {
    // We use pnpm to find electron-builder
    execSync('pnpm electron-builder --win --config electron-builder.config.js', {
        cwd: projectDir,
        stdio: 'inherit',
        env: process.env
    });
} catch (error) {
    console.error('Build failed.');
    process.exit(1);
}
