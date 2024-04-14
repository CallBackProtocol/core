import { NextResponse } from "next/server";
import { createPublicClient, getContract, http } from "viem";
import FeedbackRewards from "~~/Model/FeedbackRewards";
import Organization from "~~/Model/Organization";
import Poll from "~~/Model/Poll";
import User from "~~/Model/User";
import RewardToken from "~~/abi/RewardToken";
import { serverWalletClient, supportedChains } from "~~/constants";

export async function POST(req: Request) {
  let pollId, phoneNumber, userAddress;

  try {
    const body = await req.json();

    pollId = body.pollId;
    phoneNumber = body.phoneNumber;
    userAddress = body.userAddress;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!pollId || !phoneNumber || !userAddress) return NextResponse.json({ error: "invalid body" }, { status: 409 });

  const poll = await Poll.findById(pollId);
  if (!poll) {
    return NextResponse.json({ error: "poll not found" }, { status: 404 });
  }

  const user = await User.findOne({ phoneNumber });
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const feedbackReward = await FeedbackRewards.findOne({ pollId, userId: user._id });
  if (!feedbackReward) {
    return NextResponse.json({ error: "user not submitted the poll" }, { status: 400 });
  }

  const organization = await Organization.findById(poll.organizationId);

  const chain = supportedChains.filter(chain => chain.id === organization.chainId)[0];
  const publicClientChainSpecific = createPublicClient({ chain, transport: http() });
  const rewardTokenContract = getContract({
    abi: RewardToken,
    address: organization.rewardContractAddress,
    publicClient: publicClientChainSpecific,
  });

  const hash = await rewardTokenContract.read.getMessageHash([userAddress, poll.maciPollId]);

  const signature = serverWalletClient.signMessage({ message: hash });
  return NextResponse.json({ signature });
}
