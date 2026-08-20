const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  nama:        { type: String, required: true, maxlength: 80, trim: true },
  deskripsi:   { type: String, default: '', maxlength: 300 },
  isPrivate:   { type: Boolean, default: false },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastRead:    { type: Map, of: Date, default: {} },
}, { timestamps: true });

channelSchema.index({ members: 1 });

module.exports = mongoose.model('Channel', channelSchema);
