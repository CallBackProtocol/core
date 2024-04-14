import mongoose from "mongoose";

const Organization = new mongoose.Schema(
  {
    name: String,
    description: String,
    rewardContractAddress: String,
    chainId: String,
  },
  {
    timestamps: true,
  },
);

export default mongoose.models.Organization || mongoose.model("Organization", Organization);
