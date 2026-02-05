const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const sevenBin = require('7zip-bin');

const CACHE_ROOT = path.resolve(__dirname, '../.cache');
const VERSION = '2.6.0';
const TOOL_NAME = `winCodeSign-${VERSION}`;
const DOWNLOAD_URL = `https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-${VERSION}/${TOOL_NAME}.7z`;
const ARCHIVE_PATH = path.join(CACHE_ROOT, `${TOOL_NAME}.7z`);
const EXTRACT_PATH = path.join(CACHE_ROOT, TOOL_NAME);

if (!fs.existsSync(CACHE_ROOT)) {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
}

console.log(`Downloading ${DOWNLOAD_URL}...`);

function downloadFile(url, destPath, callback) {
    const file = fs.createWriteStream(destPath);
    https.get(url, function(response) {
        if (response.statusCode === 302 || response.statusCode === 301) {
            console.log(`Redirecting to ${response.headers.location}...`);
            file.close();
            downloadFile(response.headers.location, destPath, callback);
            return;
        }
        
        if (response.statusCode !== 200) {
            console.error(`Failed to download: ${response.statusCode}`);
            file.close();
            fs.unlink(destPath, () => {});
            process.exit(1);
        }

        response.pipe(file);
        file.on('finish', function() {
            file.close(callback);
        });
    }).on('error', function(err) {
        fs.unlink(destPath, () => {});
        console.error('Error downloading:', err);
        process.exit(1);
    });
}

downloadFile(DOWNLOAD_URL, ARCHIVE_PATH, extract);

function extract() {
    // List content to check for top-level folder
    const listArgs = ['l', ARCHIVE_PATH];
    execFile(sevenBin.path7za, listArgs, (error, stdout, stderr) => {
        let useRoot = false;
        if (!error && stdout) {
             if (stdout.includes('winCodeSign-2.6.0' + path.sep) || stdout.includes('winCodeSign-2.6.0/')) {
                 console.log('Detected top-level folder in archive.');
                 useRoot = true;
             }
        }
        
        const targetDir = useRoot ? CACHE_ROOT : EXTRACT_PATH;
        console.log(`Extracting to ${targetDir}...`);
        
        const args = ['x', ARCHIVE_PATH, `-o${targetDir}`, '-y'];
        console.log(`Running: ${sevenBin.path7za} ${args.join(' ')}`);
        
        execFile(sevenBin.path7za, args, (error, stdout, stderr) => {
            if (error) {
                console.error('Extraction error (might be ignored if just symlinks):', error);
            } else {
                console.log('Extraction complete!');
            }
        });
    });
}
