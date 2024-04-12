import { NextResponse } from "next/server";
import OpenAI from "openai";
import BlandRequest from "~~/Model/BlandRequest";
import connectDB from "~~/connectDB";

export async function POST(req: Request) {
  let call_id, completed, concatenated_transcript;

  try {
    const body = await req.json();

    call_id = body.call_id;
    completed = body.completed;
    concatenated_transcript = body.concatenated_transcript;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!call_id || !completed || !concatenated_transcript)
    return NextResponse.json({ error: "invalid body" }, { status: 409 });

  if (!completed) return NextResponse.json({ error: "call not completed yet" }, { status: 400 });

  await connectDB();
  const blandRequest = await BlandRequest.findOne({ requestId: call_id });

  if (blandRequest.fulfilled) {
    return NextResponse.json({ error: "request already fulfilled" }, { status: 400 });
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

  blandRequest.fulfilled = true;
  await blandRequest.save();

  console.log(rating, feedback);

  return NextResponse.json({ message: "Hello World" });
}
