import mongoose from "mongoose";

const FeedbackRewards = new mongoose.Schema({
  pollId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
});

export default mongoose.models.FeedbackRewards || mongoose.model("FeedbackRewards", FeedbackRewards);
