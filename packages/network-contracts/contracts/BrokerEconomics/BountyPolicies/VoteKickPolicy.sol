// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Bounty.sol";
import "../IBrokerPoolFactory.sol";

// import "hardhat/console.sol";

contract VoteKickPolicy is IKickPolicy, Bounty {
    // struct LocalStorage {
    // }
    uint public constant FLAG_STAKE_WEI = 10 ether; // TODO: move to StreamrConstants?

    uint public constant REVIEWER_COUNT = 5;
    mapping (address => address) public flaggerPoolAddress;

    mapping (address => mapping (address => uint)) public reviewerState;
    mapping (address => address[]) public reviewers;
    mapping (address => uint) public votesForKick;
    mapping (address => address[]) public votersForKick;
    mapping (address => uint) public votesAgainstKick;
    mapping (address => address[]) public votersAgainstKick;

    // 10% of the target's stake that is in the risk of being slashed upon kick
    mapping (address => uint) public targetStakeWei;

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.AdminKickPolicy", address(this)));
    //     assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    // }

    function setParam(uint256) external {

    }

    /**
     * Start flagging process
     */
    function onFlag(address target, address myBrokerPool) external {
        require(globalData().stakedWei[myBrokerPool] > 0, "error_notStaked");
        require(globalData().stakedWei[target] > 0, "error_flagTargetNotStaked");

        // uint flagStakeWei = globalData().streamrConstants.flagStakeWei(); // TODO?
        globalData().committedStakeWei[myBrokerPool] += FLAG_STAKE_WEI;
        require(globalData().committedStakeWei[myBrokerPool] <= globalData().stakedWei[myBrokerPool], "error_notEnoughStake");
        flaggerPoolAddress[target] = myBrokerPool;

        targetStakeWei[target] = globalData().stakedWei[target] / 10;
        globalData().committedStakeWei[target] += targetStakeWei[target];

        // only secondarily select peers that are in the same bounty as the flagging target
        address[REVIEWER_COUNT] memory sameBountyPeers;
        uint sameBountyPeerCount = 0;

        IBrokerPoolFactory factory = IBrokerPoolFactory(globalData().streamrConstants.brokerPoolFactory());
        uint brokerPoolCount = factory.deployedBrokerPoolsLength();
        // uint randomBytes = block.difficulty; // see https://github.com/ethereum/solidity/pull/13759
        uint randomBytes = uint(uint160(target)) ^ 0x1235467890123457689012345678901234567890123546789012345678901234; // TODO temporary hack; polygon doesn't seem to support PREVRANDAO yet
        uint maxReviewersSearch = 20;
        assert(REVIEWER_COUNT <= 20); // to raise maxReviewersSearch, tweak >>= below, address gives 160 bits of "randomness"
        // assert(reviewerCount <= 32); // tweak >>= below, prevrandao gives 256 bits of randomness

        // primary selection: live peers that are not in the same bounty
        for (uint i = 0; i < maxReviewersSearch && reviewers[target].length < REVIEWER_COUNT; i++) {
            randomBytes >>= 8;
            uint index = randomBytes % brokerPoolCount;
            IBrokerPool pool = factory.deployedBrokerPools(index);
            address poolAddress = address(pool);
            if (poolAddress == _msgSender() || poolAddress == address(target)
                || reviewerState[target][poolAddress] != 0) {
                // console.log(index, "skipping", peer);
                continue;
            }
            // TODO: check is broker live
            if (globalData().stakedWei[address(pool)] > 0) {
                if (sameBountyPeerCount + reviewers[target].length < REVIEWER_COUNT) {
                    sameBountyPeers[sameBountyPeerCount++] = poolAddress;
                    reviewerState[target][poolAddress] = 10; // mark peer as "selected to the secondary selection list"
                }
                // console.log(index, "in same bounty", peer);
                continue;
            }
            // console.log(index, "selecting", peer);
            reviewerState[target][poolAddress] = 1;
            emit ReviewRequest(poolAddress, this, target);
            reviewers[target].push(poolAddress);
        }

        // secondary selection: peers from the same bounty
        for (uint i = 0; i < sameBountyPeerCount; i++) {
            address peer = sameBountyPeers[i];
            if (reviewerState[target][peer] == 1) {
                // console.log("already selected", peer);
                continue;
            }
            if (reviewers[target].length >= REVIEWER_COUNT) {
                reviewerState[target][peer] = 0; // mark peer as "not selected"
                // console.log("not selecting", peer);
                continue;
            }
            // console.log("selecting from same bounty", peer);
            reviewerState[target][peer] = 1;
            emit ReviewRequest(peer, this, target);
            reviewers[target].push(peer);
        }
        require(reviewers[target].length > 0, "error_notEnoughReviewers");
    }

    /**
     * Tally votes and trigger resolution
     */
    function onVote(address target, bytes32 voteData) external {
        address voter = _msgSender(); // ?
        require(reviewerState[target][voter] != 0, "error_reviewersOnly");
        require(reviewerState[target][voter] != 2, "error_alreadyVoted");
        uint vote = uint(voteData) & 0x1;
        assert (vote == 0 || vote == 1);
        reviewerState[target][voter] = 2;
        // reviewers[target].push(voter);
        uint result = 0;
        uint reviewerCount = reviewers[target].length;
        if (vote == 1) {
            votesForKick[target]++;
            votersForKick[target].push(voter);
            if (votesForKick[target] > reviewerCount / 2) {
                result = 1;
            }
        } else {
            votesAgainstKick[target]++;
            votersAgainstKick[target].push(voter);
            if (votesAgainstKick[target] > reviewerCount / 2) {
                result = 2;
            }
        }
        if (result > 0) {
            uint rewardWei = 1 ether; // globalData().streamrConstants.reviewerRewardWei();
            address flagger = flaggerPoolAddress[target];
            if (globalData().committedStakeWei[flagger] > 0) {
                globalData().committedStakeWei[flagger] -= FLAG_STAKE_WEI;
            }
            globalData().committedStakeWei[target] -= targetStakeWei[target];
            uint slashingWei = globalData().stakedWei[target] / 10; // TODO: add to streamrConstants?
            if (result == 1) { // kick
                uint flaggerRewardWei = 1 ether; // TODO: add to streamrConstants?
                uint leftOverWei = slashingWei - flaggerRewardWei - rewardWei * reviewerCount;
                _slash(target, slashingWei); // leftovers are added to sponsorship
                payReviewers(votersForKick[target]);
                _addSponsorship(address(this), leftOverWei);
                _removeBroker(target);
                emit BrokerKicked(target, slashingWei);
                token.transfer(flagger, flaggerRewardWei);
            } else if (result == 2) { // false flag, not kick
                // uint flagStakeWei = globalData().streamrConstants.flagStakeWei(); // TODO?
                uint leftOverWei = FLAG_STAKE_WEI - rewardWei * reviewerCount;
                _slash(flagger, FLAG_STAKE_WEI);
                payReviewers(votersAgainstKick[target]);
                _addSponsorship(address(this), leftOverWei);
            }
            delete votesForKick[target];
            delete votesAgainstKick[target];
            delete votersForKick[target];
            delete votersAgainstKick[target];
            delete targetStakeWei[target];
        }
    }

    function onCancelFlag(address target, address myBrokerPool) external {
        require(flaggerPoolAddress[target] == myBrokerPool, "error_notFlagger");
        payReviewers(votersForKick[target]);
        payReviewers(votersAgainstKick[target]);
        globalData().committedStakeWei[flaggerPoolAddress[target]] -= FLAG_STAKE_WEI;
        globalData().committedStakeWei[target] -= targetStakeWei[target];
        delete votesForKick[target];
        delete votesAgainstKick[target];
        delete votersForKick[target];
        delete votersAgainstKick[target];
        delete targetStakeWei[target];
    }

    function payReviewers(address[] memory votersToPay) internal {
        uint rewardWei = 1 ether; // TODO: add to streamrConstants?
        for (uint i = 0; i < votersToPay.length; i++) {
            // console.log("paying reviewer %s", votersToPay[i]);
            token.transfer(votersToPay[i], rewardWei);
        }
    }
}
