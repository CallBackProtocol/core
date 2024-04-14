import { Keypair } from "@se-2/hardhat/maci-ts/domainobjs";
import { generatePrivateKey } from "viem/accounts";
import User from "~~/Model/User";
import connectDB from "~~/connectDB";

export async function getOrCreateUserWallets(phoneNumber: string) {
  await connectDB();

  let user = await User.findOne({ phoneNumber });
  if (!user) {
    const maciKeyPair = new Keypair();
    const maciSecretKey = maciKeyPair.privKey.serialize();

    const walletPrivateKey = generatePrivateKey();

    user = new User({
      phoneNumber,
      maciSecretKey,
      walletPrivateKey,
    });

    await user.save();
  }

  return user;
}
