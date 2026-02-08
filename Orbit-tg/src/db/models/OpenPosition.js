const mongoose = require('mongoose');

const openPositionSchema = new mongoose.Schema(
  {
    telegramId: {
      type: String,
      required: true,
      index: true,
    },
    walletAddress: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    walletAddressLower: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    positionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tickLower: { type: Number, required: true },
    tickUpper: { type: Number, required: true },
    tickRange: { type: Number, required: true },
    totalFeesEarned: { type: String, default: '0' },
    valueInMon: { type: String, default: '0' },
    valueInAusd: { type: String, default: '0' },
    lastRebalanceAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false },
  }
);

openPositionSchema.pre('validate', function () {
  if (this.walletAddress) {
    this.walletAddressLower = this.walletAddress.toLowerCase();
  }
});

openPositionSchema.index({ telegramId: 1, positionId: 1 });

module.exports = mongoose.model('OpenPosition', openPositionSchema);
