const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const multer = require('multer');

const app = express();
const PORT = 9525;
const DATA_FILE = path.join(__dirname, 'devices.json');
const DEVICE_TYPES_FILE = path.join(__dirname, 'device-types.json');
const BACKUP_DIR = path.join(__dirname, 'backup');
const USERS_FILE = path.join(__dirname, 'users.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');

// 确保目录存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化日期时间
function formatDateTime(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, IMAGES_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB限制
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

// 中间件
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
  const initialData = { devices: [] };
  fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
}

// 初始化设备类型文件
if (!fs.existsSync(DEVICE_TYPES_FILE)) {
  const defaultDeviceTypes = [];
  fs.writeFileSync(DEVICE_TYPES_FILE, JSON.stringify(defaultDeviceTypes, null, 2));
}

// 读取设备数据
function readData() {
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
}

// 写入设备数据
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// 读取设备类型
function readDeviceTypes() {
  if (!fs.existsSync(DEVICE_TYPES_FILE)) {
    return [];
  }
  const data = fs.readFileSync(DEVICE_TYPES_FILE, 'utf8');
  return JSON.parse(data);
}

// 写入设备类型
function writeDeviceTypes(types) {
  fs.writeFileSync(DEVICE_TYPES_FILE, JSON.stringify(types, null, 2));
}

// 获取所有设备
app.get('/api/devices', (req, res) => {
  try {
    const data = readData();
    res.json(data.devices);
  } catch (error) {
    res.status(500).json({ error: '读取数据失败' });
  }
});

// 获取单个设备
app.get('/api/devices/:id', (req, res) => {
  try {
    const data = readData();
    const device = data.devices.find(d => d.id === req.params.id);
    if (!device) {
      return res.status(404).json({ error: '设备不存在' });
    }
    res.json(device);
  } catch (error) {
    res.status(500).json({ error: '读取数据失败' });
  }
});

// 添加设备
// 添加设备（支持图片上传）
app.post('/api/devices', upload.array('images', 10), (req, res) => {
  try {
    const data = readData();
    
    // 处理新上传的图片路径
    let newImagePaths = [];
    if (req.files && req.files.length > 0) {
      newImagePaths = req.files.map(file => '/uploads/images/' + file.filename);
    }
    
    // 处理已存在的图片（从其他设备复制时）- 需要实际复制文件并生成新ID
    let copiedImagePaths = [];
    if (req.body.existingImages) {
      const existingImagePaths = JSON.parse(req.body.existingImages);
      for (const oldImagePath of existingImagePaths) {
        const oldFullPath = path.join(__dirname, oldImagePath);
        if (fs.existsSync(oldFullPath)) {
          const ext = path.extname(oldFullPath);
          const newFilename = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
          const newFullPath = path.join(IMAGES_DIR, newFilename);
          fs.copyFileSync(oldFullPath, newFullPath);
          copiedImagePaths.push('/uploads/images/' + newFilename);
        }
      }
    }
    
    const newDevice = {
      id: Date.now().toString(),
      ...req.body,
      images: [...copiedImagePaths, ...newImagePaths]
    };
    
    data.devices.push(newDevice);
    writeData(data);
    res.status(201).json(newDevice);
  } catch (error) {
    res.status(500).json({ error: '添加设备失败' });
  }
});

