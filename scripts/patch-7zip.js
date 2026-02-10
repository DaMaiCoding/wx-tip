const fs = require('fs');
const path = require('path');

function patch7zipBin() {
    try {
        const index = require.resolve('7zip-bin');
        const shim = path.resolve(__dirname, '7za-shim.cmd');
        
        console.log(`Patching 7zip-bin at ${index} to point to ${shim}`);
        
        const content = `
var path = require('path');
// Patched by scripts/patch-7zip.js
exports.path7za = "${shim.replace(/\\/g, '\\\\')}";
`;
        fs.writeFileSync(index, content);
        console.log('Patch 7zip-bin successful');
    } catch (e) {
        console.error('Patch 7zip-bin failed:', e);
    }
}

function patchBuilderUtil() {
    try {
        // Find builder-util location. It might be nested or flat.
        // We can try to resolve it.
        // Since we are running this script, we can try require.resolve('builder-util') if available, 
        // but it might not be a direct dependency of the root project.
        // It is a dependency of electron-builder.
        
        // We can try to find it in node_modules recursively or just look at common locations.
        // Given the environment, we found it at:
        // node_modules/.pnpm/builder-util@.../node_modules/builder-util/out/util.js
        
        // Let's try to resolve it from 'electron-builder' or just search common paths.
        // Or simpler: walk node_modules to find builder-util/out/util.js
        
        // A robust way is to start from the project root and look into node_modules
        const rootDir = path.resolve(__dirname, '..');
        const searchPaths = [
            path.join(rootDir, 'node_modules', 'builder-util', 'out', 'util.js'),
            // Nested pnpm style
            ...findPnpmBuilderUtil(path.join(rootDir, 'node_modules', '.pnpm'))
        ];
        
        let patchedCount = 0;
        
        for (const utilPath of searchPaths) {
            if (fs.existsSync(utilPath)) {
                console.log(`Checking builder-util at ${utilPath}`);
                const content = fs.readFileSync(utilPath, 'utf8');
                
                // Look for execFile call
                // (0, child_process_1.execFile)(file, args, {
                // ...
                
                if (content.includes('shell: file.endsWith(".cmd")')) {
                    console.log('Already patched.');
                    continue;
                }
                
                const searchStr = `(0, child_process_1.execFile)(file, args, {`;
                const replaceStr = `(0, child_process_1.execFile)(file, args, { shell: file.endsWith(".cmd") || file.endsWith(".bat"),`;
                
                if (content.includes(searchStr)) {
                    const newContent = content.replace(searchStr, replaceStr);
                    fs.writeFileSync(utilPath, newContent);
                    console.log('Patched builder-util successfully.');
                    patchedCount++;
                }
            }
        }
        
        if (patchedCount === 0) {
            console.warn('Could not find builder-util to patch.');
        }
        
    } catch (e) {
        console.error('Patch builder-util failed:', e);
    }
}

function findPnpmBuilderUtil(pnpmDir) {
    const results = [];
    if (!fs.existsSync(pnpmDir)) return results;
    
    try {
        const dirs = fs.readdirSync(pnpmDir);
        for (const dir of dirs) {
            if (dir.startsWith('builder-util@')) {
                const utilPath = path.join(pnpmDir, dir, 'node_modules', 'builder-util', 'out', 'util.js');
                if (fs.existsSync(utilPath)) {
                    results.push(utilPath);
                }
            }
        }
    } catch (e) {}
    return results;
}

patch7zipBin();
patchBuilderUtil();
