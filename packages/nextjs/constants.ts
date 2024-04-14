import deployedContracts from "./contracts/deployedContracts";
import scaffoldConfig from "./scaffold.config";
import { Chain } from "@rainbow-me/rainbowkit";
import { ethers } from "ethers";
import { createPublicClient, createWalletClient, getContract, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const chain = scaffoldConfig.targetNetworks[0];

export const publicClient = createPublicClient({ chain, transport: http() });

export const serverAccount = privateKeyToAccount(process.env.SERVER_PRIVATE_KEY as `0x${string}`);
export const serverWalletClient = createWalletClient({
  chain: chain,
  transport: http(),
  key: process.env.SERVER_PRIVATE_KEY,
  account: serverAccount,
});

export const pollManagerContract = getContract({
  abi: deployedContracts[chain.id].PollManager.abi,
  address: deployedContracts[chain.id].PollManager.address,
  publicClient: publicClient,
  walletClient: serverWalletClient,
});

export const maciContract = getContract({
  abi: deployedContracts[chain.id].MACI.abi,
  address: deployedContracts[chain.id].MACI.address,
  publicClient: publicClient,
  walletClient: serverWalletClient,
});

export const deploymentBlock = BigInt(deployedContracts[chain.id].MACI.deploymentBlockNumber);
export const ethersProvider = new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0]);

export const supportedChains: Chain[] = [
  {
    id: 23295,
    name: "Sapphire",
    rpcUrls: {
      default: {
        http: ["https://testnet.sapphire.oasis.io"],
      },
      public: {
        http: ["https://testnet.sapphire.oasis.io"],
      },
    },
    nativeCurrency: {
      name: "Test",
      symbol: "TEST",
      decimals: 18,
    },
    network: "oasis-sapphire",
  },
] as const;
