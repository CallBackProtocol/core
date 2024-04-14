import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, decodeEventLog, getContract, http } from "viem";
import { getTransactionReceipt } from "viem/_types/actions/public/getTransactionReceipt";
import Organization from "~~/Model/Organization";
import connectDB from "~~/connectDB";
import { serverAccount, supportedChains } from "~~/constants";
import externalContracts from "~~/contracts/externalContracts";
import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";

export async function POST(req: Request) {
  let name: string, description: string, chainId: number, tokenName: string, tokenSymbol: string;

  try {
    const body = await req.json();

    name = body.name;
    description = body.description;
    chainId = body.chainId;
    tokenName = body.tokenName;
    tokenSymbol = body.tokenSymbol;
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 409 });
  }

  if (!name || !description || !chainId || !tokenName || !tokenSymbol)
    return NextResponse.json({ error: "invalid body" }, { status: 409 });

  const chain = supportedChains.filter(chain => chain.id === chainId)[0];
  if (!chain) {
    return NextResponse.json({ error: "network not supported" }, { status: 400 });
  }

  await connectDB();

  // deploy the contract on that particular chain
  const { address: rewardTokenFactoryAddress, abi: rewardTokenFactoryAbi } = (
    externalContracts as GenericContractsDeclaration
  )[chainId]["RewardTokenFactory"];
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({
    chain,
    transport: http(),
    key: process.env.SERVER_PRIVATE_KEY,
    account: serverAccount,
  });
  const rewardTokenFactory = getContract({
    abi: rewardTokenFactoryAbi,
    address: rewardTokenFactoryAddress,
    publicClient,
    walletClient,
  });

  const tx = await rewardTokenFactory.write.deployRewardToken([tokenName, tokenSymbol]);
  const transaction = await getTransactionReceipt(publicClient, { hash: tx });

  const events: any[] = [];

  for (const log of transaction.logs) {
    try {
      events.push(decodeEventLog({ abi: rewardTokenFactoryAbi, data: log.data, topics: log.topics }));
    } catch (e) {}
  }

  const rewardTokenDeployedEvent = events.filter(event => event.eventName === "RewardTokenDeployed")[0];

  const organizationObj = new Organization({
    name,
    description,
    chainId,
    rewardContractAddress: rewardTokenDeployedEvent.args.tokenContract,
    tokenName,
    tokenSymbol,
  });

  await organizationObj.save();

  return NextResponse.json({ organization: organizationObj });
}
