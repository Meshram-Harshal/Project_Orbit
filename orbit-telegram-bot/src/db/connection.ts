import mongoose from "mongoose";
import { MONGODB_URI } from "../config.js";

export async function connectDb(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
}
