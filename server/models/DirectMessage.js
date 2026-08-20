const mongoose = require('mongoose');

const directMessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isi:            { type: String, required: true, maxlength: 4000, trim: true },
  editedAt:       { type: Date, default: null },
}, { timestamps: true });

directMessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('DirectMessage', directMessageSchema);
