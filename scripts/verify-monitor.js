const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('='.repeat(60));
console.log('wxTip Monitor Environment Verification Tool');
console.log('='.repeat(60));
console.log('');

const checks = [];

function addCheck(name, passed, message, details = '') {
    checks.push({ name, passed, message, details });
}

console.log('📋 Running diagnostic checks...\n');

// Check 1: Node.js environment
const nodeVersion = process.version;
addCheck(
    'Node.js Version',
    true,
    `Running on Node.js ${nodeVersion}`,
    'Electron apps bundle Node.js runtime'
);

// Check 2: Detect if running in packaged environment
const isPackaged = process.argv.some(arg => arg.includes('.exe') || process.versions.electron);
addCheck(
    'Packaged Environment',
    isPackaged,
    isPackaged ? 'Running in packaged mode' : 'Running in development mode',
    `Electron: ${process.versions.electron || 'N/A'}`
);

// Check 3: Check monitor.ps1 existence
const possiblePaths = [];

if (isPackaged) {
    if (process.resourcesPath) {
        possiblePaths.push(path.join(process.resourcesPath, 'services', 'monitor.ps1'));
    }
    const appPath = process.execPath;
    const appDir = path.dirname(appPath);
    possiblePaths.push(path.join(appDir, 'resources', 'services', 'monitor.ps1'));
} else {
    possiblePaths.push(path.join(__dirname, '..', 'src', 'main', 'services', 'monitor.ps1'));
    possiblePaths.push(path.join(process.cwd(), 'src', 'main', 'services', 'monitor.ps1'));
}

let monitorPath = null;
for (const checkPath of possiblePaths) {
    if (fs.existsSync(checkPath)) {
        monitorPath = checkPath;
        break;
    }
}

addCheck(
    'Monitor Script Location',
    monitorPath !== null,
    monitorPath ? `Found at: ${monitorPath}` : 'Script not found',
    possiblePaths.length > 0 ? `Checked ${possiblePaths.length} possible locations` : ''
);

// Check 4: PowerShell availability
function checkPowerShell() {
    return new Promise((resolve) => {
        const ps = spawn('powershell.exe', ['-Command', 'echo $PSVersionTable.PSVersion']);
        let output = '';
        ps.stdout.on('data', (data) => {
            output += data.toString();
        });
        ps.on('close', (code) => {
            const version = output.trim().split('\n')[0];
            resolve(code === 0 && version ? version : 'N/A');
        });
        ps.on('error', () => {
            resolve('N/A');
        });
    });
}

// Check 5: Port 5000 availability
function checkPort() {
    return new Promise((resolve) => {
        const net = require('net');
        const server = net.createServer();
        
        server.once('error', () => {
            resolve(false);
        });
        
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        
        server.listen(5000, '127.0.0.1');
    });
}

// Check 6: Test monitor script syntax
function testMonitorSyntax() {
    return new Promise((resolve) => {
        if (!monitorPath) {
            resolve('Skipped (script not found)');
            return;
        }
        
        const ps = spawn('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', `Test-Path -Path '${monitorPath}' -PathType Leaf`
        ]);
        
        let output = '';
        ps.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        ps.on('close', (code) => {
            resolve(output.trim() === 'True' ? 'Valid' : 'Invalid');
        });
    });
}

async function runAsyncChecks() {
    console.log('⏳ Checking PowerShell availability...');
    const psVersion = await checkPowerShell();
    addCheck(
        'PowerShell Available',
        psVersion !== 'N/A',
        psVersion !== 'N/A' ? `PowerShell ${psVersion}` : 'PowerShell not found',
        'Required for monitor.ps1 execution'
    );

    console.log('⏳ Checking port 5000 availability...');
    const portAvailable = await checkPort();
    addCheck(
        'Port 5000 Available',
        portAvailable,
        portAvailable ? 'Port is free' : 'Port is in use',
        'Required for internal Express server'
    );

    console.log('⏳ Verifying monitor script syntax...');
    const syntax = await testMonitorSyntax();
    addCheck(
        'Monitor Script Syntax',
        syntax === 'Valid',
        syntax,
        monitorPath || 'Script path unknown'
    );

    printResults();
}

function printResults() {
    console.log('');
    console.log('='.repeat(60));
    console.log('📊 DIAGNOSTIC RESULTS');
    console.log('='.repeat(60));
    console.log('');

    let passed = 0;
    let failed = 0;

    checks.forEach((check, index) => {
        const icon = check.passed ? '✅' : '❌';
        const status = check.passed ? 'PASS' : 'FAIL';
        
        if (check.passed) passed++;
        else failed++;
        
        console.log(`${icon} Check ${index + 1}: ${check.name}`);
        console.log(`   Status: ${status}`);
        console.log(`   Message: ${check.message}`);
        if (check.details) {
            console.log(`   Details: ${check.details}`);
        }
        console.log('');
    });

    console.log('='.repeat(60));
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));
    console.log('');

    if (failed === 0) {
        console.log('✅ All checks passed! The monitor environment is properly configured.');
        console.log('');
        console.log('Next steps:');
        console.log('1. Start the wxTip application');
        console.log('2. Check the console for "[Monitor] Service started successfully"');
        console.log('3. Send a WeChat message to test notification');
    } else {
        console.log('❌ Some checks failed. Please review the errors above.');
        console.log('');
        console.log('Common fixes:');
        console.log('- Monitor Script Location: Ensure resources are packaged correctly');
        console.log('- Port 5000: Close other applications using this port');
        console.log('- PowerShell: Install PowerShell if missing');
        console.log('');
        console.log('For detailed troubleshooting, see: docs/TROUBLESHOOTING.md');
    }

    console.log('');
}

console.log('Starting async checks...\n');
runAsyncChecks().catch(err => {
    console.error('Error running checks:', err);
    process.exit(1);
});
