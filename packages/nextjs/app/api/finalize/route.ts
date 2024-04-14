import { NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import Poll from "~~/Model/Poll";
import connectDB from "~~/connectDB";
import { pollManagerContract } from "~~/constants";
import { mergeMessages } from "~~/utils/mergeMessages";
import { mergeSignups } from "~~/utils/mergeSignups";

export async function POST(req: Request) {
  let pollId: string;
  try {
    pollId = (await req.json()).pollId;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!pollId) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  await connectDB();

  const pollObj = await Poll.findById(pollId);

  if (!pollObj) {
    return NextResponse.json({ error: "poll not found" }, { status: 404 });
  }

  if (pollObj.result) {
    return NextResponse.json({ message: "result already computed" }, { status: 208 });
  }

  try {
    const poll = await pollManagerContract.read.fetchPoll([pollObj.pollManagerId]);

    await mergeSignups({ pollContractAddress: poll.pollContracts.poll });
    await mergeMessages({ pollContractAddress: poll.pollContracts.poll });

    const cliDirectory = "/Users/yash/Development/buidlguidl/maci/cli";
    const dataFile = `${cliDirectory}/tally-${pollObj.maciPollId}.json`;
    execSync(
      `node ${cliDirectory}/build/ts/index.js genProofs \
    --privkey ${process.env.COORDINATOR_PRIVATE_KEY} \
    --poll-id ${pollObj.maciPollId} \
    --process-zkey ${cliDirectory}/zkeys/ProcessMessages_10-2-1-2_test/ProcessMessages_10-2-1-2_test.0.zkey \
    --tally-zkey ${cliDirectory}/zkeys/TallyVotes_10-1-2_test/TallyVotes_10-1-2_test.0.zkey \
    --tally-file ${dataFile} \
    --output proofs1/ \
    -tw ${cliDirectory}/zkeys/TallyVotes_10-1-2_test/TallyVotes_10-1-2_test_js/TallyVotes_10-1-2_test.wasm \
    -pw ${cliDirectory}/zkeys/ProcessMessages_10-2-1-2_test/ProcessMessages_10-2-1-2_test_js/ProcessMessages_10-2-1-2_test.wasm \
    -w true`,
      { encoding: "utf-8" },
    ); // the default is 'buffer'

    const data = JSON.parse(fs.readFileSync(dataFile).toString("utf-8"));

    const votesSerialized = JSON.stringify(data.results.tally.slice(0, 10).map(parseInt));

    pollObj.result = votesSerialized;
    await pollObj.save();
  } catch (err) {
    console.log(err);
    return NextResponse.json({ error: "something went wrong" }, { status: 500 });
  }

  return NextResponse.json({ message: "finalized the poll successfully" });
}
