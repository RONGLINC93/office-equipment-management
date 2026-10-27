// 发布到 GitHub：打包 zip + fpk -> 升级版本号 -> 打 tag -> 推送 -> 创建 Release 并上传产物
//              -> 发布成功后自动 bump 到下一开发版本号并提交推送
// 用法：
//   node release.js                 # patch 升级并发布（默认，含 zip 与 fpk）
//   node release.js minor           # minor 升级并发布
//   node release.js major           # major 升级并发布
//   node release.js 1.2.3           # 指定具体版本号并发布
//   node release.js 1.2.3 --no-push # 仅本地打包 + 打 tag，不推送、不建 Release（也不 bump）
//   node release.js --no-fpk        # 只发布 zip，不构建/上传 fpk
//
// 依赖 .env 中的 GITHUB_REPO_URL 与 GITHUB_TOKEN（与 推送.bat / 拉取.bat 共用）
// 构建 fpk 需要 fnpack.exe（放 fnos/ 目录下），下载：https://developer.fnnas.com/docs/cli/fnpack/

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');

const ROOT = __dirname;

// ---------- 读取 .env ----------
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('[错误] 未找到 .env 文件，请先配置 GITHUB_REPO_URL 和 GITHUB_TOKEN');
    process.exit(1);
  }
  const env = {};
  fs.readFileSync(envPath, 'utf-8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  });
  return env;
}

const env = loadEnv();
const token = env.GITHUB_TOKEN || '';
const repoUrl = (env.GITHUB_REPO_URL || '').trim();
if (!repoUrl || !token) {
  console.error('[错误] .env 中缺少 GITHUB_REPO_URL 或 GITHUB_TOKEN');
  process.exit(1);
}
const repoMatch = repoUrl.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
if (!repoMatch) {
  console.error('[错误] GITHUB_REPO_URL 不是合法的 GitHub 地址：' + repoUrl);
  process.exit(1);
}
const OWNER = repoMatch[1];
const REPO = repoMatch[2];

// 输出时隐藏令牌
const mask = (s) => s.split(token).join('******');
const authUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);

// ---------- git 辅助 ----------
function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (e) {
    console.error('[错误] git 命令执行失败：');
    console.error(mask(((e.stdout || '') + (e.stderr || '')).toString().trim()));
    process.exit(1);
  }
}

// ---------- 版本号 ----------
function readVersion() {
  const p = path.join(ROOT, 'version.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')).version || '0.0.0'; } catch { /* ignore */ }
  }
  return '0.0.0';
}

function bumpVersion(cur, kind) {
  const parts = String(cur).split('.').map(Number);
  let [maj, min, pat] = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  if (kind === 'major') { maj++; min = 0; pat = 0; }
  else if (kind === 'minor') { min++; pat = 0; }
  else { pat++; }
  return `${maj}.${min}.${pat}`;
}

function writeVersion(v) {
  const vp = path.join(ROOT, 'version.json');
  const vj = { version: v, buildTime: new Date().toISOString(), buildNumber: Date.now().toString(36), project: '办公设备管理系统' };
  fs.writeFileSync(vp, JSON.stringify(vj, null, 2));
  // 同步 package.json 的 version 字段
  const pp = path.join(ROOT, 'package.json');
  if (fs.existsSync(pp)) {
    const pj = JSON.parse(fs.readFileSync(pp, 'utf-8'));
    pj.version = v;
    fs.writeFileSync(pp, JSON.stringify(pj, null, 2) + '\n');
  }
  // 同步前端「关于系统」页面显示的版本号（public/index.html）
  const htmlPath = path.join(ROOT, 'public', 'index.html');
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const updated = html.replace(/(<p class="about-version">\s*版本\s*)[\d.]+(<\/p>)/, `$1${v}$2`);
    if (updated !== html) fs.writeFileSync(htmlPath, updated);
  }
}

// ---------- 打包 release zip ----------
// 注意：node_modules 不在此排除列表内——发布 zip 需要自带依赖，解压即可 node server.js 运行，
// 与 package.js（打包.bat）行为一致；fpk 同样自带依赖。
// fnos/ 是 fpk 打包工具链（fnpack.exe、脚本等），不属于可部署应用，排除。
const EXCLUDE_DIRS = new Set(['.git', 'fnos', 'releases', 'fpk', 'backup', 'uploads', 'screenshots', '.codebuddy', '.idea', '.vscode']);
const EXCLUDE_FILES = new Set([
  '.env', '.gitignore', '.DS_Store', 'Thumbs.db',
  // 构建/发布脚本，不属于可部署应用（运行脚本 运行.bat 与快捷方式 办公设备管理系统.url 保留）
  'release.js', 'push.js', 'pull.js', 'package.js', 'build-fpk.sh',
  '打包.bat', '打包fpk.bat', '发布.bat', '拉取.bat', '推送.bat',
]);
const EXCLUDE_EXT = new Set(['.zip', '.log']);

