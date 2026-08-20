const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.docx'];
const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/evidence');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext    = path.extname(file.originalname).toLowerCase();
    cb(null, unique + ext);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Format file tidak didukung. Gunakan: ${ALLOWED.join(', ')}`));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE } });

// Upload foto profil
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar-${req.user._id}${ext}`);
  },
});

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png'].includes(ext)) cb(null, true);
    else cb(new Error('Foto profil harus berformat JPG atau PNG'));
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Upload lampiran chat channel (gambar & dokumen umum)
const CHAT_ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.xlsx', '.docx', '.pptx', '.txt', '.zip'];
const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/chat');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext    = path.extname(file.originalname).toLowerCase();
    cb(null, unique + ext);
  },
});

const uploadChatFile = multer({
  storage: chatStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (CHAT_ALLOWED.includes(ext)) cb(null, true);
    else cb(new Error(`Format file tidak didukung. Gunakan: ${CHAT_ALLOWED.join(', ')}`));
  },
  limits: { fileSize: MAX_SIZE },
});

module.exports = { upload, uploadAvatar, uploadChatFile };
