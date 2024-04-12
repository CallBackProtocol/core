import { NextResponse } from "next/server";
import axios from "axios";
import BlandRequest from "~~/Model/BlandRequest";
import Poll from "~~/Model/Poll";
import connectDB from "~~/connectDB";

export async function POST(req: Request) {
  let name, description, phoneNumbers, expiry, reward;

  try {
    const body = await req.json();

    name = body.name;
    description = body.description;
    phoneNumbers = body.phoneNumbers;
    expiry = body.expiry;
    reward = body.reward;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!name || !description || !phoneNumbers || !expiry || !reward)
    return NextResponse.json({ error: "invalid body" }, { status: 409 });

  await connectDB();

  // create a api object for the bland api
  // Headers
  const headers = {
    Authorization: process.env.BLAND_API_KEY,
  };

  const poll = new Poll({
    name: name,
    description,
    phoneNumbers,
    expiry: new Date(),
    reward,
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

    console.log(response);
  }

  console.log({ name, description, phoneNumbers, expiry, reward });

  return NextResponse.json({ message: "Hello World" });
}