// 更新设备（支持图片上传）
app.put('/api/devices/:id', upload.array('images', 10), (req, res) => {
  try {
    const data = readData();
    const index = data.devices.findIndex(d => d.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '设备不存在' });
    }

    const existingDevice = data.devices[index];

    // 处理新上传的图片
    let newImagePaths = [];
    if (req.files && req.files.length > 0) {
      newImagePaths = req.files.map(file => '/uploads/images/' + file.filename);
    }

    // 如果没有发送 existingImages 参数且没有新图片，则保留原有图片
    let allImages;
    if (req.body.existingImages !== undefined && req.body.existingImages !== '') {
      const existingImages = JSON.parse(req.body.existingImages);
      allImages = [...existingImages, ...newImagePaths];
    } else if (newImagePaths.length > 0) {
      // 有新图片上传，保留原有图片
      allImages = [...(existingDevice.images || []), ...newImagePaths];
    } else {
      // 既没有 existingImages 也没有新图片，保留原有图片
      allImages = existingDevice.images || [];
    }

    // 删除被移除的图片文件
    const originalImages = existingDevice.images || [];
    const removedImages = originalImages.filter(img => !allImages.includes(img));
    removedImages.forEach(imagePath => {
      const fullPath = path.join(__dirname, imagePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    });

    data.devices[index] = {
      ...data.devices[index],
      ...req.body,
      id: data.devices[index].id,
      images: allImages
    };
    writeData(data);
    res.json(data.devices[index]);
  } catch (error) {
    res.status(500).json({ error: '更新设备失败' });
  }
});

// 删除设备（同时删除关联图片）
app.delete('/api/devices/:id', (req, res) => {
  try {
    const data = readData();
    const index = data.devices.findIndex(d => d.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '设备不存在' });
    }
    
    // 删除关联的图片文件
    const device = data.devices[index];
    if (device.images && device.images.length > 0) {
      device.images.forEach(imagePath => {
        const fullPath = path.join(__dirname, imagePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      });
    }
    
    data.devices.splice(index, 1);
    writeData(data);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: '删除设备失败' });
  }
});

// 导入设备数据
app.post('/api/devices/import', (req, res) => {
  try {
    const data = readData();
    const newDevices = req.body;
    if (!Array.isArray(newDevices)) {
      return res.status(400).json({ error: '数据格式不正确' });
    }
    data.devices = newDevices;
    writeData(data);
    res.json({ message: '导入成功', count: newDevices.length });
  } catch (error) {
    res.status(500).json({ error: '导入数据失败' });
  }
});

// 清空设备数据
app.delete('/api/devices/clear', (req, res) => {
  try {
    writeData({ devices: [] });
    res.json({ message: '清空成功' });
  } catch (error) {
    res.status(500).json({ error: '清空数据失败' });
  }
});

// 设备类型管理 API
// 获取所有设备类型
app.get('/api/device-types', (req, res) => {
  try {
    const types = readDeviceTypes();
    res.json(types);
  } catch (error) {
    res.status(500).json({ error: '读取设备类型失败' });
  }
});

// 保存设备类型
app.post('/api/device-types', (req, res) => {
  try {
    const newTypes = req.body;
    if (!Array.isArray(newTypes)) {
      return res.status(400).json({ error: '数据格式不正确' });
    }
    writeDeviceTypes(newTypes);
    res.json({ message: '保存成功', types: newTypes });
  } catch (error) {
    res.status(500).json({ error: '保存设备类型失败' });
  }
});

