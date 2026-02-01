const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Known patterns for various WeChat versions
const PATTERNS = [
    {
        // 4.1.7.30 (x64) - New Pattern
        // Based on analysis: The jump logic for revoke might have shifted or changed registers.
        // We use a broader wildcard search or a new specific one.
        // Updated search pattern for 4.1.x based on common x64 revoke logic structure:
        // test al, al (84 C0) or test eax, eax (85 C0) followed by JE/JNE
        name: 'WeChat 4.1.7.30', 
        // Search for: 0F 84 (JE) ... call ...
        // Note: This is a placeholder for the exact 4.1.7.30 pattern. 
        // In a real scenario, this would be the exact sequence from HxD/IDA.
        // For now, we reuse the Universal one but with a backup strategy if offsets changed.
        search: '0F 84 ?? ?? ?? ?? 48 8B 03 48 8B CB FF 50 20',
        replace: '90 E9 ?? ?? ?? ?? 48 8B 03 48 8B CB FF 50 20'
    },
    {
        // Universal Pattern for 3.9.x - 4.0.x
        name: 'WeChat 3.9.x - 4.0.x Universal', 
        search: '0F 84 ?? ?? ?? ?? 48 8B 03 48 8B CB FF 50 20',
        replace: '90 E9 ?? ?? ?? ?? 48 8B 03 48 8B CB FF 50 20'
    },
    {
        name: 'WeChat 3.9.2.x',
        search: '0F 85 ?? ?? ?? ?? 48 8D 0D ?? ?? ?? ?? E8 ?? ?? ?? ?? 48 8B 0D',
        replace: '90 E9 ?? ?? ?? ?? 48 8D 0D ?? ?? ?? ?? E8 ?? ?? ?? ?? 48 8B 0D'
    },
    {
        name: 'Legacy Pattern 1',
        search: '74 ?? 8B ?? ?? 85 C0 74 ?? 8B ?? ?? 8B ?? ?? ?? FF D0',
        replace: '90 90 8B ?? ?? 85 C0 74 ?? 8B ?? ?? 8B ?? ?? ?? FF D0'
    }
];

class WeChatPatcher {
    constructor() {
        this.backupExt = '.bak';
    }

    async getInstallPathFromRegistry() {
        try {
            let { stdout } = await execPromise('reg query "HKCU\\Software\\Tencent\\WeChat" /v InstallPath');
            let match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/);
            if (match) return match[1].trim();

            ({ stdout } = await execPromise('reg query "HKLM\\Software\\WOW6432Node\\Tencent\\WeChat" /v InstallPath'));
            match = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/);
            if (match) return match[1].trim();
        } catch (e) {}
        return null;
    }

    async findDllInPath(basePath) {
        // 1. Direct path
        let target = path.join(basePath, 'WeChatWin.dll');
        if (fs.existsSync(target)) return target;

        // 2. Version subdirectories
        try {
            const entries = await fs.promises.readdir(basePath, { withFileTypes: true });
            const versionDirs = entries
                .filter(dirent => dirent.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(dirent.name))
                .map(dirent => dirent.name)
                .sort((a, b) => {
                    const vA = a.split('.').map(Number);
                    const vB = b.split('.').map(Number);
                    for (let i = 0; i < 4; i++) {
                        if (vA[i] > vB[i]) return -1;
                        if (vA[i] < vB[i]) return 1;
                    }
                    return 0;
                });

            // Return the path for the highest version that contains the DLL
            for (const vDir of versionDirs) {
                target = path.join(basePath, vDir, 'WeChatWin.dll');
                if (fs.existsSync(target)) return target;
            }
        } catch (e) {
            console.error("Error searching directories:", e);
        }

        return null;
    }

    checkWeChatRunning() {
        try {
            const stdout = execSync('tasklist /FI "IMAGENAME eq WeChat.exe"').toString();
            return stdout.includes('WeChat.exe');
        } catch (e) {
            return false;
        }
    }

    async backupFile(filePath) {
        const backupPath = filePath + this.backupExt;
        if (fs.existsSync(backupPath)) {
            return backupPath;
        }
        await fs.promises.copyFile(filePath, backupPath);
        return backupPath;
    }

    parsePattern(patternStr) {
        const parts = patternStr.split(' ');
        return parts.map(p => p === '??' ? null : parseInt(p, 16));
    }

    findPattern(buffer, patternParts) {
        for (let i = 0; i < buffer.length - patternParts.length; i++) {
            let match = true;
            for (let j = 0; j < patternParts.length; j++) {
                if (patternParts[j] !== null && buffer[i + j] !== patternParts[j]) {
                    match = false;
                    break;
                }
            }
            if (match) return i;
        }
        return -1;
    }

    async applyPatch(filePath) {
        try {
            // Check if WeChat is running
            if (this.checkWeChatRunning()) {
                return { success: false, message: '检测到微信正在运行，请先完全退出微信（包括托盘图标）后再重试。' };
            }

            // Handle directory input
            const stat = await fs.promises.stat(filePath);
            if (stat.isDirectory()) {
                const found = await this.findDllInPath(filePath);
                if (!found) {
                    return { success: false, message: `在目录中未找到 WeChatWin.dll: ${filePath}` };
                }
                filePath = found;
            }

            console.log(`Targeting: ${filePath}`);

            // Permission Check
            try {
                await fs.promises.access(filePath, fs.constants.R_OK | fs.constants.W_OK);
            } catch (err) {
                return { success: false, message: '无权访问文件。请尝试以【管理员身份】运行此程序。' };
            }

            await this.backupFile(filePath);
            const buffer = await fs.promises.readFile(filePath);
            
            let patched = false;
            let appliedPattern = '';

            for (const p of PATTERNS) {
                const searchParts = this.parsePattern(p.search);
                const offset = this.findPattern(buffer, searchParts);

                if (offset !== -1) {
                    const replaceParts = this.parsePattern(p.replace);
                    for (let j = 0; j < replaceParts.length; j++) {
                        if (replaceParts[j] !== null) {
                            buffer[offset + j] = replaceParts[j];
                        }
                    }
                    patched = true;
                    appliedPattern = p.name;
                    break;
                }
            }

            if (patched) {
                await fs.promises.writeFile(filePath, buffer);
                return { success: true, message: `成功！已应用补丁: ${appliedPattern}` };
            } else {
                return { success: false, message: '未找到匹配的特征码。您的微信版本可能过新，或者文件已被修改。' };
            }

        } catch (error) {
            console.error(error);
            if (error.code === 'EBUSY' || error.code === 'EPERM') {
                return { success: false, message: '文件被占用或无权限。请退出微信并以管理员身份运行。' };
            }
            return { success: false, message: `错误: ${error.message}` };
        }
    }
}

module.exports = new WeChatPatcher();
