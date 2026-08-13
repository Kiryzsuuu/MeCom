const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  namaLengkap:   { type: String, required: true, trim: true },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  enik:          { type: String, default: null, sparse: true },
  jabatan:       { type: String, default: null },
  passwordHash:  { type: String, required: true },
  role:          { type: String, enum: ['direktur_coe', 'wakil_direktur_coe', 'sekretaris_coe', 'dosen'], required: true },
  direktoratId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Direktorat', default: null },
  statusAktif:   { type: Boolean, default: true },
  fotoProfil:    { type: String, default: null },
  notifEmail:    { type: Boolean, default: true },
  notifWa:       { type: Boolean, default: false },
  nomorWa:       { type: String, default: null },
  isFirstLogin:  { type: Boolean, default: false },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublic = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