// 登录 API
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = users.find(u => u.username === username && u.password === password);

    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    if (user.status !== 'active') {
      return res.status(401).json({ error: '用户已禁用' });
    }

    // 生成简单的 token（实际项目中应该使用 JWT）
    const token = `${username}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { password: _, ...safeUser } = user;

    res.json({
      message: '登录成功',
      user: safeUser,
      token
    });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

// 检查登录状态
app.get('/api/check-login', (req, res) => {
  try {
    const token = req.headers.authorization || req.query.token;
    if (!token) {
      return res.json({ loggedIn: false });
    }

    // 简单验证 token（实际项目中应该验证 JWT）
    const username = token.split('-')[0];
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = users.find(u => u.username === username && u.status === 'active');

    if (user) {
      const { password, ...safeUser } = user;
      return res.json({ loggedIn: true, user: safeUser });
    }

    res.json({ loggedIn: false });
  } catch (error) {
    res.json({ loggedIn: false });
  }
});

// 退出登录
app.post('/api/logout', (req, res) => {
  res.json({ message: '退出成功' });
});

// 用户信息 API（根据登录用户返回信息）
// 获取用户信息
app.get('/api/user', (req, res) => {
  try {
    const token = req.headers.authorization || req.query.token;
    if (!token) {
      return res.status(401).json({ error: '未登录' });
    }
    
    const username = token.split('-')[0];
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = users.find(u => u.username === username && u.status === 'active');
    
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const { password, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ error: '读取用户信息失败' });
  }
});

// 更新用户信息
app.post('/api/user', (req, res) => {
  try {
    const token = req.headers.authorization || req.query.token;
    if (!token) {
      return res.status(401).json({ error: '未登录' });
    }
    
    const username = token.split('-')[0];
    const { fullName, email, phone, department } = req.body;
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    // 找到当前登录用户
    const index = users.findIndex(u => u.username === username && u.status === 'active');
    
    if (index === -1) {
      return res.status(404).json({ error: '用户不存在' });
    }

    users[index].fullName = fullName || users[index].fullName;
    users[index].email = email || users[index].email;
    users[index].phone = phone || users[index].phone;
    users[index].department = department || users[index].department;

    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    const { password, ...safeUser } = users[index];
    res.json({ message: '保存成功', user: safeUser });
  } catch (error) {
    res.status(500).json({ error: '保存用户信息失败' });
  }
});

// 修改密码
app.post('/api/user/change-password', (req, res) => {
  try {
    const token = req.headers.authorization || req.query.token;
    if (!token) {
      return res.status(401).json({ error: '未登录' });
    }
    
    const username = token.split('-')[0];
    const { currentPassword, newPassword } = req.body;
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    // 找到当前登录用户
    const index = users.findIndex(u => u.username === username && u.status === 'active');
    
    if (index === -1) {
      return res.status(404).json({ error: '用户不存在' });
    }

    if (users[index].password !== currentPassword) {
      return res.status(400).json({ error: '当前密码错误' });
    }

    users[index].password = newPassword;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ message: '密码修改成功' });
  } catch (error) {
    res.status(500).json({ error: '修改密码失败' });
  }
});

// 用户管理 API
// 初始化用户列表文件
if (!fs.existsSync(USERS_FILE)) {
  const initialUsers = [
    {
      id: '1',
      username: 'admin',
      fullName: '系统管理员',
      email: 'admin@example.com',
      phone: '13800138000',
      department: '技术部',
      role: 'admin',
      status: 'active',
      password: 'admin123'
    }
  ];
  fs.writeFileSync(USERS_FILE, JSON.stringify(initialUsers, null, 2));
}

// 获取所有用户
app.get('/api/users', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    // 移除密码字段
    const safeUsers = users.map(({ password, ...rest }) => rest);
    res.json(safeUsers);
  } catch (error) {
    res.status(500).json({ error: '读取用户列表失败' });
  }
});

// 获取单个用户
app.get('/api/users/:id', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const user = users.find(u => u.id === req.params.id);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const { password, ...safeUser } = user;
    res.json(safeUser);
  } catch (error) {
    res.status(500).json({ error: '读取用户信息失败' });
  }
});

// 添加用户
app.post('/api/users', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const newUser = {
      id: Date.now().toString(),
      ...req.body,
      password: req.body.password || '123456'
    };
    
    // 检查用户名是否已存在
    if (users.some(u => u.username === newUser.username)) {
      return res.status(400).json({ error: '用户名已存在' });
    }
    
    users.push(newUser);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    const { password, ...safeUser } = newUser;
    res.json({ message: '添加成功', user: safeUser });
  } catch (error) {
    res.status(500).json({ error: '添加用户失败' });
  }
});

// 更新用户
app.put('/api/users/:id', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const index = users.findIndex(u => u.id === req.params.id);
    
    if (index === -1) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    // 检查用户名是否被其他用户使用
    if (req.body.username && users.some(u => u.id !== req.params.id && u.username === req.body.username)) {
      return res.status(400).json({ error: '用户名已存在' });
    }
    
    // 如果提供了密码则更新，否则保持原密码
    if (!req.body.password) {
      req.body.password = users[index].password;
    }
    
    users[index] = { ...users[index], ...req.body };
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    const { password, ...safeUser } = users[index];
    res.json({ message: '更新成功', user: safeUser });
  } catch (error) {
    res.status(500).json({ error: '更新用户失败' });
  }
});

// 删除用户
app.delete('/api/users/:id', (req, res) => {
  try {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const filtered = users.filter(u => u.id !== req.params.id);
    
    if (filtered.length === users.length) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    fs.writeFileSync(USERS_FILE, JSON.stringify(filtered, null, 2));
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: '删除用户失败' });
  }
});

// 系统更新 API - 上传 ZIP 包并解压替换
app.post('/api/system-update', (req, res) => {
  let buffer = Buffer.alloc(0);
  let fileName = '';
  let responseSent = false;

  function sendResponse(statusCode, data) {
    if (!responseSent) {
      responseSent = true;
      res.status(statusCode).json(data);
    }
  }

  req.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
  });

  req.on('end', () => {
    try {
      console.log('收到系统更新请求');

      // 解析 Content-Type 获取 boundary
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) {
        sendResponse(400, { error: '无效的请求格式' });
        return;
      }
      const boundary = boundaryMatch[1].replace(/^"|"$/g, '');

      // 分割请求体
      const boundaryBuffer = Buffer.from('--' + boundary, 'binary');
      const parts = [];
      let start = 0;

      while (true) {
        const index = buffer.indexOf(boundaryBuffer, start);
        if (index === -1) break;
        parts.push(buffer.slice(start, index));
        start = index + boundaryBuffer.length;
      }

      // 遍历所有部分，提取文件
      for (const part of parts) {
        if (part.length === 0) continue;

        const headerEnd = part.indexOf(Buffer.from('\r\n\r\n', 'binary'));
        if (headerEnd === -1) continue;

        const headers = part.slice(0, headerEnd).toString('utf8');
        const data = part.slice(headerEnd + 4);

        const fileNameMatch = headers.match(/filename="([^"]+)"/);
        if (fileNameMatch) {
          fileName = fileNameMatch[1];

          if (!fileName.endsWith('.zip')) {
            sendResponse(400, { error: '只支持 ZIP 格式的更新包' });
            return;
          }

          // 保存更新包
          const upgradeDir = path.join(__dirname, 'upgrades');
          if (!fs.existsSync(upgradeDir)) {
            fs.mkdirSync(upgradeDir, { recursive: true });
          }

          const upgradeFilePath = path.join(upgradeDir, fileName);
          fs.writeFileSync(upgradeFilePath, data);
          console.log('更新包已保存:', upgradeFilePath, '大小:', data.length);

          // 验证更新包
          console.log('正在验证更新包...');
          const validationResult = validateUpdatePackage(upgradeFilePath);
          if (!validationResult.valid) {
            fs.unlinkSync(upgradeFilePath);
            sendResponse(400, { error: validationResult.message });
            return;
          }
          console.log('更新包验证通过:', validationResult);

          // 创建临时解压目录
          const tempExtractDir = path.join(__dirname, 'temp', 'extract');
          if (fs.existsSync(tempExtractDir)) {
            fs.rmSync(tempExtractDir, { recursive: true, force: true });
          }
          fs.mkdirSync(tempExtractDir, { recursive: true });

          // 解压更新包
          console.log('正在解压更新包...');
          const zip = new AdmZip(upgradeFilePath);
          const zipEntries = zip.getEntries();

          for (const entry of zipEntries) {
            const entryName = entry.entryName;
            const filePath = path.join(tempExtractDir, entryName);

            if (entry.isDirectory) {
              if (!fs.existsSync(filePath)) {
                fs.mkdirSync(filePath, { recursive: true });
              }
            } else {
              const fileDir = path.dirname(filePath);
              if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
              }
              fs.writeFileSync(filePath, entry.getData());
            }
          }
          console.log('解压完成');

          // 删除旧文件（保留数据文件）
          console.log('正在清理旧文件...');
          const protectedItems = ['devices.json', 'device-types.json', 'users.json', 'upgrades', 'temp', 'backup','uploads'];

          const rootItems = fs.readdirSync(__dirname);
          for (const item of rootItems) {
            if (protectedItems.includes(item)) continue;
            const itemPath = path.join(__dirname, item);
            try {
              const stat = fs.statSync(itemPath);
              if (stat.isDirectory()) {
                fs.rmSync(itemPath, { recursive: true, force: true });
              } else {
                fs.unlinkSync(itemPath);
              }
              console.log('删除:', item);
            } catch (e) {
              console.error('删除失败:', item, e.message);
            }
          }

          // 清理 public 目录
          const publicDir = path.join(__dirname, 'public');
          if (fs.existsSync(publicDir)) {
            const publicItems = fs.readdirSync(publicDir);
            for (const item of publicItems) {
              if (protectedItems.includes(item)) continue;
              const itemPath = path.join(publicDir, item);
              try {
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                  fs.rmSync(itemPath, { recursive: true, force: true });
                } else {
                  fs.unlinkSync(itemPath);
                }
                console.log('删除 public/', item);
              } catch (e) {
                console.error('删除失败: public/', item, e.message);
              }
            }
          }

          // 复制新文件（合并数据文件）
          console.log('正在复制新文件...');
          const mergeFiles = ['devices.json', 'device-types.json', 'users.json'];
          function copyFiles(srcDir, destDir) {
            if (!fs.existsSync(srcDir)) return;
            const items = fs.readdirSync(srcDir);
            for (const item of items) {
              const srcPath = path.join(srcDir, item);
              const destPath = path.join(destDir, item);
              const stat = fs.statSync(srcPath);
              if (stat.isDirectory()) {
                fs.mkdirSync(destPath, { recursive: true });
                copyFiles(srcPath, destPath);
              } else {
                // 如果是需要合并的数据文件
                if (mergeFiles.includes(item)) {
                  console.log('合并数据文件:', item);
                  mergeDataFile(srcPath, destPath);
                  continue;
                }
                fs.copyFileSync(srcPath, destPath);
                console.log('复制:', item);
              }
            }
          }

          // 合并数据文件函数
          function mergeDataFile(srcPath, destPath) {
            try {
              // 读取源文件（更新包中的新数据）
              const srcContent = fs.readFileSync(srcPath, 'utf8');
              const srcData = JSON.parse(srcContent);
              
              // 如果目标文件不存在，直接复制
              if (!fs.existsSync(destPath)) {
                fs.writeFileSync(destPath, JSON.stringify(srcData, null, 2));
                return;
              }
              
              // 读取目标文件（现有数据）
              const destContent = fs.readFileSync(destPath, 'utf8');
              const destData = JSON.parse(destContent);
              
              // 根据文件名进行不同的合并逻辑
              if (path.basename(destPath) === 'devices.json') {
                // 合并设备数据：保留现有设备，添加新设备（去重）
                const existingIds = new Set(destData.devices.map(d => d.id));
                srcData.devices.forEach(device => {
                  if (!existingIds.has(device.id)) {
                    destData.devices.push(device);
                  }
                });
                fs.writeFileSync(destPath, JSON.stringify(destData, null, 2));
                console.log('已合并设备数据，新增设备:', srcData.devices.length - (srcData.devices.length + destData.devices.length - new Set([...existingIds, ...srcData.devices.map(d => d.id)]).size));
              } else if (path.basename(destPath) === 'device-types.json') {
                // 合并设备类型：保留现有类型，添加新类型（去重）
                const existingNames = new Set(destData.map(t => t.name));
                srcData.forEach(type => {
                  if (!existingNames.has(type.name)) {
                    destData.push(type);
                  }
                });
                fs.writeFileSync(destPath, JSON.stringify(destData, null, 2));
                console.log('已合并设备类型，新增类型:', srcData.length - (srcData.length + destData.length - new Set([...existingNames, ...srcData.map(t => t.name)]).size));
              } else if (path.basename(destPath) === 'users.json') {
                // 合并用户数据：保留现有用户（包括密码），添加新用户（去重）
                const existingUsernames = new Set(destData.map(u => u.username));
                srcData.forEach(user => {
                  if (!existingUsernames.has(user.username)) {
                    destData.push(user);
                  }
                });
                fs.writeFileSync(destPath, JSON.stringify(destData, null, 2));
                console.log('已合并用户数据，新增用户:', srcData.length - (srcData.length + destData.length - new Set([...existingUsernames, ...srcData.map(u => u.username)]).size));
              }
            } catch (error) {
              console.error('合并数据文件失败:', error.message);
            }
          }

          copyFiles(tempExtractDir, __dirname);

          // 清理临时目录
          fs.rmSync(tempExtractDir, { recursive: true, force: true });
          console.log('临时目录已清理');

          // 清理旧升级包（保留最新3个）
          try {
            const upgradeFiles = fs.readdirSync(upgradeDir)
              .filter(f => f.endsWith('.zip'))
              .map(f => ({
                name: f,
                path: path.join(upgradeDir, f),
                mtime: fs.statSync(path.join(upgradeDir, f)).mtime
              }))
              .sort((a, b) => b.mtime - a.mtime);

            if (upgradeFiles.length > 3) {
              upgradeFiles.slice(3).forEach(f => {
                fs.unlinkSync(f.path);
                console.log('删除旧升级包:', f.name);
              });
            }
          } catch (e) {
            console.error('清理旧升级包失败:', e);
          }

          // 发送成功响应
          sendResponse(200, { success: true, message: '系统更新成功，正在重启...', version: validationResult.version });

          // 延迟重启服务器
          console.log('正在重启服务器...');
          setTimeout(() => {
            const { spawn } = require('child_process');

            const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
              detached: true,
              stdio: ['ignore', 'inherit', 'inherit']
            });

            child.unref();

            setTimeout(() => {
              process.exit(0);
            }, 1000);
          }, 1000);
        }
      }
    } catch (error) {
      console.error('系统更新失败:', error);
      sendResponse(500, { error: '系统更新失败: ' + error.message });
    }
  });

  req.on('error', (err) => {
    console.error('请求错误:', err);
  });
});

// 验证更新包
function validateUpdatePackage(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    
    // 检查是否包含必要的验证文件
    const versionEntry = entries.find(e => e.entryName === 'version.json');
    
    if (!versionEntry) {
      return { valid: false, message: '更新包缺少 version.json 文件' };
    }
    
    // 读取 version.json
    const versionContent = versionEntry.getData().toString('utf8');
    let versionInfo;
    try {
      versionInfo = JSON.parse(versionContent);
    } catch {
      return { valid: false, message: 'version.json 格式无效' };
    }
    
    // 验证项目标识
    if (versionInfo.project !== '办公设备管理系统') {
      return { valid: false, message: '更新包项目标识不匹配，不是有效的办公设备管理系统更新包' };
    }
    
    // 检查必要字段
    if (!versionInfo.version || !versionInfo.buildTime) {
      return { valid: false, message: 'version.json 缺少必要字段' };
    }
    
    // 检查关键文件是否存在
    const requiredFiles = [
      'server.js',
      'package.json',
      'public/index.html',
      'public/app.js',
      'public/style.css'
    ];
    
    const missingFiles = [];
    for (const file of requiredFiles) {
      if (!entries.find(e => e.entryName === file)) {
        missingFiles.push(file);
      }
    }
    
    if (missingFiles.length > 0) {
      return { valid: false, message: `更新包缺少关键文件: ${missingFiles.join(', ')}` };
    }
    
    console.log('更新包验证通过:');
    console.log('  项目:', versionInfo.project);
    console.log('  版本:', versionInfo.version);
    console.log('  构建时间:', versionInfo.buildTime);
    
    return {
      valid: true,
      message: '验证通过',
      version: versionInfo.version,
      buildTime: versionInfo.buildTime,
      project: versionInfo.project
    };
    
  } catch (error) {
    return { valid: false, message: '验证失败: ' + error.message };
  }
}

// 获取备份列表
app.get('/api/backups', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.zip'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          filename: f,
          size: formatFileSize(stats.size),
          createdAt: formatDateTime(stats.birthtime)
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: '获取备份列表失败' });
  }
});

// 创建手动备份
app.post('/api/backups', (req, res) => {
  try {
    const timestamp = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const backupFileName = `backup_${timestamp}.zip`;
    const backupFilePath = path.join(BACKUP_DIR, backupFileName);
    
    const zip = new AdmZip();
    
    // 添加数据文件
    const dataFiles = [
      { path: DATA_FILE, name: 'devices.json' },
      { path: DEVICE_TYPES_FILE, name: 'device-types.json' },
      { path: USERS_FILE, name: 'users.json' }
    ];
    
    dataFiles.forEach(file => {
      if (fs.existsSync(file.path)) {
        const content = fs.readFileSync(file.path);
        zip.addFile(file.name, content);
        console.log(`[备份] 添加数据文件: ${file.name}`);
      }
    });
    
    // 添加上传目录（附件）
    let attachmentCount = 0;
    if (fs.existsSync(UPLOADS_DIR)) {
      function walkDir(dir, basePath) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isDirectory()) {
            walkDir(filePath, basePath);
          } else {
            const relativePath = path.relative(basePath, filePath);
            const content = fs.readFileSync(filePath);
            zip.addFile(`uploads/${relativePath}`, content);
            attachmentCount++;
            console.log(`[备份] 添加附件: uploads/${relativePath}`);
          }
        });
      }
      walkDir(UPLOADS_DIR, UPLOADS_DIR);
    }
    
    zip.writeZip(backupFilePath);
    cleanupOldBackups();
    
    console.log(`[备份] 手动备份创建成功: ${backupFileName}, 附件数量: ${attachmentCount}`);
    res.json({ success: true, filename: backupFileName, attachmentCount });
  } catch (error) {
    console.error('[备份] 手动备份创建失败:', error.message);
    res.status(500).json({ error: '创建备份失败' });
  }
});

// 下载备份文件
app.get('/api/backups/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }
    
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('[备份] 下载失败:', err.message);
        res.status(500).json({ error: '下载失败' });
      }
    });
  } catch (error) {
    console.error('[备份] 下载失败:', error.message);
    res.status(500).json({ error: '下载失败' });
  }
});

// 删除备份文件
app.delete('/api/backups/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`[备份] 删除成功: ${filename}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[备份] 删除失败:', error.message);
    res.status(500).json({ error: '删除失败' });
  }
});

