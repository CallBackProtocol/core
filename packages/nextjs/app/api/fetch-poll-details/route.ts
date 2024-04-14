import { NextResponse } from "next/server";
import Feedback from "~~/Model/Feedback";
import Poll from "~~/Model/Poll";
import connectDB from "~~/connectDB";

export async function POST(req: Request) {
  let pollId;

  try {
    pollId = (await req.json()).pollId as string | undefined;
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

  if (!pollObj.result) {
    return NextResponse.json({ status: "open", poll: pollObj });
  }

  const feedbacks = await Feedback.find({ pollId: pollObj._id });

  // TODO: create incites from the feedbacks and poll data here

  return NextResponse.json({ status: "closed", poll: pollObj, feedbacks });
}
