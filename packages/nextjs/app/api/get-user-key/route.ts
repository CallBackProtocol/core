import { NextResponse } from "next/server";
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

  return NextResponse.json({ key: user.walletPrivateKey });
}