// 还原备份
app.post('/api/backups/:filename/restore', (req, res) => {
  try {
    const filename = req.params.filename;
    const { mode } = req.body; // 'overwrite' 或 'merge'
    const filePath = path.join(BACKUP_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }
    
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    let restoredCount = 0;
    let mergedCount = 0;
    
    zipEntries.forEach(entry => {
      if (entry.isDirectory) return;
      
      const entryName = entry.entryName;
      let targetPath = '';
      
      // 确定目标路径
      if (entryName === 'devices.json') {
        targetPath = DATA_FILE;
      } else if (entryName === 'device-types.json') {
        targetPath = DEVICE_TYPES_FILE;
      } else if (entryName === 'users.json') {
        targetPath = USERS_FILE;
      } else if (entryName.startsWith('uploads/')) {
        targetPath = path.join(__dirname, entryName);
      } else {
        return; // 跳过未知文件
      }
      
      // 确保目录存在
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // 根据模式处理数据文件
      if (mode === 'merge' && (entryName === 'devices.json' || entryName === 'device-types.json' || entryName === 'users.json')) {
        // 合并模式
        if (fs.existsSync(targetPath)) {
          const existingData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
          const backupData = JSON.parse(entry.getData().toString('utf8'));
          
          if (Array.isArray(existingData) && Array.isArray(backupData)) {
            const existingIds = new Set(existingData.map(item => item.id));
            const newItems = backupData.filter(item => !existingIds.has(item.id));
            mergedCount += newItems.length;
            existingData.push(...newItems);
            fs.writeFileSync(targetPath, JSON.stringify(existingData, null, 2));
          } else {
            fs.writeFileSync(targetPath, entry.getData());
          }
        } else {
          fs.writeFileSync(targetPath, entry.getData());
        }
        restoredCount++;
      } else {
        // 覆盖模式
        fs.writeFileSync(targetPath, entry.getData());
        restoredCount++;
      }
    });
    
    const message = mode === 'merge' 
      ? `成功还原 ${restoredCount} 个文件，合并 ${mergedCount} 条新记录`
      : `成功还原 ${restoredCount} 个文件`;
    
    console.log(`[备份] 还原成功: ${filename}, 模式: ${mode}`);
    res.json({ success: true, message });
  } catch (error) {
    console.error('[备份] 还原失败:', error.message);
    res.status(500).json({ error: '还原失败：' + error.message });
  }
});

