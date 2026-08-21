const mongoose = require('mongoose');

const voiceTranscriptSchema = new mongoose.Schema({
  room:   { type: String, required: true }, // VOICE_ROOM_ID, mis. 'general'
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:   { type: String, required: true }, // snapshot nama saat bicara
  text:   { type: String, required: true, maxlength: 1000 },
}, { timestamps: true });

voiceTranscriptSchema.index({ room: 1, createdAt: 1 });

module.exports = mongoose.model('VoiceTranscript', voiceTranscriptSchema);
