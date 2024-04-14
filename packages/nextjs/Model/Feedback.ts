import mongoose from "mongoose";

const Feedback = new mongoose.Schema(
  {
    pollId: mongoose.Types.ObjectId,
    feedback: String,
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.Feedback || mongoose.model("Feedback", Feedback);