// 创建备份函数
function createBackup() {
  try {
    const timestamp = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const backupFileName = `backup_${timestamp}.zip`;
    const backupFilePath = path.join(BACKUP_DIR, backupFileName);
    
    const zip = new AdmZip();
    
    // 添加数据文件
    const dataFiles = [
      { path: DATA_FILE, name: 'devices.json' },
      { path: DEVICE_TYPES_FILE, name: 'device-types.json' },
      { path: USERS_FILE, name: 'users.json' }
    ];
    
    dataFiles.forEach(file => {
      if (fs.existsSync(file.path)) {
        const content = fs.readFileSync(file.path);
        zip.addFile(file.name, content);
      }
    });
    
    // 添加上传目录
    if (fs.existsSync(UPLOADS_DIR)) {
      // 递归遍历目录
      function walkDir(dir, basePath) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isDirectory()) {
            walkDir(filePath, basePath);
          } else {
            const relativePath = path.relative(basePath, filePath);
            const content = fs.readFileSync(filePath);
            zip.addFile(`uploads/${relativePath}`, content);
          }
        });
      }
      walkDir(UPLOADS_DIR, UPLOADS_DIR);
    }
    
    // 写入备份文件
    zip.writeZip(backupFilePath);
    
    // 清理过期备份（保留最近30天）
    cleanupOldBackups();
    
    console.log(`[备份] 创建成功: ${backupFileName}`);
  } catch (error) {
    console.error('[备份] 创建失败:', error.message);
  }
}

