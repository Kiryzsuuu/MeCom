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
    socket.on('ch:typing', ({ channelId }) => {
      if (!channelId) return;
      socket.to(`ch:${channelId}`).emit('channel:typing', {
        channelId, userId: socket.userId, name: socket.userName,
      });
    });

    // ── Voice live caption relay (speech-to-text jalan lokal per orang di
    // browser masing-masing, ini cuma relay teksnya ke peserta voice lain) ──
    socket.on('voice:join-captions', ({ channelId }) => {
      if (channelId) socket.join(`voice-cc:${channelId}`);
    });
    socket.on('voice:leave-captions', ({ channelId }) => {
      if (channelId) socket.leave(`voice-cc:${channelId}`);
    });
    socket.on('voice:caption', ({ channelId, text }) => {
      if (!channelId || !text) return;
      socket.to(`voice-cc:${channelId}`).emit('voice:caption', {
        userId: socket.userId, name: socket.userName, text: String(text).slice(0, 500),
      });
    });

    // ── Task chat room ────────────────────────────────────────────────────────
    socket.on('task:join', ({ taskId }) => {
      if (taskId) socket.join(`task:${taskId}`);
    });
    socket.on('task:leave', ({ taskId }) => {
      if (taskId) socket.leave(`task:${taskId}`);
    });

    // ── Private call signaling (relay saja, tidak ada state di server) ─────────
    socket.on('call:invite', ({ targetUserId, conversationId, callerName, callerPhoto }) => {
      if (!targetUserId || !conversationId) return;
      io.to(`user:${targetUserId}`).emit('call:incoming', {
        fromUserId: socket.userId, conversationId,
        callerName: callerName || socket.userName, callerPhoto: callerPhoto || socket.userPhoto,
      });
    });
    socket.on('call:cancel', ({ targetUserId, conversationId }) => {
      if (!targetUserId) return;
      io.to(`user:${targetUserId}`).emit('call:cancelled', { conversationId, fromUserId: socket.userId });
    });
    socket.on('call:decline', ({ targetUserId, conversationId }) => {
      if (!targetUserId) return;
      io.to(`user:${targetUserId}`).emit('call:declined', { conversationId, fromUserId: socket.userId });
    });
    socket.on('call:accept', ({ targetUserId, conversationId }) => {
      if (!targetUserId) return;
      io.to(`user:${targetUserId}`).emit('call:accepted', { conversationId, fromUserId: socket.userId });
    });
  });

  return io;
}

function emitToUser(userId, event, data) {
  if (io) io.to(`user:${userId}`).emit(event, data);
}

function getIO() { return io; }

module.exports = { initSocket, emitToUser, getIO };