function buildReleaseZip(version) {
  const zip = new AdmZip();
  console.log('开始打包发布文件...');

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      const stat = fs.statSync(fp);
      const rel = path.relative(ROOT, fp).replace(/\\/g, '/');

      if (stat.isDirectory()) {
        if (EXCLUDE_DIRS.has(name)) { console.log('跳过目录:', rel); continue; }
        walk(fp);
      } else {
        if (EXCLUDE_FILES.has(name)) { console.log('跳过文件:', rel); continue; }
        if (name.startsWith('_')) { console.log('跳过文件:', rel); continue; } // 跳过临时/辅助脚本（如 _rebuild_zip.js）
        if (EXCLUDE_EXT.has(path.extname(name).toLowerCase())) { console.log('跳过文件:', rel); continue; }
        zip.addFile(rel, fs.readFileSync(fp), '', 0x0008);
      }
    }
  }
  walk(ROOT);

  const outDir = path.join(ROOT, 'releases');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  // 注意：GitHub Release 资源名不支持非 ASCII（中文会被剥离），故用 ASCII 命名，
  // 与 fpk 的 ems-<版本>.fpk 保持一致
  const outName = `ems-${version}.zip`;
  const outPath = path.join(outDir, outName);
  zip.writeZip(outPath);
  console.log('打包完成:', outName, '(' + (fs.statSync(outPath).size / 1024 / 1024).toFixed(2) + ' MB)');
  return { outPath, outName };
}

// ---------- 构建 fpk（端口化 打包fpk.bat 的步骤） ----------
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function locateFnpack(fnosDir) {
  const candidates = [path.join(fnosDir, 'fnpack.exe'), path.join(ROOT, 'fnpack.exe')];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const found = execFileSync('where', ['fnpack.exe'], { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString().trim().split(/\r?\n/)[0];
    if (found) return found;
  } catch { /* ignore */ }
  return null;
}

// 用 package.json 的 version 同步 fnOS 包 manifest 的 version 行
function syncManifestVersion() {
  const fnos = path.join(ROOT, 'fnos');
  const pkg = path.join(fnos, 'ems');
  try {
    execFileSync('powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(fnos, 'sync-version.ps1'),
        '-From', path.join(ROOT, 'package.json'), '-Manifest', path.join(pkg, 'manifest')],
      { cwd: ROOT, stdio: 'inherit' });
  } catch (e) { console.error('[错误] 同步 manifest 版本号失败'); process.exit(1); }
}

function buildFpk(version) {
  const fnos = path.join(ROOT, 'fnos');
  const pkg = path.join(fnos, 'ems');
  const server = path.join(pkg, 'app', 'server');
  const fnpack = locateFnpack(fnos);
  if (!fnpack) {
    console.error('[错误] 未找到 fnpack.exe（fpk 打包工具）。请将其放在 fnos/ 目录下。');
    console.error('        下载地址：https://developer.fnnas.com/docs/cli/fnpack/');
    process.exit(1);
  }

  console.log('[fpk] 复制应用文件...');
  fs.rmSync(server, { recursive: true, force: true });
  fs.mkdirSync(server, { recursive: true });
  for (const f of ['server.js', 'package.json', 'devices.json', 'device-types.json', 'users.json']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(server, f));
  }
  copyDir(path.join(ROOT, 'public'), path.join(server, 'public'));

  // 运行时依赖（express/cors/multer/adm-zip/node-cron）
  if (fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
    console.log('[fpk] 复制 node_modules...');
    copyDir(path.join(ROOT, 'node_modules'), path.join(server, 'node_modules'));
  } else {
    console.log('[fpk] 安装运行时依赖 (npm install --omit=dev)...');
    try {
      execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'],
        { cwd: server, stdio: 'inherit' });
    } catch (e) {
      console.error('[错误] 安装运行时依赖失败：' + e.message);
      process.exit(1);
    }
  }

  console.log('[fpk] 同步 manifest 版本号...');
  syncManifestVersion();

  console.log('[fpk] 规范化换行符为 LF...');
  try {
    execFileSync('powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(fnos, 'normalize-lf.ps1'), '-Path', pkg],
      { cwd: ROOT, stdio: 'inherit' });
  } catch (e) { console.error('[错误] 规范化换行符失败'); process.exit(1); }

  console.log('[fpk] fnpack build ...');
  try {
    execFileSync(fnpack, ['build'], { cwd: pkg, stdio: 'inherit' });
  } catch (e) { console.error('[错误] fnpack 构建失败：' + e.message); process.exit(1); }

  const built = path.join(pkg, 'ems.fpk');
  if (!fs.existsSync(built)) {
    console.error('[错误] fnpack 未生成 ' + built);
    process.exit(1);
  }
  const outDir = path.join(ROOT, 'fpk');
  fs.mkdirSync(outDir, { recursive: true });
  const outName = `ems-${version}.fpk`;
  const outPath = path.join(outDir, outName);
  if (fs.existsSync(outPath)) fs.rmSync(outPath);
  fs.renameSync(built, outPath);
  console.log('[fpk] 完成:', outName);
  return { outPath, outName };
}

