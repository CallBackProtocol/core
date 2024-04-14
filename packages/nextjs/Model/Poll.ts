import mongoose from "mongoose";

const Poll = new mongoose.Schema(
  {
    organizationId: mongoose.Types.ObjectId,
    name: String,
    description: String,
    phoneNumbers: [String],
    expiry: Date,
    reward: String,
    maciPollId: String,
    pollManagerId: String,
    result: String,
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.Poll || mongoose.model("Poll", Poll);
