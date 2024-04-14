import { MaciState, STATE_TREE_ARITY } from "@se-2/hardhat/maci-ts/core";
import { Keypair, Message, PrivKey, PubKey } from "@se-2/hardhat/maci-ts/domainobjs";
import assert from "assert";
import { Address, getContract } from "viem";
import PollAbi from "~~/abi/Poll";
import { deploymentBlock, maciContract, publicClient } from "~~/constants";

export interface Action {
  type: string;
  data: Partial<{
    pubKey: PubKey;
    encPubKey: PubKey;
    message: Message;
    voiceCreditBalance: number;
    timestamp: number;
    stateIndex: number;
    numSrQueueOps: number;
    pollId: bigint;
    pollAddr: string;
    stateRoot: bigint;
    messageRoot: bigint;
  }>;
  blockNumber: bigint;
  transactionIndex: number;
}

export function sortActions(actions: Action[]): Action[] {
  return actions.slice().sort((a, b) => {
    if (a.blockNumber > b.blockNumber) {
      return 1;
    }

    if (a.blockNumber < b.blockNumber) {
      return -1;
    }

    if (a.transactionIndex > b.transactionIndex) {
      return 1;
    }

    if (a.transactionIndex < b.transactionIndex) {
      return -1;
    }

    return 0;
  });
}

