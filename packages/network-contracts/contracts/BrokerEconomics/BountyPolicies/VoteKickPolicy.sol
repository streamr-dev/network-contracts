// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Bounty.sol";
import "../BrokerPoolFactory.sol";

// import "hardhat/console.sol";

contract VoteKickPolicy is IKickPolicy, Bounty {
    // struct LocalStorage {
    // }

    uint constant maxReviewerCount = 5;
    mapping (address => address) flaggerPoolAddress;

    mapping (address => mapping (address => uint)) reviewerState;
    mapping (address => address[]) reviewers;
    mapping (address => uint) votesForKick;
    mapping (address => address[]) votersForKick;
    mapping (address => uint) votesAgainstKick;
    mapping (address => address[]) votersAgainstKick;

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
        flaggerPoolAddress[targetBrokerPool] = myBrokerPool;

        BrokerPoolFactory factory = BrokerPoolFactory(globalData().streamrConstants.brokerPoolFactory());
        uint brokerPoolCount = factory.deployedBrokerPoolsLength();
        // uint randomBytes = block.difficulty; // see https://github.com/ethereum/solidity/pull/13759
        uint randomBytes = uint(uint160(targetBrokerPool)) ^ 0x1235467890123457689012345678901234567890123546789012345678901234; // TODO temporary hack; polygon doesn't seem to support PREVRANDAO yet
        assert(maxReviewerCount <= 20); // tweak >>= below, address gives 160 bits of "randomness"
        // assert(reviewerCount <= 32); // tweak >>= below, prevrandao gives 256 bits of randomness
        uint reviewerCount = maxReviewerCount < brokerPoolCount - 2 ? maxReviewerCount : brokerPoolCount - 2;
        uint maxReviewersSearch = 20;
        while(reviewers[targetBrokerPool].length < reviewerCount && maxReviewersSearch-- > 1) {
            randomBytes >>= 8;
            BrokerPool pool = factory.deployedBrokerPools((randomBytes) % brokerPoolCount);
            address peer = pool.broker(); // TODO: via BrokerPool or directly?
            if (peer == _msgSender() || peer == BrokerPool(targetBrokerPool).broker()
                || reviewerState[targetBrokerPool][peer] != 0) {
                continue;
            }
            // TODO: check is broker live
            reviewerState[targetBrokerPool][peer] = 1;
            emit ReviewRequest(peer, this, targetBrokerPool);
            reviewers[targetBrokerPool].push(peer);
        }
        require(reviewers[targetBrokerPool].length > 0, "error_notEnoughReviewers");
    }


    function onVote(address broker, bytes32 voteData) external {
        address voter = _msgSender(); // ?
        require(reviewerState[broker][voter] != 0, "error_reviewersOnly");
        require(reviewerState[broker][voter] != 2, "error_alreadyVoted");
        uint vote = uint(voteData) & 0x1;
        assert (vote == 0 || vote == 1);
        reviewerState[broker][voter] = 2;
        // reviewers[broker].push(voter);
        uint result = 0;
        uint reviewerCount = reviewers[broker].length;
        if (vote == 1) {
            votesForKick[broker]++;
            votersForKick[broker].push(voter);
            if (votesForKick[broker] > reviewerCount / 2) {
                result = 1;
            }
        } else {
            votesAgainstKick[broker]++;
            votersAgainstKick[broker].push(voter);
            if (votesAgainstKick[broker] > reviewerCount / 2) {
                result = 2;
            }
        }
        if (result > 0) {
            uint rewardWei = 1 ether; // globalData().streamrConstants.reviewerRewardWei();
            address flagger = flaggerPoolAddress[broker];
            globalData().committedStakeWei[flagger] -= 10 ether;
            uint slashingWei = globalData().stakedWei[broker] / 10; // TODO: add to streamrConstants?
            if (result == 1) { // kick
                uint flaggerRewardWei = 1 ether; // TODO: add to streamrConstants?
                uint leftOverWei = slashingWei - flaggerRewardWei - rewardWei * reviewerCount;
                token.transfer(flagger, flaggerRewardWei);
                _slash(broker, slashingWei); // leftovers are added to sponsorship
                payReviewers(broker, votersForKick[broker]);
                _addSponsorship(address(this), leftOverWei);
                _removeBroker(broker);
                emit BrokerKicked(broker, slashingWei);
            }
            if (result == 2) { // false flag, not kick
                uint flagStakeWei = 10 ether; // TODO add to globalData().streamrConstants.flagStakeWei();
                uint leftOverWei = flagStakeWei - rewardWei * reviewerCount;
                _slash(flagger, flagStakeWei);
                payReviewers(broker, votersAgainstKick[broker]);
                _addSponsorship(address(this), leftOverWei);
            }
            globalData().committedStakeWei[flaggerPoolAddress[flagger]] = 0;
            delete votesForKick[broker];
            delete votesAgainstKick[broker];
            delete votersForKick[broker];
            delete votersAgainstKick[broker];
        }
    }

    function onCancelFlag(address broker, address myBrokerPool) external {
        address flagger = _msgSender();
        require(BrokerPool(myBrokerPool).broker() == _msgSender(), "error_wrongBrokerPool"); // TODO replace with BrokerPoolInterfa
        require(flaggerPoolAddress[broker] == myBrokerPool, "error_notFlagger");
        payReviewers(_msgSender(), votersForKick[broker]);
        payReviewers(_msgSender(), votersAgainstKick[broker]);
        globalData().committedStakeWei[flaggerPoolAddress[flagger]] = 0;
        delete votesForKick[broker];
        delete votesAgainstKick[broker];
        delete votersForKick[broker];
        delete votersAgainstKick[broker];
    }

    function onKick(address) external {
        // does nothing in this policy? or should admin be able to kick?
    }

    function payReviewers(address broker, address[] memory votersToPay) internal {
        uint rewardWei = 1 ether; // TODO: add to streamrConstants?
        for (uint i = 0; i < votersToPay.length; i++) {
            // console.log("paying reviewer %s", votersToPay[i]);
            token.transfer(votersToPay[i], rewardWei);
        }
    }

    /**
     * Tally votes and trigger resolution
     */
}