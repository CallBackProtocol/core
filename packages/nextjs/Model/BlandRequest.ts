import mongoose from "mongoose";

const BlandRequest = new mongoose.Schema(
  {
    pollId: mongoose.Types.ObjectId,
    requestId: String,
    fulfilled: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.BlandRequest || mongoose.model("BlandRequest", BlandRequest);
