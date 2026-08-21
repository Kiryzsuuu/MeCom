const router = require('express').Router();
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const auth = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const VoiceTranscript = require('../models/VoiceTranscript');

function getRoomService() {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) return null;
  return new RoomServiceClient(process.env.LIVEKIT_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

// GET /api/voice/token?room=general — token akses LiveKit untuk voice/video call
router.get('/token', auth, async (req, res) => {
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return res.status(503).json({ message: 'Voice belum dikonfigurasi di server' });
  }

  const room = (req.query.room || 'general').toString().slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!room) return res.status(400).json({ message: 'Room tidak valid' });

  // Room private call (1-on-1) — hanya partisipan percakapan yang boleh masuk
  if (room.startsWith('call-')) {
    const conversationId = room.slice(5);
    const c = await Conversation.findById(conversationId).catch(() => null);
    if (!c || !c.participants.some(p => p.toString() === req.user._id.toString())) {
      return res.status(403).json({ message: 'Akses ditolak' });
    }
  }

  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: req.user._id.toString(),
    name: req.user.namaLengkap,
    metadata: JSON.stringify({ fotoProfil: req.user.fotoProfil || null }),
    ttl: '6h',
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });

  const token = await at.toJwt();
  res.json({ token, url: process.env.LIVEKIT_URL, room });
});

// GET /api/voice/participants?room=general — roster peserta voice (untuk preview sebelum join)
router.get('/participants', auth, async (req, res) => {
  const rsc = getRoomService();
  if (!rsc) return res.json([]);

  const room = (req.query.room || 'general').toString().slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    const participants = await rsc.listParticipants(room);
    res.json(participants.map(p => {
      let meta = {};
      try { meta = JSON.parse(p.metadata || '{}'); } catch {}
      const audioTrack = p.tracks.find(t => t.type === 0); // 0 = TrackType.AUDIO
      return { userId: p.identity, name: p.name, photo: meta.fotoProfil || null, muted: audioTrack ? !!audioTrack.muted : true };
    }));
  } catch {
    res.json([]); // room belum ada / belum ada yang join
  }
});

// GET /api/voice/transcript?room=general&date=YYYY-MM-DD — notulen (transkrip) voice
router.get('/transcript', auth, async (req, res) => {
  const room = (req.query.room || 'general').toString().slice(0, 100).replace(/[^a-zA-Z0-9_-]/g, '');
  const dateStr = (req.query.date || '').toString();

  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr) : new Date();
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0));
  const end   = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59, 999));

  const entries = await VoiceTranscript.find({ room, createdAt: { $gte: start, $lte: end } }).sort({ createdAt: 1 });
  res.json({ room, date: start.toISOString().slice(0, 10), entries });
});

module.exports = router;
