import mongoose from "mongoose";

const User = new mongoose.Schema(
  {
    phoneNumber: String,
    maciSecretKey: String,
    walletPrivateKey: String
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.User || mongoose.model("User", User);
