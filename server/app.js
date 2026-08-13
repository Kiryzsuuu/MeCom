require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
require('dns').setDefaultResultOrder('ipv4first');
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('express-async-errors');

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const path     = require('path');
const http     = require('http');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const { initSocket } = require('./socket');
const { startCronJobs } = require('./cron/reminders');

const app    = express();
const server = http.createServer(app);

// Socket.io
initSocket(server);

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.APP_URL || '*', credentials: true }));

// Rate limit UMUM untuk seluruh API. Respons JSON agar frontend menampilkan pesan jelas.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ message: 'Terlalu banyak permintaan. Coba lagi dalam beberapa menit.' }),
});
app.use('/api', generalLimiter);

// Body parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/direktorat',    require('./routes/direktorat'));
app.use('/api/tasks',         require('./routes/tasks'));
app.use('/api/subtasks',      require('./routes/subtasks'));
app.use('/api/evidence',      require('./routes/evidence'));
app.use('/api/komentar',      require('./routes/komentar'));
app.use('/api/notifikasi',    require('./routes/notifikasi'));
app.use('/api/kpi',           require('./routes/kpi'));
app.use('/api/reports',       require('./routes/reports'));
app.use('/api/site-settings', require('./routes/site-settings'));
app.use('/api/templates',    require('./routes/templates'));
app.use('/api/milestones',   require('./routes/milestones'));
app.use('/api/push',         require('./routes/push'));
app.use('/api/audit',        require('./routes/audit'));
app.use('/api/channels',     require('./routes/channels'));
app.use('/api/tasks/:taskId/messages', require('./routes/task-messages'));

// Root → redirect ke login
app.get('/', (req, res) => {
  res.redirect('/pages/login.html');
});

// Fallback untuk path yang tidak ditemukan
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ message: 'Endpoint tidak ditemukan' });
  }
  // Redirect ke login untuk path HTML yang tidak ada
  res.redirect('/pages/login.html');
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: err.message || 'Terjadi kesalahan pada server',
  });
});

const PORT = process.env.PORT || 5001;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`MeCom AILO berjalan di http://localhost:${PORT}`);
    startCronJobs();
  });
});
