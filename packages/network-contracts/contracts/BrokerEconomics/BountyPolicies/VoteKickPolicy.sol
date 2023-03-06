// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Bounty.sol";
import "../BrokerPoolFactory.sol";
import "../BrokerPool.sol";

// import "hardhat/console.sol";

contract VoteKickPolicy is IKickPolicy, Bounty {
    // TODO: move to StreamrConstants?
    uint public constant FLAG_STAKE_WEI = 10 ether;
    uint public constant REVIEWER_COUNT = 5;
    uint public constant REVIEW_PERIOD_SECONDS = 1 days;
    uint public constant VOTING_PERIOD_SECONDS = 1 hours;
    uint public constant REVIEWER_REWARD_WEI = 1 ether;
    uint public constant FLAGGER_REWARD_WEI = 1 ether;
    uint public constant PROTECTION_SECONDS = 1 hours; // can't be flagged again right after a no-kick result

    mapping (address => address) public flaggerPoolAddress;

    enum Reviewer {
        NOT_SELECTED,
        IS_SELECTED,
        VOTED_KICK,
        VOTED_NO_KICK,
        IS_SELECTED_SECONDARY
    }

    mapping (address => uint) public flagTimestamp;
    mapping (address => mapping (address => Reviewer)) public reviewerState;
    mapping (address => address[]) public reviewers;
    mapping (address => uint) public votesForKick;
    mapping (address => uint) public votesAgainstKick;
    mapping (address => uint) public protectionEndTimestamp; // can't be flagged again right after a no-kick result

    // 10% of the target's stake that is in the risk of being slashed upon kick
    mapping (address => uint) public targetStakeAtRiskWei;

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("agreement.storage.AdminKickPolicy", address(this)));
    //     assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    // }

    function setParam(uint256) external {

    }

    /**
     * Voting period starts after the review period ends
     * During review period, the target still gets a chance to resume working; and flagger gets a chance to cancel the flag
     **/
    function canVote(address target) internal view returns (bool) {
        // false if flagTimestamp[broker] == 0
        return block.timestamp > flagTimestamp[target] + REVIEW_PERIOD_SECONDS;  // solhint-disable-line not-rely-on-time
    }

    function voteEndTimestamp(address target) internal view returns (uint) {
        return flagTimestamp[target] + REVIEW_PERIOD_SECONDS + VOTING_PERIOD_SECONDS;
    }

    function getFlagData(address broker) override external view returns (uint flagData) {
        if (flagTimestamp[broker] == 0) {
            return 0;
        }
        return uint(bytes32(abi.encodePacked(
            uint160(flaggerPoolAddress[broker]),
            uint32(flagTimestamp[broker]),
            uint16(reviewers[broker].length),
            uint16(votesForKick[broker]),
            uint16(votesAgainstKick[broker])
            // uint16()
        )));
    }

    /**
     * Start flagging process
     */
    function onFlag(address target) external {
        address sender = _msgSender();
        require(flagTimestamp[target] == 0 && block.timestamp > protectionEndTimestamp[target], "error_cannotFlagAgain"); // solhint-disable-line not-rely-on-time
        require(globalData().stakedWei[sender] > FLAG_STAKE_WEI, "error_notEnoughStake");
        require(globalData().stakedWei[target] > 0, "error_flagTargetNotStaked");

        // uint flagStakeWei = globalData().streamrConstants.flagStakeWei(); // TODO?
        globalData().committedStakeWei[sender] += FLAG_STAKE_WEI;
        require(globalData().committedStakeWei[sender] <= globalData().stakedWei[sender] * 9/10, "error_notEnoughStake");
        flaggerPoolAddress[target] = sender;

        targetStakeAtRiskWei[target] = globalData().stakedWei[target] / 10;
        globalData().committedStakeWei[target] += targetStakeAtRiskWei[target];

        flagTimestamp[target] = block.timestamp; // solhint-disable-line not-rely-on-time

        // only secondarily select peers that are in the same bounty as the flagging target
        address[REVIEWER_COUNT] memory sameBountyPeers;
        uint sameBountyPeerCount = 0;

        BrokerPoolFactory factory = BrokerPoolFactory(globalData().streamrConstants.brokerPoolFactory());
        uint brokerPoolCount = factory.deployedBrokerPoolsLength();
        // uint randomBytes = block.difficulty; // see https://github.com/ethereum/solidity/pull/13759
        bytes32 randomBytes = keccak256(abi.encode(target, brokerPoolCount)); // TODO temporary hack; polygon doesn't seem to support PREVRANDAO yet
        uint maxReviewersSearch = 20;
        assert(REVIEWER_COUNT <= 20); // to raise maxReviewersSearch, tweak >>= below, address gives 160 bits of "randomness"
        // assert(reviewerCount <= 32); // tweak >>= below, prevrandao gives 256 bits of randomness

        // primary selection: live peers that are not in the same bounty
        for (uint i = 0; i < maxReviewersSearch && reviewers[target].length < REVIEWER_COUNT; i++) {
            randomBytes >>= 8; // if REVIEWER_COUNT > 20, replace this with keccak256(randomBytes) or smth
            uint index = uint(randomBytes) % brokerPoolCount;
            BrokerPool pool = factory.deployedBrokerPools(index);
            address poolAddress = address(pool);
            if (poolAddress == _msgSender() || poolAddress == target
                || reviewerState[target][poolAddress] != Reviewer.NOT_SELECTED) {
                console.log(index, "skipping", poolAddress);
                continue;
            }
            // TODO: check is broker live
            if (globalData().stakedWei[address(pool)] > 0) {
                if (sameBountyPeerCount + reviewers[target].length < REVIEWER_COUNT) {
                    sameBountyPeers[sameBountyPeerCount++] = poolAddress;
                    reviewerState[target][poolAddress] = Reviewer.IS_SELECTED_SECONDARY;
                }
                console.log(index, "in same bounty", poolAddress);
                continue;
            }
            // console.log(index, "selecting", peer);
            reviewerState[target][poolAddress] = Reviewer.IS_SELECTED;
            emit ReviewRequest(poolAddress, this, target);
            console.log("selected", poolAddress, "for", target);
            reviewers[target].push(poolAddress);
        }

        // secondary selection: peers from the same bounty
        for (uint i = 0; i < sameBountyPeerCount; i++) {
            address peer = sameBountyPeers[i];
            if (reviewerState[target][peer] == Reviewer.IS_SELECTED) {
                // console.log("already selected", peer);
                continue;
            }
            if (reviewers[target].length >= REVIEWER_COUNT) {
                reviewerState[target][peer] = Reviewer.NOT_SELECTED;
                // console.log("not selecting", peer);
                continue;
            }
            // console.log("selecting from same bounty", peer);
            reviewerState[target][peer] = Reviewer.IS_SELECTED;
            emit ReviewRequest(peer, this, target);
            reviewers[target].push(peer);
        }
        require(reviewers[target].length > 0, "error_notEnoughReviewers");
    }

    /**
     * Tally votes and trigger resolution when everyone has voted
     * After voting period ends, anyone can trigger the resolution by calling this function
     */
    function onVote(address target, bytes32 voteData) external {
        require(canVote(target), "error_votingNotStarted");
        if (block.timestamp > voteEndTimestamp(target)) { // solhint-disable-line not-rely-on-time
            _endVote(target);
            return;
        }
        address voter = _msgSender(); // ?
        require(reviewerState[target][voter] != Reviewer.NOT_SELECTED, "error_reviewersOnly");
        require(reviewerState[target][voter] == Reviewer.IS_SELECTED, "error_alreadyVoted");
        bool votedKick = uint(voteData) & 0x1 == 1;
        reviewerState[target][voter] = votedKick ? Reviewer.VOTED_KICK : Reviewer.VOTED_NO_KICK;

        // break ties by giving the first voter less weight
        uint totalVotesBefore = votesForKick[target] + votesAgainstKick[target];
        uint addVotes = totalVotesBefore == 0 ? 1 : 2;
        if (votedKick) {
            votesForKick[target] += addVotes;
        } else {
            votesAgainstKick[target] += addVotes;
        }

        // end voting early when everyone's vote is in
        console.log("totalVotesBefore", totalVotesBefore, addVotes, reviewers[target].length);
        if (totalVotesBefore + addVotes + 1 == 2 * reviewers[target].length) {
            _endVote(target);
        }
    }

    /* solhint-disable reentrancy */ // TODO: figure out what solhint means with this exactly

    function _endVote(address target) internal {
        console.log("endVote", target);
        address flagger = flaggerPoolAddress[target];
        uint reviewerCount = reviewers[target].length;
        if (votesForKick[target] > votesAgainstKick[target]) {
            uint slashingWei = targetStakeAtRiskWei[target];
            _slash(target, slashingWei, true); // true = kick

            // pay the flagger and those reviewers who voted correctly from the slashed stake
            token.transfer(flagger, FLAGGER_REWARD_WEI);
            slashingWei -= FLAGGER_REWARD_WEI;
            for (uint i = 0; i < reviewerCount; i++) {
                address reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_KICK) {
                    token.transfer(BrokerPool(reviewer).broker(), REVIEWER_REWARD_WEI);
                    slashingWei -= REVIEWER_REWARD_WEI;
                }
            }
            _addSponsorship(address(this), slashingWei); // leftovers are added to sponsorship
        } else {
            // false flag, no kick; pay the reviewers who voted correctly from the flagger's stake
            protectionEndTimestamp[target] = block.timestamp + PROTECTION_SECONDS; // solhint-disable-line not-rely-on-time
            uint slashingWei = 0;
            for (uint i = 0; i < reviewerCount; i++) {
                address reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_NO_KICK) {
                    token.transfer(BrokerPool(reviewer).broker(), REVIEWER_REWARD_WEI);
                    slashingWei += REVIEWER_REWARD_WEI;
                }
            }
            _slash(flagger, slashingWei, false);
        }
        _cleanup(target);
    }

    /* solhint-enable reentrancy */

    /** Cancel the flag before voting starts => every reviewer gets paid */
    function onCancelFlag(address target) external {
        require(!canVote(target), "error_votingStarted");
        require(flaggerPoolAddress[target] == _msgSender(), "error_notFlagger");
        uint rewardWei = 1 ether; // TODO: add to streamrConstants?
        uint reviewerCount = reviewers[target].length;
        for (uint i = 0; i < reviewerCount; i++) {
            address reviewer = reviewers[target][i];
            // console.log("paying reviewer", reviewer);
            token.transfer(BrokerPool(reviewer).broker(), rewardWei);
        }
        _cleanup(target);
    }

    /** Remove stake commitments and clear flag data */
    function _cleanup(address target) internal {
        // flagger might already have been kicked
        address flagger = flaggerPoolAddress[target];
        if (globalData().committedStakeWei[flagger] > 0) {
            globalData().committedStakeWei[flagger] -= FLAG_STAKE_WEI;
        }
        globalData().committedStakeWei[target] -= targetStakeAtRiskWei[target];

        uint reviewerCount = reviewers[target].length;
        for (uint i = 0; i < reviewerCount; i++) {
            address reviewer = reviewers[target][i];
            delete reviewerState[target][reviewer];
        }
        delete reviewers[target];
        delete flaggerPoolAddress[target];
        delete flagTimestamp[target];
        delete targetStakeAtRiskWei[target];
        delete votesForKick[target];
        delete votesAgainstKick[target];
    }
}