// ---------- GitHub API ----------
function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ems-release',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request({
      hostname: 'api.github.com', path: apiPath, method, headers,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let json; try { json = JSON.parse(buf); } catch { json = buf; }
        if (res.statusCode >= 400) {
          const msg = (json && json.message) ? json.message : buf;
          reject(new Error(`GitHub API ${res.statusCode}: ${msg}`));
        } else resolve(json);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function uploadAsset(uploadUrl, filePath, fileName) {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    const buf = fs.readFileSync(filePath);
    const req = https.request({
      hostname: u.hostname,
      path: `${u.pathname}?name=${encodeURIComponent(fileName)}`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/zip',
        'Content-Length': buf.length,
        'User-Agent': 'ems-release',
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`上传产物失败 ${res.statusCode}: ${b}`));
        else resolve();
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

async function createRelease(version, assets) {
  const tag = `v${version}`;
  console.log(`在 GitHub 创建 Release ${tag} ...`);
  const rel = await githubRequest('POST', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: tag,
    name: `v${version}`,
    body: `发布版本 v${version}\n\n构建时间：${new Date().toLocaleString('zh-CN')}`,
    draft: false,
    prerelease: false,
  });
  for (const a of assets) {
    console.log('上传产物:', a.outName);
    await uploadAsset(rel.upload_url.replace('{?name,label}', ''), a.outPath, a.outName);
  }
  console.log('Release 地址:', rel.html_url);
}

// ---------- 主流程 ----------
(async () => {
  const args = process.argv.slice(2);
  const noPush = args.includes('--no-push');
  const noFpk = args.includes('--no-fpk');
  const kindArg = args.find(a => !a.startsWith('--')) || 'patch';

  const cur = readVersion();
  let newVersion;
  if (/^\d+\.\d+\.\d+$/.test(kindArg)) {
    newVersion = kindArg;
  } else if (['patch', 'minor', 'major'].includes(kindArg)) {
    newVersion = bumpVersion(cur, kindArg);
  } else {
    console.error('[错误] 参数无效，应为 patch | minor | major | x.y.z');
    process.exit(1);
  }

  const tag = `v${newVersion}`;
  const existingTags = git(['tag']).split(/\r?\n/).filter(Boolean);
  if (existingTags.includes(tag)) {
    console.error(`[错误] 标签 ${tag} 已存在，请升级版本号或选择其他版本`);
    process.exit(1);
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  console.log(`当前版本 ${cur} -> 新版本 ${newVersion}（分支 ${branch}）`);

  writeVersion(newVersion);
  const assets = [buildReleaseZip(newVersion)];

  if (!noFpk) {
    assets.push(buildFpk(newVersion));
  }

  git(['add', '-A']);
  git(['commit', '-m', `release v${newVersion}`]);
  git(['tag', '-a', tag, '-m', `release v${newVersion}`]);

  if (noPush) {
    console.log(`\n已本地打包并打标签 ${tag}（--no-push，未推送、未建 Release，也不做版本号 bump）`);
    return;
  }

  console.log(`推送 ${branch} 与标签 ${tag} ...`);
  try {
    execFileSync('git', ['push', authUrl, branch], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['push', authUrl, tag], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).toString();
    console.error('[错误] 推送失败：');
    console.error(mask(out.trim()));
    console.error('提示：若远端有新提交，请先运行 拉取.bat 同步后再发布');
    process.exit(1);
  }

  try {
    await createRelease(newVersion, assets);
  } catch (e) {
    console.error('[错误] 创建 Release 失败：' + e.message);
    console.error('标签与代码已推送，可到 GitHub 网页手动创建 Release 并上传产物：');
    for (const a of assets) console.error('  - ' + a.outPath);
    process.exit(1);
  }

  console.log('\n发布成功！（v' + newVersion + '）');

  // 发布成功后，自动 bump 到下一个开发版本号并提交推送
  const nextVersion = bumpVersion(newVersion, 'patch');
  console.log(`bump 到下一开发版本 v${nextVersion} ...`);
  writeVersion(nextVersion);
  syncManifestVersion();
  git(['add', '-A']);
  git(['commit', '-m', `bump version -> v${nextVersion}`]);
  try {
    execFileSync('git', ['push', authUrl, branch], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).toString();
    console.error('[错误] 推送版本号失败：');
    console.error(mask(out.trim()));
    console.error('提示：若远端有新提交，请先运行 拉取.bat 同步后再推送');
    process.exit(1);
  }
  console.log('当前开发版本已更新为 v' + nextVersion);
})().catch(e => {
  console.error('[错误] ' + e.message);
  process.exit(1);
});
