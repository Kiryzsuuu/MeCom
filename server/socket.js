const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token diperlukan'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userName = decoded.namaLengkap || '';
      socket.userPhoto = socket.handshake.auth?.photo || null;
      next();
    } catch {
      next(new Error('Token tidak valid'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);

    // ── Channel text room ─────────────────────────────────────────────────────
    socket.on('ch:join', ({ channelId }) => {
      if (channelId) socket.join(`ch:${channelId}`);
    });
    socket.on('ch:leave', ({ channelId }) => {
      if (channelId) socket.leave(`ch:${channelId}`);
    });

    // ── Task chat room ────────────────────────────────────────────────────────
    socket.on('task:join', ({ taskId }) => {
      if (taskId) socket.join(`task:${taskId}`);
    });
    socket.on('task:leave', ({ taskId }) => {
      if (taskId) socket.leave(`task:${taskId}`);
    });
  });

  return io;
}

function emitToUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

function getIO() { return io; }

module.exports = { initSocket, emitToUser, getIO };
