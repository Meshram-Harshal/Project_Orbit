import mongoose, { Schema, model } from "mongoose";

export type PositionStatus = "active" | "closed";

export interface IPositionDoc {
  _id: mongoose.Types.ObjectId;
  walletId: mongoose.Types.ObjectId;
  pair: string;
  tokenId: string;
  tickLower: number;
  tickUpper: number;
  tickRange: number;
  status: PositionStatus;
  totalFeeEarnedWei: string;
  initialAmountWei: string;
  createdAt: Date;
  updatedAt: Date;
}

const positionSchema = new Schema<IPositionDoc>(
  {
    walletId: { type: Schema.Types.ObjectId, ref: "Wallet", required: true },
    pair: { type: String, required: true },
    tokenId: { type: String, required: true },
    tickLower: { type: Number, required: true },
    tickUpper: { type: Number, required: true },
    tickRange: { type: Number, required: true },
    status: { type: String, enum: ["active", "closed"], default: "active" },
    totalFeeEarnedWei: { type: String, default: "0" },
    initialAmountWei: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: "positions",
  }
);

positionSchema.index({ walletId: 1, status: 1 });
positionSchema.index({ status: 1 });

export const Position = model<IPositionDoc>("Position", positionSchema);
