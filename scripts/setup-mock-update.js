const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const MOCK_DIR = path.join(__dirname, '../mock-update');
const PORT = 8089;
const FILE_NAME = 'wxTip-Setup-99.0.0.exe';

// Ensure mock directory exists
if (!fs.existsSync(MOCK_DIR)) {
    fs.mkdirSync(MOCK_DIR);
}

// 1. Create a dummy exe file (5MB to allow progress visualization)
const filePath = path.join(MOCK_DIR, FILE_NAME);
console.log('Generating dummy update file...');
const buffer = Buffer.alloc(5 * 1024 * 1024); // 5MB
for (let i = 0; i < buffer.length; i++) {
    buffer[i] = i % 256;
}
fs.writeFileSync(filePath, buffer);

// 2. Calculate SHA512
console.log('Calculating SHA512...');
const fileBuffer = fs.readFileSync(filePath);
const hashSum = crypto.createHash('sha512');
hashSum.update(fileBuffer);
const sha512 = hashSum.digest('base64');

// 3. Generate latest.yml
const ymlContent = `version: 99.0.0
files:
  - url: ${FILE_NAME}
    sha512: ${sha512}
    size: ${fileBuffer.length}
path: ${FILE_NAME}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'`;

fs.writeFileSync(path.join(MOCK_DIR, 'latest.yml'), ymlContent);
console.log('latest.yml generated.');

// 4. Create dev-app-update.yml for electron-updater
const devUpdateConfig = `provider: generic
url: http://127.0.0.1:${PORT}/
updaterCacheDirName: wxTip-updater`;

fs.writeFileSync(path.join(__dirname, '../dev-app-update.yml'), devUpdateConfig);
console.log('dev-app-update.yml generated.');

// 5. Start Server
const app = express();
app.use(express.static(MOCK_DIR));

app.listen(PORT, () => {
    console.log(`Update server running at http://127.0.0.1:${PORT}`);
    console.log('Ready for test. Keep this script running.');
});
