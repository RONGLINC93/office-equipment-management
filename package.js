const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// 排除规则（与 release.js 保持一致）：发布包只含可部署应用 + node_modules 依赖，
// 不包含 .git / fnos 工具链 / 构建与发布脚本 / 临时文件等。
const EXCLUDE_DIRS = new Set([
  '.git', 'fnos', 'releases', 'fpk', 'backup', 'uploads', 'screenshots',
  '.codebuddy', '.idea', '.vscode',
]);
const EXCLUDE_FILES = new Set([
  '.env', '.gitignore', '.DS_Store', 'Thumbs.db',
  'release.js', 'push.js', 'pull.js', 'package.js', 'build-fpk.sh',
  '打包.bat', '打包fpk.bat', '发布.bat', '拉取.bat', '推送.bat',
  'version.json', // 由下方统一写入，避免重复条目
]);
const EXCLUDE_EXT = new Set(['.zip', '.log']);

function createZipPackage(outputPath) {
  const rootDir = __dirname;
  const zip = new AdmZip();

  console.log('开始打包文件...');
  console.log('输出文件:', outputPath);

  function walkDirectory(dir) {
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');

      // 跳过根目录下的 .zip（避免把产物本身打进自己）
      if (dir === rootDir && file.endsWith('.zip')) {
        console.log('跳过:', rel);
        continue;
      }
      if (EXCLUDE_DIRS.has(file)) { console.log('跳过目录:', rel); continue; }
      if (EXCLUDE_FILES.has(file)) { console.log('跳过文件:', rel); continue; }
      if (file.startsWith('_')) { console.log('跳过文件:', rel); continue; } // 临时/辅助脚本
      if (EXCLUDE_EXT.has(path.extname(file).toLowerCase())) { console.log('跳过文件:', rel); continue; }

      if (stat.isDirectory()) {
        walkDirectory(filePath);
      } else {
        zip.addFile(rel, fs.readFileSync(filePath), '', 0x0008);
        console.log('添加文件:', rel);
      }
    }
  }

  walkDirectory(rootDir);

  // 版本信息：优先使用根目录真实 version.json（缺失时回退），单一来源写入，避免重复条目
  let versionRaw;
  const verPath = path.join(rootDir, 'version.json');
  if (fs.existsSync(verPath)) {
    versionRaw = fs.readFileSync(verPath);
  } else {
    versionRaw = JSON.stringify({
      version: '1.0.0',
      buildTime: new Date().toISOString(),
      buildNumber: Date.now().toString(36),
      project: '办公设备管理系统',
    }, null, 2);
  }
  zip.addFile('version.json', versionRaw, '', 0x0008);

  zip.writeZip(outputPath);

  console.log('\n打包完成!');
  console.log('文件大小:', (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2), 'MB');
}

const timestamp = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace(/[-:T.]/g, '').slice(0, 12);
const outputZip = path.join(__dirname, `办公设备管理系统${timestamp}.zip`);

createZipPackage(outputZip);
