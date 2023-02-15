// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Bounty.sol";
import "../BrokerPoolFactory.sol";

contract VoteKickPolicy is IKickPolicy, Bounty {
    // struct LocalStorage {
    // }

    uint constant reviewerCount = 5;
    mapping (address => address) flaggerAddress;
    mapping (address => mapping (address => uint)) reviewerState;
    mapping (address => address[]) reviewers;
    mapping (address => uint) votesForKick;
    mapping (address => uint) votesAgainstKick;

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.AdminKickPolicy", address(this)));
    //     assembly {data.slot := storagePosition}
    // }

    function setParam(uint256) external {

    }

    /**
     * Start flagging process
     */
    function onFlag(address targetBrokerPool, address myBrokerPool) external {
        require(BrokerPool(myBrokerPool).broker() == _msgSender(), "error_wrongBrokerPool"); // TODO replace with BrokerPoolInterfa
        require(globalData().stakedWei[myBrokerPool] > 0, "error_notStaked");
        require(globalData().stakedWei[targetBrokerPool] > 0, "error_flagTargetNotStaked");

        uint flagStakeWei = 10 ether; // globalData().streamrConstants.flagStakeWei(); // TODO?
        globalData().committedStakeWei[myBrokerPool] += flagStakeWei;
        require(globalData().committedStakeWei[myBrokerPool] <= globalData().stakedWei[myBrokerPool], "error_notEnoughStake");

        BrokerPoolFactory factory = BrokerPoolFactory(globalData().streamrConstants.brokerPoolFactory());
        uint brokerPoolCount = factory.deployedBrokerPoolsLength();
        // uint randomBytes = block.difficulty; // see https://github.com/ethereum/solidity/pull/13759
        uint randomBytes = uint(uint160(targetBrokerPool)) ^ 0x1235467890123457689012345678901234567890123546789012345678901234; // TODO temporary hack; polygon doesn't seem to support PREVRANDAO yet
        assert(reviewerCount <= 20); // tweak >>= below, address gives 160 bits of "randomness"
        // assert(reviewerCount <= 32); // tweak >>= below, prevrandao gives 256 bits of randomness
        uint reviewersToPick = reviewerCount < brokerPoolCount - 2 ? reviewerCount : brokerPoolCount - 2;

        while(reviewers[targetBrokerPool].length < reviewersToPick) {
            randomBytes >>= 8;
            BrokerPool pool = factory.deployedBrokerPools((randomBytes & 0xffff) % brokerPoolCount);
            address peer = pool.broker(); // TODO: via BrokerPool or directly?
            if (peer == _msgSender() || peer == BrokerPool(targetBrokerPool).broker()) {
                continue;
            }
            // TODO: check is broker live
            // TODO: check reviewerState[broker][pool] == 0
            reviewerState[targetBrokerPool][peer] = 1;
            emit ReviewRequest(peer, this, targetBrokerPool);
            reviewers[targetBrokerPool].push(peer);
        }
    }

    function onCancelFlag(address) external {
        // TODO
    }

    function onKick(address) external {
        // does nothing in this policy? or should admin be able to kick?
    }

    /**
     * Tally votes and trigger resolution
     */
    function onVote(address broker, bytes32 voteData) external {
        address voter = _msgSender(); // ?
        require(reviewerState[broker][voter] != 0, "error_reviewersOnly");
        require(reviewerState[broker][voter] != 2, "error_alreadyVoted");
        uint vote = uint(voteData) & 0x1;
        assert (vote == 0 || vote == 1);
        reviewerState[broker][voter] = 2;
        // reviewers[broker].push(voter);
        uint result = 0;
        if (vote == 1) {
            votesForKick[broker]++;
            if (votesForKick[broker] > reviewerCount / 2) {
                result = 1;
            }
        } else {
            votesAgainstKick[broker]++;
            if (votesAgainstKick[broker] > reviewerCount / 2) {
                result = 2;
            }
        }
        if (result > 0) {
            uint rewardWei = 1 ether; // globalData().streamrConstants.reviewerRewardWei();
            for (uint i = 0; i < reviewers[broker].length; i++) {
                token.transfer(reviewers[broker][i], rewardWei);
            }
            address flagger = flaggerAddress[broker];
            globalData().committedStakeWei[flagger] -= 10 ether;
            delete votesForKick[broker];
            delete votesAgainstKick[broker];
            if (result == 1) { // kick
                uint slashingWei = globalData().stakedWei[broker] / 10; // TODO: add to streamrConstants?
                uint flaggerRewardWei = 1 ether; // TODO: add to streamrConstants?
                uint leftOverWei = slashingWei - flaggerRewardWei - rewardWei * reviewerCount;
                _removeBroker(broker, leftOverWei); // leftovers are added to sponsorship
                emit BrokerKicked(broker, slashingWei);
            }
            if (result == 2) { // false flag, not kick
                uint flagStakeWei = 10 ether; // TODO add to globalData().streamrConstants.flagStakeWei();
                _slash(flagger, flagStakeWei);
            }
        }
    }
}
