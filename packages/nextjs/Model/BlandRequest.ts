import mongoose from "mongoose";

const BlandRequest = new mongoose.Schema(
  {
    pollId: mongoose.Types.ObjectId,
    requestId: String,
    fulfilled: Boolean,
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.BlandRequest || mongoose.model("BlandRequest", BlandRequest);
