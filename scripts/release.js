const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. 尝试加载 .env 文件
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    console.log('Loading environment variables from .env...');
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split(/\r?\n/).forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (key && value && !key.startsWith('#')) {
                process.env[key] = value;
            }
        }
    });
}

// 2. 检查 GH_TOKEN
if (!process.env.GH_TOKEN) {
    console.error('\n[Error] GH_TOKEN environment variable is missing!');
    console.error('Please create a .env file in the project root with your GitHub Token:');
    console.error('GH_TOKEN=your_token_here');
    console.error('\nOr set it in your terminal session.\n');
    process.exit(1);
}

// 3. 执行发布命令
console.log('Starting release build...');
try {
    // 使用 smart-build.js 进行构建和发布，避免重复构建和文件锁定问题
    // 设置 PUBLISH=true 环境变量
    const smartBuildPath = path.resolve(__dirname, 'smart-build.js');
    
    // 继承当前环境变量，并添加 PUBLISH=true
    const env = { 
        ...process.env,
        PUBLISH: 'true'
    };

    execSync(`node "${smartBuildPath}"`, {
        stdio: 'inherit',
        env: env
    });
    
    console.log('\n[Success] Release published successfully!');
} catch (error) {
    console.error('\n[Error] Release failed.');
    process.exit(1);
}
