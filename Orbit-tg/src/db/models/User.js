const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    telegramId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    walletAddress: {
      type: String,
      required: true,
      trim: true,
    },
    walletAddressLower: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    encryptedPrivateKey: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    salt: { type: String, required: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false },
  }
);

userSchema.pre('validate', function () {
  if (this.walletAddress) {
    this.walletAddressLower = this.walletAddress.toLowerCase();
  }
});

module.exports = mongoose.model('User', userSchema);