// 清理过期备份
function cleanupOldBackups() {
  try {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    fs.readdirSync(BACKUP_DIR).forEach(file => {
      if (file.endsWith('.zip')) {
        const filePath = path.join(BACKUP_DIR, file);
        const stats = fs.statSync(filePath);
        if (stats.birthtime.getTime() < thirtyDaysAgo) {
          fs.unlinkSync(filePath);
          console.log(`[备份] 清理过期备份: ${file}`);
        }
      }
    });
  } catch (error) {
    console.error('[备份] 清理失败:', error.message);
  }
}

// 定时备份任务（每天凌晨2:00执行）
function scheduleDailyBackup() {
  const now = new Date();
  const nextBackup = new Date(now);
  nextBackup.setHours(2, 0, 0, 0);
  
  if (nextBackup <= now) {
    nextBackup.setDate(nextBackup.getDate() + 1);
  }
  
  const delay = nextBackup.getTime() - now.getTime();
  
  setTimeout(() => {
    console.log('[定时任务] 开始执行自动备份...');
    createBackup();
    scheduleDailyBackup();
  }, delay);
  
  console.log(`[定时任务] 下次备份时间: ${nextBackup.toLocaleString('zh-CN')}`);
}

scheduleDailyBackup();

// 服务器启动时立即执行一次备份
console.log('[启动] 执行初始备份...');
try {
  createBackup();
} catch (e) {
  console.error('[启动] 备份错误:', e);
}

// 启动服务器
const serverInstance = app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`办公设备管理系统已启动`);
});
