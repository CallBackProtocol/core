import { NextResponse } from "next/server";
import axios from "axios";
import { createPublicClient, createWalletClient, decodeEventLog, getContract, http } from "viem";
import BlandRequest from "~~/Model/BlandRequest";
import Organization from "~~/Model/Organization";
import Poll from "~~/Model/Poll";
import RewardToken from "~~/abi/RewardToken";
import connectDB from "~~/connectDB";
import { pollManagerContract, publicClient, serverAccount, supportedChains } from "~~/constants";

export async function POST(req: Request) {
  let name, description, phoneNumbers, expiry, reward, organizationId;

  try {
    const body = await req.json();

    name = body.name as string | undefined;
    description = body.description as string | undefined;
    phoneNumbers = body.phoneNumbers as string[] | undefined;
    expiry = body.expiry as number | undefined;
    reward = body.reward as string | undefined;
    organizationId = body.organizationId as string | undefined;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!name || !description || !phoneNumbers || !expiry || !reward || !organizationId)
    return NextResponse.json({ error: "invalid body" }, { status: 409 });

  await connectDB();

  // check if organization exists
  const org = await Organization.findById(organizationId);
  if (!org) {
    return NextResponse.json({ error: "unable to find organization" }, { status: 400 });
  }

  // create a api object for the bland api
  // Headers
  const headers = {
    Authorization: process.env.BLAND_API_KEY,
  };

  // create poll on the maci contract
  const tx = await pollManagerContract.write.createPoll([name, BigInt(expiry)]);
  const transaction = await publicClient.getTransactionReceipt({ hash: tx });

  const events: any[] = [];

  for (const log of transaction.logs) {
    try {
      events.push(decodeEventLog({ abi: pollManagerContract.abi, data: log.data, topics: log.topics }));
    } catch (e) {}
  }

  const pollCreatedEvent = events.filter(event => event.eventName === "PollCreated")[0];

  const poll = new Poll({
    name: name,
    description,
    phoneNumbers,
    expiry: new Date(expiry * 1000),
    reward,
    pollManagerId: Number(pollCreatedEvent.args.pollId),
    maciPollId: Number(pollCreatedEvent.args.maciPollId),
    organizationId,
  });

  await poll.save();

  for (const phoneNumber of phoneNumbers) {
    const webhoookUrl = `${req.url.split("/api")[0]}/api/webhook/bland`;
    console.log(phoneNumber);

    // Data
    const data = {
      phone_number: phoneNumber,
      from: null,
      task: `Our company has recently launched a product "${description}", your task is to get a rating about user's experience on the product (the rating should be numeric and between 1 and 10, 1 being the worst and 10 being the best), and depending upon the rating, ask the feedback from the user like what was good and bad about the product.`,
      model: "enhanced",
      language: "eng",
      voice: "maya",
      voice_settings: {},
      local_dialing: false,
      max_duration: 12,
      answered_by_enabled: false,
      wait_for_greeting: false,
      record: false,
      interruption_threshold: 50,
      temperature: null,
      transfer_list: {},
      metadata: {},
      start_time: null,
      request_data: {
        rating: "the numeric rating between 1 and 10",
        feedback: "the feedback of the user",
      },
      webhook: webhoookUrl,
    };

    // API request
    const response = (await axios.post("https://api.bland.ai/v1/calls", data, { headers })).data;

    const blankResponse = new BlandRequest({
      pollId: poll._id,
      requestId: response.call_id,
    });

    await blankResponse.save();
  }

  // update the reward on the smart contract
  const chain = supportedChains.filter(chain => chain.id === org.chainId)[0];
  const publicClientChainSpecific = createPublicClient({ chain, transport: http() });
  const walletClientChainSpecific = createWalletClient({
    chain,
    transport: http(),
    key: process.env.SERVER_PRIVATE_KEY,
    account: serverAccount,
  });
  const rewardTokenContract = getContract({
    abi: RewardToken,
    address: org.rewardContractAddress,
    publicClient: publicClientChainSpecific,
    walletClient: walletClientChainSpecific,
  });

  const txHash = await rewardTokenContract.write.createPollAndAddReward([
    pollCreatedEvent.args.maciPollId,
    BigInt(reward),
  ]);

  console.log({ name, description, phoneNumbers, expiry, reward, txHash });

  return NextResponse.json({ message: "The poll is created successfully" });
}
