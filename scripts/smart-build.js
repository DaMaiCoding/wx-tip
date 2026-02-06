const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const DIST_DIR = 'dist';
const PROCESSES_TO_KILL = ['wxTip.exe', 'electron.exe', 'app-builder.exe'];

// 1. Kill Processes
console.log('--- [SmartBuild] Killing lingering processes ---');
PROCESSES_TO_KILL.forEach(proc => {
    try {
        // /F: Forcefully terminate the process
        // /IM: Image Name
        // /T: Terminates child processes as well
        execSync(`taskkill /F /IM ${proc} /T`, { stdio: 'ignore' });
        console.log(`Killed ${proc}`);
    } catch (e) {
        // Process not found or access denied
    }
});

// Give OS a moment to release file handles
const start = Date.now();
while (Date.now() - start < 1000) {}

// 2. Prepare Output Directory
console.log(`--- [SmartBuild] Preparing '${DIST_DIR}' directory ---`);
const distPath = path.join(__dirname, '..', DIST_DIR);

if (fs.existsSync(distPath)) {
    try {
        console.log(`Attempting to clean ${DIST_DIR}...`);
        fs.rmSync(distPath, { recursive: true, force: true });
        console.log(`${DIST_DIR} cleaned successfully.`);
    } catch (e) {
        console.warn(`${DIST_DIR} is locked or cannot be deleted. Attempting to move it aside...`);
        try {
            const trashPath = path.join(__dirname, '..', `${DIST_DIR}_trash_${Date.now()}`);
            fs.renameSync(distPath, trashPath);
            console.log(`Moved locked ${DIST_DIR} to ${trashPath}. You can delete it later.`);
            
            // Try to delete the trash immediately (async-ish, don't block build if fails)
            try {
                fs.rmSync(trashPath, { recursive: true, force: true });
            } catch (ignore) {
                console.warn(`Could not fully delete trash directory yet. Windows might still be holding it.`);
            }
            
        } catch (renameError) {
            console.error(`[SmartBuild] CRITICAL: Could not delete OR rename '${DIST_DIR}'.`);
            console.error(`Please manually close any programs using this folder (VS Code, Explorer, etc.) and try again.`);
            process.exit(1);
        }
    }
}

// 3. Run the Build Command
console.log('--- [SmartBuild] Starting Build ---');

// Define cache directory
const cacheDir = path.resolve(__dirname, '../.cache') + path.sep;
console.log(`Setting ELECTRON_BUILDER_CACHE to: ${cacheDir}`);

// We execute electron-builder directly.
// In npm scripts, node_modules/.bin is added to PATH, so 'electron-builder' works.
const buildCommand = `electron-builder --win --config electron-builder.config.js --publish never`;

// Ensure we use 'dist' as output and set cache/mirrors
const env = { 
    ...process.env, 
    BUILD_OUTPUT_DIR: DIST_DIR,
    ELECTRON_BUILDER_CACHE: cacheDir,
    CSC_SKIP: 'true',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/'
};

// Execute
const child = spawn('cmd', ['/c', buildCommand], {
    env: env,
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
});

child.on('close', (code) => {
    if (code === 0) {
        console.log(`\n[SmartBuild] SUCCESS! Artifacts are in: ${DIST_DIR}`);
    } else {
        console.error(`\n[SmartBuild] Build failed with code ${code}`);
    }
    process.exit(code);
});
