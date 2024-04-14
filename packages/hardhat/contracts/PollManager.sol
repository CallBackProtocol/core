// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./maci-contracts/MACI.sol";
import { Params } from "./maci-contracts/utilities/Params.sol";
import { DomainObjs } from "./maci-contracts/utilities/DomainObjs.sol";

contract PollManager is Params, DomainObjs {
	struct PollData {
		uint256 id;
		uint256 maciPollId;
		string name;
		MACI.PollContracts pollContracts;
		uint256 startTime;
		uint256 endTime;
		string tallyJsonCID;
	}

	mapping(uint256 => PollData) internal polls;
	mapping(address => uint256) public pollIdByAddress; // poll address => poll id
	uint256 public totalPolls;

	MACI public maci;
	mapping(uint256 => address) public admins;

	TreeDepths public treeDepths;
	PubKey public coordinatorPubKey;
	address public verifier;
	address public vkRegistry;
	bool public isQv;

	event PollCreated(
		uint256 indexed pollId,
		uint256 indexed maciPollId,
		address indexed creator,
		MACI.PollContracts pollContracts,
		string name,
		uint256 startTime,
		uint256 endTime
	);

	event PollTallyCIDUpdated(
		uint256 indexed pollId,
		uint256 indexed maciPollId,
		string tallyJsonCID
	);

	modifier onlyOwner() {
		require(msg.sender == owner(), "only owner can call this function");
		_;
	}

	constructor(MACI _maci, bool _isQv) {
		maci = _maci;
		isQv = _isQv;
	}

	function owner() public view returns (address) {
		return maci.owner();
	}

	function setConfig(
		TreeDepths memory _treeDepths,
		PubKey memory _coordinatorPubKey,
		address _verifier,
		address _vkRegistry
	) public onlyOwner {
		treeDepths = _treeDepths;
		coordinatorPubKey = _coordinatorPubKey;
		verifier = _verifier;
		vkRegistry = _vkRegistry;
	}

	function createPoll(
		address admin,
		string calldata _name,
		uint256 _expiry
	) public onlyOwner {
		if (_expiry < block.timestamp) revert("expiry cannot be before now");

		// deploy the poll contracts
		MACI.PollContracts memory pollContracts = maci.deployPoll(
			_expiry - block.timestamp,
			treeDepths,
			coordinatorPubKey,
			verifier,
			vkRegistry,
			isQv
		);

		uint256 pollId = ++totalPolls;
		admins[pollId] = admin;

		pollIdByAddress[pollContracts.poll] = pollId;
		uint256 maciPollId = maci.getPollId(pollContracts.poll);

		// create poll
		polls[pollId] = PollData({
			id: pollId,
			maciPollId: maciPollId,
			name: _name,
			startTime: block.timestamp,
			endTime: _expiry,
			pollContracts: pollContracts,
			tallyJsonCID: ""
		});

		emit PollCreated(
			pollId,
			maciPollId,
			msg.sender,
			pollContracts,
			_name,
			block.timestamp,
			_expiry
		);
	}

	function updatePollTallyCID(
		uint256 _pollId,
		string calldata _tallyJsonCID
	) public onlyOwner {
		require(_pollId <= totalPolls && _pollId != 0, "poll does not exist");
		PollData storage poll = polls[_pollId];
		poll.tallyJsonCID = _tallyJsonCID;

		emit PollTallyCIDUpdated(_pollId, poll.maciPollId, _tallyJsonCID);
	}

	function fetchPolls(
		uint256 _page,
		uint256 _perPage,
		bool _ascending
	) public view returns (PollData[] memory polls_) {
		uint256 start = (_page - 1) * _perPage + 1;
		uint256 end = start + _perPage - 1;
		if (end > totalPolls) {
			end = totalPolls;
		}

		if (start > totalPolls) {
			return new PollData[](0);
		}

		polls_ = new PollData[](end - start + 1);

		uint256 index = 0;
		for (uint256 i = start; i <= end; i++) {
			uint256 pollIndex = i;
			if (!_ascending) {
				pollIndex = totalPolls - i + 1;
			}
			polls_[index++] = polls[pollIndex];
		}
	}

	function fetchPoll(
		uint256 _pollId
	) public view returns (PollData memory poll_) {
		require(_pollId <= totalPolls && _pollId != 0, "poll does not exist");
		return polls[_pollId];
	}
}
