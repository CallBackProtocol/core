import { NextResponse } from "next/server";
import { genRandomSalt } from "@se-2/hardhat/maci-ts/crypto";
import { Keypair, PCommand, PrivKey, PubKey } from "@se-2/hardhat/maci-ts/domainobjs";
import OpenAI from "openai";
import { getContract } from "viem";
import BlandRequest from "~~/Model/BlandRequest";
import Feedback from "~~/Model/Feedback";
import FeedbackRewards from "~~/Model/FeedbackRewards";
import Poll from "~~/Model/Poll";
import User from "~~/Model/User";
import PollAbi from "~~/abi/Poll";
import connectDB from "~~/connectDB";
import { deploymentBlock, maciContract, pollManagerContract, publicClient, serverWalletClient } from "~~/constants";
import { getOrCreateUserWallets } from "~~/utils/userWallet";

export async function POST(req: Request) {
  let call_id, completed, concatenated_transcript, to;

  try {
    const body = await req.json();

    call_id = body.call_id;
    completed = body.completed;
    concatenated_transcript = body.concatenated_transcript;
    to = body.to;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!call_id || !completed || !concatenated_transcript || !to)
    return NextResponse.json({ error: "invalid body" }, { status: 409 });

  if (!completed) return NextResponse.json({ error: "call not completed yet" }, { status: 400 });

  await connectDB();
  const blandRequest = await BlandRequest.findOne({ requestId: call_id });
  if (!blandRequest) {
    return NextResponse.json({ error: "request not found" }, { status: 400 });
  }

  const pollObj = await Poll.findById(blandRequest.pollId);

  if (!pollObj) {
    return NextResponse.json({ error: "poll not found" }, { status: 400 });
  }

  if (blandRequest.fulfilled) {
    return NextResponse.json({ error: "request already fulfilled" }, { status: 400 });
  }

  const userObj = await User.findOne({ phoneNumber: to });

  if (!userObj) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content:
          'This is a conversation between a chat assistant and a user.\nUser is rating from 1 to 10 about a product or service, and also giving a feedback on it, you need to provide me with a json object with the following format.\n{"rating": "number between 1 and 10", "feedback": "summary of the feedback from the user in first person"} or return {"error": true} if the user didn\'t provide the right response',
      },
      {
        role: "user",
        content: concatenated_transcript,
      },
    ],
    temperature: 1,
    max_tokens: 256,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });

  const { rating, feedback, error } = JSON.parse(response.choices[0].message.content as string);

  if (error) {
    return NextResponse.json({ message: "call rescheduled" });
  }

  const feedbackObj = new Feedback({
    pollId: blandRequest.pollId,
    feedback,
  });

  await feedbackObj.save();

  const feedbackrewardObj = new FeedbackRewards({
    pollId: blandRequest.pollId,
    userId: userObj._id,
  });

  feedbackrewardObj.save();

  blandRequest.fulfilled = true;
  await blandRequest.save();

  const user = await getOrCreateUserWallets(to);

  const { maciSecretKey } = user;

  const keypair = new Keypair(PrivKey.deserialize(maciSecretKey));

  // register user
  let signUpEvents = await maciContract.getEvents.SignUp(
    { _userPubKeyX: keypair.pubKey.rawPubKey[0], _userPubKeyY: keypair.pubKey.rawPubKey[1] },
    { fromBlock: deploymentBlock },
  );
  if (signUpEvents.length == 0) {
    await maciContract.write.signUp([keypair.pubKey.asContractParam(), "0x", "0x"]);
    signUpEvents = await maciContract.getEvents.SignUp(
      { _userPubKeyX: keypair.pubKey.rawPubKey[0], _userPubKeyY: keypair.pubKey.rawPubKey[1] },
      { fromBlock: deploymentBlock },
    );
  }

  if (signUpEvents.length == 0) {
    return NextResponse.json({ error: "something went wrong" }, { status: 500 });
  }

  const stateIndex = signUpEvents[0].args._stateIndex || 0n;

  const command: PCommand = new PCommand(
    stateIndex, // stateindex
    keypair.pubKey, // userMaciPubKey
    BigInt(rating - 1),
    1n,
    1n,
    BigInt(pollObj.maciPollId),
    genRandomSalt(),
  );

  const signature = command.sign(keypair.privKey);

  const encKeyPair = new Keypair();

  const coordinatorRawPubKey = await pollManagerContract.read.coordinatorPubKey();

  const coordinatorPubKey = new PubKey([coordinatorRawPubKey[0], coordinatorRawPubKey[1]]);

  const message = command.encrypt(signature, Keypair.genEcdhSharedKey(encKeyPair.privKey, coordinatorPubKey));

  const pollContract = getContract({
    abi: PollAbi,
    address: (await pollManagerContract.read.fetchPoll([BigInt(pollObj.pollManagerId)])).pollContracts.poll,
    publicClient: publicClient,
    walletClient: serverWalletClient,
  });

  const tx = await pollContract.write.publishMessage([message.asContractParam(), encKeyPair.pubKey.asContractParam()]);

  console.log(rating, feedback, message, tx);

  return NextResponse.json({ message: "Hello World" });
}
