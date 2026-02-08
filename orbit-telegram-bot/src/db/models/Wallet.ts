import mongoose, { Schema, model } from "mongoose";

export interface IWalletDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  address: string;
  /** Private key hex (with or without 0x), stored in plain text */
  privateKey: string;
  isCustodial: boolean;
  chainId: number;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<IWalletDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    address: { type: String, required: true },
    privateKey: { type: String, required: true },
    isCustodial: { type: Boolean, default: true },
    chainId: { type: Number, required: true },
  },
  {
    timestamps: true,
    collection: "wallets",
  }
);

walletSchema.index({ userId: 1 });
walletSchema.index({ address: 1, chainId: 1 }, { unique: true });

export const Wallet = model<IWalletDoc>("Wallet", walletSchema);
