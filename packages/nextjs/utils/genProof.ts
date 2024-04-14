import { useQuadraticVoting } from "@se-2/hardhat/constants";
import { extractVk, verifyProof } from "@se-2/hardhat/maci-ts/circuits";
import { CircuitInputs } from "@se-2/hardhat/maci-ts/core";
import { genTreeCommitment, hash3, hashLeftRight } from "@se-2/hardhat/maci-ts/crypto";
import { Keypair, PrivKey } from "@se-2/hardhat/maci-ts/domainobjs";
import { BigNumberish } from "@se-2/hardhat/maci-ts/domainobjs/types";
import { genMaciStateFromContract } from "@se-2/hardhat/maci-ts/ts";
import { Proof } from "@se-2/hardhat/maci-ts/ts/types";
import { asHex } from "@se-2/hardhat/maci-ts/ts/utils";
import fs from "fs";
import { groth16 } from "snarkjs";
import { getContract } from "viem";
import AccQueueAbi from "~~/abi/AccQueue";
import PollAbi from "~~/abi/Poll";
import {
  deploymentBlock,
  ethersProvider,
  maciContract,
  pollManagerContract,
  publicClient,
  serverWalletClient,
} from "~~/constants";

export const genProofs = async ({ pollContractAddress }: any) => {
  const tallyZkey = "./zkeys/TallyVotes_10-1-2_test/TallyVotes_10-1-2_test.0.zkey";
  const processZkey = "./zkeys/ProcessMessages_10-2-1-2_test/ProcessMessages_10-2-1-2_test.0.zkey";
  const processWasm =
    "./zkeys/ProcessMessages_10-2-1-2_test/ProcessMessages_10-2-1-2_test_js/ProcessMessages_10-2-1-2_test.wasm";
  const tallyWasm = "./zkeys/TallyVotes_10-1-2_test/TallyVotes_10-1-2_test_js/TallyVotes_10-1-2_test.wasm";

  console.log(fs.existsSync(tallyZkey));

  const pollId = await maciContract.read.getPollId([pollContractAddress]);
  const pollContract = getContract({
    abi: PollAbi,
    address: pollContractAddress,
    publicClient,
    walletClient: serverWalletClient,
  });

  // extract the rest of the verifying keys
  const processVk = await extractVk(processZkey);
  const tallyVk = await extractVk(tallyZkey);

  const coordinatorKeypair = new Keypair(PrivKey.deserialize(process.env.COORDINATOR_PRIVATE_KEY || ""));

  const extContracts = await pollContract.read.extContracts();
  const messageAqContractAddr = extContracts[1];
  const messageAqContract = getContract({
    abi: AccQueueAbi,
    address: messageAqContractAddr,
    publicClient,
    walletClient: serverWalletClient,
  });

  const messageTreeDepth = (await pollContract.read.treeDepths())[2];

  // build an off-chain representation of the MACI contract using data in the contract storage

  const [, , stateRoot, numSignups, messageRoot] = await Promise.all([
    maciContract.getEvents.SignUp({}, { fromBlock: deploymentBlock }).then(events => events[0]?.blockNumber ?? 0),
    maciContract.getEvents.DeployPoll({}, { fromBlock: deploymentBlock }).then(events => events[0]?.blockNumber ?? 0),
    maciContract.read.getStateAqRoot(),
    maciContract.read.numSignUps(),
    messageAqContract.read.getMainRoot([BigInt(messageTreeDepth)]),
  ]);

  let fromBlock = deploymentBlock;

  const defaultEndBlock = await Promise.all([
    pollContract.getEvents
      .MergeMessageAq({ _messageRoot: messageRoot }, { fromBlock })
      .then(events => Number(events[events.length - 1]?.blockNumber)),
    pollContract.getEvents
      .MergeMaciStateAq({ _stateRoot: stateRoot, _numSignups: numSignups }, { fromBlock })
      .then(events => Number(events[events.length - 1]?.blockNumber)),
  ]).then(blocks => Math.max(...blocks));

  const blocksPerBatch = 50;

  const maciState = await genMaciStateFromContract(
    ethersProvider,
    maciContract.address,
    coordinatorKeypair,
    pollId,
    Number(fromBlock),
    blocksPerBatch,
    defaultEndBlock,
  );

  const poll = maciState!.polls.get(pollId)!;

  const processProofs: Proof[] = [];
  const tallyProofs: Proof[] = [];

  // time how long it takes
  const startTime = Date.now();

  console.log(`Generating proofs of message processing...`);
  const { messageBatchSize } = poll.batchSizes;
  const numMessages = poll.messages.length;
  let totalMessageBatches = numMessages <= messageBatchSize ? 1 : Math.floor(numMessages / messageBatchSize);
  if (numMessages > messageBatchSize && numMessages % messageBatchSize > 0) {
    totalMessageBatches += 1;
  }

  // while we have unprocessed messages, process them
  while (poll.hasUnprocessedMessages()) {
    // process messages in batches
    const circuitInputs = poll.processMessages(pollId, useQuadraticVoting, true) as unknown as CircuitInputs;

    try {
      // generate the proof for this batch
      // eslint-disable-next-line no-await-in-loop
      const r = await groth16.fullProve(circuitInputs, processWasm, processZkey);
      // return { proof, publicSignals };
      // const r = await genProof({
      //   inputs: circuitInputs,
      //   zkeyPath: processZkey,
      //   useWasm,
      //   rapidsnarkExePath: rapidsnark,
      //   witnessExePath: processWitgen,
      //   wasmPath: processWasm,
      // });

      // verify it
      // eslint-disable-next-line no-await-in-loop
      const isValid = await verifyProof(r.publicSignals, r.proof, processVk);
      if (!isValid) {
        throw new Error("Generated an invalid proof");
      }

      const thisProof = {
        circuitInputs,
        proof: r.proof,
        publicInputs: r.publicSignals,
      };
      // save the proof
      processProofs.push(thisProof);

      console.log(`Progress: ${poll.numBatchesProcessed} / ${totalMessageBatches}`);
    } catch (error) {
      console.log((error as Error).message);
    }
  }

  const endTime = Date.now();

  console.log(`gen processMessage proof took ${(endTime - startTime) / 1000} seconds\n`);

  // tallying proofs
  console.log(`Generating proofs of vote tallying...`);
  const tallyStartTime = Date.now();

  const { tallyBatchSize } = poll.batchSizes;
  const numStateLeaves = poll.stateLeaves.length;
  let totalTallyBatches = numStateLeaves <= tallyBatchSize ? 1 : Math.floor(numStateLeaves / tallyBatchSize);
  if (numStateLeaves > tallyBatchSize && numStateLeaves % tallyBatchSize > 0) {
    totalTallyBatches += 1;
  }

  let tallyCircuitInputs: CircuitInputs;
  // tally all ballots for this poll
  while (poll.hasUntalliedBallots()) {
    // tally votes in batches
    tallyCircuitInputs = useQuadraticVoting
      ? (poll.tallyVotes() as unknown as CircuitInputs)
      : (poll.tallyVotesNonQv() as unknown as CircuitInputs);

    try {
      // generate the proof
      // eslint-disable-next-line no-await-in-loop
      const r = await groth16.fullProve(tallyCircuitInputs, tallyWasm, tallyZkey);
      // const r = await genProof({
      //   inputs: tallyCircuitInputs,
      //   zkeyPath: tallyZkey,
      //   useWasm,
      //   rapidsnarkExePath: rapidsnark,
      //   witnessExePath: tallyWitgen,
      //   wasmPath: tallyWasm,
      // });

      // verify it
      // eslint-disable-next-line no-await-in-loop
      const isValid = await verifyProof(r.publicSignals, r.proof, tallyVk);

      if (!isValid) {
        console.log("Generated an invalid tally proof");
      }

      const thisProof = {
        circuitInputs: tallyCircuitInputs,
        proof: r.proof,
        publicInputs: r.publicSignals,
      };

      // save it
      tallyProofs.push(thisProof);
      console.log(`Progress: ${poll.numBatchesTallied} / ${totalTallyBatches}`);
    } catch (error) {
      console.log((error as Error).message);
    }
  }

  // verify the results
  // Compute newResultsCommitment
  const newResultsCommitment = genTreeCommitment(
    poll.tallyResult,
    BigInt(asHex(tallyCircuitInputs!.newResultsRootSalt as BigNumberish)),
    poll.treeDepths.voteOptionTreeDepth,
  );

  // compute newSpentVoiceCreditsCommitment
  const newSpentVoiceCreditsCommitment = hashLeftRight(
    poll.totalSpentVoiceCredits,
    BigInt(asHex(tallyCircuitInputs!.newSpentVoiceCreditSubtotalSalt as BigNumberish)),
  );

  // get the tally contract address
  const pollManagerId = await pollManagerContract.read.pollIdByAddress([pollContractAddress]);
  const pollObj = await pollManagerContract.read.fetchPoll([pollManagerId]);
  const tallyContractAddress = pollObj.pollContracts.tally;

  let newPerVOSpentVoiceCreditsCommitment: bigint | undefined;
  let newTallyCommitment: bigint;

  // create the tally file data to store for verification later
  const tallyFileData = {
    pollId: pollId.toString(),
    isQuadratic: useQuadraticVoting,
    tallyAddress: tallyContractAddress,
    newTallyCommitment: asHex(tallyCircuitInputs!.newTallyCommitment as BigNumberish),
    results: {
      tally: poll.tallyResult.map(x => x.toString()),
      salt: asHex(tallyCircuitInputs!.newResultsRootSalt as BigNumberish),
      commitment: asHex(newResultsCommitment),
    },
    totalSpentVoiceCredits: {
      spent: poll.totalSpentVoiceCredits.toString(),
      salt: asHex(tallyCircuitInputs!.newSpentVoiceCreditSubtotalSalt as BigNumberish),
      commitment: asHex(newSpentVoiceCreditsCommitment),
    },
  };

  if (useQuadraticVoting) {
    // Compute newPerVOSpentVoiceCreditsCommitment
    newPerVOSpentVoiceCreditsCommitment = genTreeCommitment(
      poll.perVOSpentVoiceCredits,
      BigInt(asHex(tallyCircuitInputs!.newPerVOSpentVoiceCreditsRootSalt as BigNumberish)),
      poll.treeDepths.voteOptionTreeDepth,
    );

    // Compute newTallyCommitment
    newTallyCommitment = hash3([
      newResultsCommitment,
      newSpentVoiceCreditsCommitment,
      newPerVOSpentVoiceCreditsCommitment,
    ]);

    // update perVOSpentVoiceCredits in the tally file data
    (tallyFileData as any).perVOSpentVoiceCredits = {
      tally: poll.perVOSpentVoiceCredits.map(x => x.toString()),
      salt: asHex(tallyCircuitInputs!.newPerVOSpentVoiceCreditsRootSalt as BigNumberish),
      commitment: asHex(newPerVOSpentVoiceCreditsCommitment),
    };
  } else {
    newTallyCommitment = hashLeftRight(newResultsCommitment, newSpentVoiceCreditsCommitment);
  }

  // compare the commitments
  if (asHex(newTallyCommitment) === tallyFileData.newTallyCommitment) {
    console.log("The tally commitment is correct");
  } else {
    console.log("Error: the newTallyCommitment is invalid.");
  }

  const tallyEndTime = Date.now();

  console.log(`gen tally proof took ${(tallyEndTime - tallyStartTime) / 1000} seconds\n`);

  return tallyFileData;
};