export async function genMACIState({ pollContractAddress }: { pollContractAddress: Address }) {
  const coordinatorKeypair = new Keypair(PrivKey.deserialize(process.env.COORDINATOR_PRIVATE_KEY || ""));
  const stateTreeDepth = (await maciContract.read.stateTreeDepth()) as number;

  const maciState = new MaciState(stateTreeDepth);

  assert(stateTreeDepth === maciState.stateTreeDepth);

  const lastBlock = await publicClient.getBlockNumber();

  const deployPollLogs = await maciContract.getEvents.DeployPoll(
    {},
    { fromBlock: deploymentBlock, toBlock: lastBlock },
  );
  const signUpLogs = await maciContract.getEvents.SignUp({}, { fromBlock: deploymentBlock - 1n, toBlock: lastBlock });

  console.log(signUpLogs);

  let actions: Action[] = [];

  signUpLogs.forEach(log => {
    actions.push({
      type: "SignUp",
      blockNumber: log.blockNumber,
      transactionIndex: log.transactionIndex,
      data: {
        stateIndex: Number(log.args._stateIndex),
        pubKey: new PubKey([log.args._userPubKeyX || 0n, log.args._userPubKeyY || 0n]),
        voiceCreditBalance: Number(log.args._voiceCreditBalance),
        timestamp: Number(log.args._timestamp),
      },
    });
  });

  const pollContractAddresses = new Map();
  let includesPollAddress = false;
  let pollId = 0n;

  deployPollLogs.forEach(log => {
    const pollAddr = log.args.pollAddr?.poll;
    actions.push({
      type: "DeployPoll",
      blockNumber: log.blockNumber,
      transactionIndex: log.transactionIndex,
      data: {
        pollId: log.args._pollId,
        pollAddr,
        pubKey: new PubKey([log.args._coordinatorPubKeyX || 0n, log.args._coordinatorPubKeyY || 0n]),
      },
    });

    if (pollContractAddress.toLowerCase() === pollAddr?.toLowerCase()) {
      includesPollAddress = true;
      pollId = log.args._pollId as bigint;
    }

    pollContractAddresses.set(log.args._pollId, pollAddr);
  });

  assert(includesPollAddress, "Error: the specified pollId does not exist on-chain");

  // const pollContractAddress = pollContractAddresses.get(0n);
  const pollContract = getContract({ abi: PollAbi, address: pollContractAddress, publicClient });

  const coordinatorPubKeyOnChain = await pollContract.read.coordinatorPubKey();

  assert(coordinatorPubKeyOnChain[0].toString() === coordinatorKeypair.pubKey.rawPubKey[0].toString());
  assert(coordinatorPubKeyOnChain[1].toString() === coordinatorKeypair.pubKey.rawPubKey[1].toString());

  const dd = await pollContract.read.getDeployTimeAndDuration();
  const deployTime = Number(dd[0]);
  const duration = Number(dd[1]);
  const onChainMaxValues = await pollContract.read.maxValues();
  const onChainTreeDepths = await pollContract.read.treeDepths();

  const maxValues = {
    maxMessages: Number(onChainMaxValues[0]),
    maxVoteOptions: Number(onChainMaxValues[1]),
  };
  const treeDepths = {
    intStateTreeDepth: Number(onChainTreeDepths[0]),
    messageTreeDepth: Number(onChainTreeDepths[1]),
    messageTreeSubDepth: Number(onChainTreeDepths[2]),
    voteOptionTreeDepth: Number(onChainTreeDepths[3]),
  };
  const batchSizes = {
    tallyBatchSize: STATE_TREE_ARITY ** Number(onChainTreeDepths[0]),
    subsidyBatchSize: STATE_TREE_ARITY ** Number(onChainTreeDepths[0]),
    messageBatchSize: STATE_TREE_ARITY ** Number(onChainTreeDepths[2]),
  };

  const publishMessageLogs = await pollContract.getEvents.PublishMessage({ fromBlock: deploymentBlock });
  const topupLogs = await pollContract.getEvents.TopupMessage({ fromBlock: deploymentBlock });
  // const mergeMaciStateAqSubRootsLogs = await pollContract.getEvents.MergeMaciStateAqSubRoots(
  //   {},
  //   { fromBlock: deploymentBlock },
  // );
  // const mergeMaciStateAqLogs = await pollContract.getEvents.MergeMaciStateAq({}, { fromBlock: deploymentBlock });
  const mergeMessageAqSubRootsLogs = await pollContract.getEvents.MergeMessageAqSubRoots(
    {},
    { fromBlock: deploymentBlock },
  );
  const mergeMessageAqLogs = await pollContract.getEvents.MergeMessageAq({}, { fromBlock: deploymentBlock });

  publishMessageLogs.forEach(log => {
    if (log.args._message && log.args._encPubKey) {
      const message = new Message(BigInt(log.args._message.msgType), log.args._message.data as any);
      const encPubKey = new PubKey([log.args._encPubKey.x, log.args._encPubKey.y]);

      actions.push({
        type: "PublishMessage",
        blockNumber: log.blockNumber,
        transactionIndex: log.transactionIndex,
        data: {
          message,
          encPubKey,
        },
      });
    }
  });

  topupLogs.forEach(log => {
    if (log.args._message) {
      const message = new Message(BigInt(log.args._message.msgType), log.args._message.data as any);
      actions.push({
        type: "TopupMessage",
        blockNumber: log.blockNumber,
        transactionIndex: log.transactionIndex,
        data: {
          message,
        },
      });
    }
  });

  mergeMessageAqSubRootsLogs.forEach(log => {
    if (log.args._numSrQueueOps) {
      const numSrQueueOps = Number(log.args._numSrQueueOps);
      actions.push({
        type: "MergeMessageAqSubRoots",
        blockNumber: log.blockNumber,
        transactionIndex: log.transactionIndex,
        data: {
          numSrQueueOps,
        },
      });
    }
  });

  // mergeMessageAqSubRootsLogs.forEach(log => {
  //   assert(!!log);
  //   const mutableLogs = { ...log, topics: [...log.topics] };
  //   const event = pollIface.parseLog(mutableLogs) as unknown as { args: { _numSrQueueOps: string } };

  //   const numSrQueueOps = Number(event.args._numSrQueueOps);
  //   actions.push({
  //     type: "MergeMessageAqSubRoots",
  //     blockNumber: log.blockNumber,
  //     transactionIndex: log.transactionIndex,
  //     data: {
  //       numSrQueueOps,
  //     },
  //   });
  // });

  mergeMessageAqLogs.forEach(log => {
    if (log.args._messageRoot) {
      const messageRoot = BigInt(log.args._messageRoot);
      actions.push({
        type: "MergeMessageAq",
        blockNumber: log.blockNumber,
        transactionIndex: log.transactionIndex,
        data: { messageRoot },
      });
    }
  });

  // mergeMessageAqLogs.forEach(log => {
  //   assert(!!log);
  //   const mutableLogs = { ...log, topics: [...log.topics] };
  //   const event = pollIface.parseLog(mutableLogs);

  //   const messageRoot = BigInt((event?.args as unknown as { _messageRoot: string })._messageRoot);
  //   actions.push({
  //     type: "MergeMessageAq",
  //     blockNumber: log.blockNumber,
  //     transactionIndex: log.transactionIndex,
  //     data: { messageRoot },
  //   });
  // });

  // // Sort actions
  actions = sortActions(actions);

  console.log(actions);

  // // Reconstruct MaciState in order
  actions.forEach(action => {
    console.log("action: ", action);
    switch (true) {
      case action.type === "SignUp": {
        const { pubKey, voiceCreditBalance, timestamp } = action.data;
        console.log("C");

        maciState.signUp(pubKey!, BigInt(voiceCreditBalance!), BigInt(timestamp!));
        console.log("D");
        break;
      }

      case action.type === "DeployPoll" && action.data.pollAddr === pollContractAddress: {
        console.log("A");
        maciState.deployPoll(
          BigInt(deployTime + duration),
          maxValues,
          treeDepths,
          batchSizes.messageBatchSize,
          coordinatorKeypair,
        );
        console.log("B");
        break;
      }

      case action.type === "DeployPoll" && action.data.pollAddr !== pollContractAddress: {
        maciState.deployNullPoll();
        break;
      }

      case action.type === "PublishMessage": {
        const { encPubKey, message } = action.data;
        maciState.polls.get(pollId)?.publishMessage(message!, encPubKey!);
        break;
      }

      case action.type === "TopupMessage": {
        const { message } = action.data;
        maciState.polls.get(pollId)?.topupMessage(message!);
        break;
      }

      // ensure that the message root is correct (i.e. all messages have been published offchain)
      case action.type === "MergeMessageAq": {
        console.log(maciState.polls.get(pollId)?.messageTree.root.toString());
        console.log(action.data.messageRoot?.toString());
        assert(maciState.polls.get(pollId)?.messageTree.root.toString() === action.data.messageRoot?.toString());
        break;
      }

      default:
        break;
    }
  });

  // // Set numSignUps
  const numSignUpsAndMessages = await pollContract.read.numSignUpsAndMessages();
  console.log(numSignUpsAndMessages);

  const poll = maciState.polls.get(pollId);

  // // ensure all messages were recorded
  assert(Number(numSignUpsAndMessages[1]) === poll?.messages.length);
  // set the number of signups
  poll.updatePoll(numSignUpsAndMessages[0]);

  // // we need to ensure that the stateRoot is correct
  assert(poll.stateTree?.root.toString() === (await pollContract.read.mergedStateRoot()).toString());

  maciState.polls.set(pollId, poll);

  return maciState;
}
