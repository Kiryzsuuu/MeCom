const mongoose = require('mongoose');

const channelMessageSchema = new mongoose.Schema({
  channelId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isi:         { type: String, default: '', maxlength: 4000 },
  mentions:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  editedAt:    { type: Date, default: null },
  attachments: [{
    url:      { type: String, required: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size:     { type: Number, required: true },
  }],
  reactions: [{
    emoji: { type: String, required: true },
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  }],
}, { timestamps: true });

channelMessageSchema.index({ channelId: 1, createdAt: 1 });

module.exports = mongoose.model('ChannelMessage', channelMessageSchema);
