import { NextResponse } from "next/server";
import FeedbackRewards from "~~/Model/FeedbackRewards";
import Poll from "~~/Model/Poll";
import User from "~~/Model/User";
import connectDB from "~~/connectDB";

export async function POST(req: Request) {
  let phoneNumber;

  try {
    phoneNumber = (await req.json()).phoneNumber as string | undefined;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!phoneNumber) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  await connectDB();

  const user = await User.findOne({ phoneNumber });
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const feedbackRewards = await FeedbackRewards.find({ userId: user._id });

  const output: any[] = [];

  for (const reward of feedbackRewards) {
    const pollObj = await Poll.findById(reward.pollId);

    output.push(pollObj);
  }

  return NextResponse.json(output);
}
