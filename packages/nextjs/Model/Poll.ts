import mongoose from "mongoose";

const Poll = new mongoose.Schema(
  {
    name: String,
    description: String,
    phoneNumbers: [String],
    expiry: Date,
    reward: String,
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.Poll || mongoose.model("Poll", Poll);
