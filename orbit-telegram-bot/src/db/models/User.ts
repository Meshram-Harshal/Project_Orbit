import mongoose, { Schema, model } from "mongoose";

export interface IUserDoc {
  _id: mongoose.Types.ObjectId;
  telegramId: number;
  username?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUserDoc>(
  {
    telegramId: { type: Number, required: true, unique: true },
    username: { type: String, required: false },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

export const User = model<IUserDoc>("User", userSchema);
