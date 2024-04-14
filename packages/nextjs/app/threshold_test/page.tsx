"use client";

import { conditions, domains, encrypt } from "@nucypher/taco";
import { useWalletClient } from "wagmi";
import { walletClientToSigner } from "~~/utils/ethersAdaptor";

export default function ThresholdTest() {
  const { data: walletClient } = useWalletClient();
  const signer = walletClientToSigner(walletClient as any);

  console.log(signer);

  const message = "my secret message";

  async function encryptData() {
    if (!signer) return;

    const ownsNFT = new conditions.predefined.erc721.ERC721Ownership({
      contractAddress: "0x1e988ba4692e52Bc50b375bcC8585b95c48AaD77",
      parameters: [3591],
      chain: 80002,
    });
    const messageKit = await encrypt(signer.provider, domains.TESTNET, message, ownsNFT, 0, signer);

    console.log(messageKit);
  }

  return (
    <div>
      <button onClick={encryptData}>Encrypt</button>
    </div>
  );
}
