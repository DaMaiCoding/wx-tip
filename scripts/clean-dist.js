const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', process.env.BUILD_OUTPUT_DIR || 'dist');

function cleanDist() {
  if (!fs.existsSync(distDir)) {
    console.log('dist directory not found');
    return;
  }

  const files = fs.readdirSync(distDir);
  let removedCount = 0;
  let keptCount = 0;

  files.forEach(file => {
    const filePath = path.join(distDir, file);
    const stat = fs.statSync(filePath);

    const isSetupExe = file.endsWith('-setup.exe');
    const isPortableExe = file.endsWith('-portable.exe');

    if (isSetupExe || isPortableExe) {
      console.log(`Kept: ${file}`);
      keptCount++;
    } else {
      if (stat.isDirectory()) {
        fs.rmSync(filePath, { recursive: true, force: true });
        console.log(`Removed directory: ${file}`);
      } else {
        fs.unlinkSync(filePath);
        console.log(`Removed file: ${file}`);
      }
      removedCount++;
    }
  });

  console.log(`\nCleanup complete. Kept ${keptCount} .exe files, removed ${removedCount} items.`);
}

cleanDist();
