// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Bounty.sol";
import "../BrokerPoolFactory.sol";
import "../BrokerPool.sol";

// import "hardhat/console.sol";

/**
 * @dev Only BrokerPools can be selected as reviewers, so BrokerPoolOnlyJoinPolicy is expected on the Bounty!
 */
contract VoteKickPolicy is IKickPolicy, Bounty {
    // TODO: move to StreamrConstants?
    uint public constant REVIEWER_COUNT = 5;
    uint public constant REVIEWER_REWARD_WEI = 1 ether;

    // minimum stake in bounties must be at least FLAGGER_REWARD_WEI + REVIEWER_COUNT * REVIEWER_REWARD_WEI
    // and this actually means the REAL minimum stake, after arbitrary slashing, so probably a safety margin of FLAG_STAKE_WEI is needed too
    uint public constant FLAGGER_REWARD_WEI = 1 ether;

    // probability of finding REVIEWER_COUNT peers for the review is: 1 - sum_{N = 0...REVIEWER_COUNT-1} p(pick exactly N),
    //   and a non-worst-case first-order approximation is  1 - (REVIEWER_COUNT / peerCount) ^ (REVIEWER_SELECTION_ITERATIONS - REVIEWER_COUNT)
    // for exact simulation, take a look at scripts/calculateFullReviewProbability.ts; some example values:
    //  - worst case: select 5 out of 7 (only one correct solution, everyone who can be selected must be selected!)
    //    => Probability of success after i iterations:  [ 0, 0, 0, 0, 0.0071, 0.0275, 0.0632, 0.1127, 0.1727, 0.2393,
    //                                 0.3087, 0.3781, 0.4451, 0.5083, 0.5668, 0.6201, 0.6682, 0.7111, 0.7492, 0.7827,
    //                                  0.812, 0.8377,   0.86, 0.8794, 0.8962, 0.9107, 0.9232,  0.934, 0.9433, 0.9513 ]
    //  - better case: select 5 out of 20
    //    => Success rate is 32% with the minimum of 5 iterations, 64% with 6 iterations, >99% after 10 iterations,
    //    => After 18 iterations, failure rate is less than 1 / 1 000 000
    //  - super duper worst case: select 32 out of 34
    //    => Success rate 16.5% after 100 iterations
    //    => Most likely number of reviewers after i iterations: [ 1,  2,  3,  4,  5,  5,  6,  7,  8,  8,
    //                     9, 10, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19,
    //                    19, 20, 20, 20, 21, 21, 21, 22, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25,
    //                    25, 25, 26, 26, 26, 26, 26, 26, 27, 27, 27, 27, 27, 27, 28, 28, 28, 28, 28, 28,
    //                    28, 28, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 30, 30, 30, 30, 30, 30, 30, 30,
    //                    30, 30, 30, 30, 30, 30, 31, 31, 31, 31 ], i.e. up to half (16), it picks every 1...2nd time, as you would expect
    uint public constant REVIEWER_SELECTION_ITERATIONS = 20;

    /**
     * FLAG_STAKE_WEI must be enough to pay all the reviewers, even after the flagger would be kicked (and slashed 10% of the total stake).
     * If the broker decides to reduceStake, committed stake is the limit how much stake must be left into Bounty.
     * The total committed stake must be enough to pay the reviewers of all flags.
     *     flag stakes >= reviewer fees + 10% of stake that's left into the bounty (= committed)
     * After n flags: n * FLAG_STAKE_WEI >= n * reviewer fees + 10% of total committed stake
     *            =>  n * FLAG_STAKE_WEI >= n * (REVIEWER_COUNT * REVIEWER_REWARD_WEI) + 10% of (n * FLAG_STAKE_WEI) (assuming only flagging causes committed stake)
     *            =>  FLAG_STAKE_WEI * 9/10 >= REVIEWER_COUNT * REVIEWER_REWARD_WEI
     *            =>  FLAG_STAKE_WEI >= REVIEWER_COUNT * REVIEWER_REWARD_WEI * 10/9
     * That is where the 10/9 comes from.
     */
    uint public constant FLAG_STAKE_WEI = 10 ether; // must be >= REVIEWER_COUNT * REVIEWER_REWARD_WEI * 10/9

    uint public constant REVIEW_PERIOD_SECONDS = 1 days;
    uint public constant VOTING_PERIOD_SECONDS = 1 hours;
    uint public constant PROTECTION_SECONDS = 1 hours; // can't be flagged again right after a no-kick result

    mapping (address => address) public flaggerAddress;

    enum Reviewer {
        NOT_SELECTED,
        IS_SELECTED,
        VOTED_KICK,
        VOTED_NO_KICK,
        IS_SELECTED_SECONDARY
    }

    mapping (address => uint) public flagTimestamp;
    mapping (address => mapping (BrokerPool => Reviewer)) public reviewerState;
    mapping (address => BrokerPool[]) public reviewers;
    mapping (address => uint) public votesForKick;
    mapping (address => uint) public votesAgainstKick;
    mapping (address => uint) public protectionEndTimestamp; // can't be flagged again right after a no-kick result

    // 10% of the target's stake that is in the risk of being slashed upon kick
    mapping (address => uint) public targetStakeAtRiskWei;

    // function localData() internal view returns(LocalStorage storage data) {
    //     bytes32 storagePosition = keccak256(abi.encodePacked("bounty.storage.AdminKickPolicy", address(this)));
    //     assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    // }

    function setParam(uint256) external {

    }

    function getFlagData(address broker) override external view returns (uint flagData) {
        if (flagTimestamp[broker] == 0) {
            return 0;
        }
        return uint(bytes32(abi.encodePacked(
            uint160(flaggerAddress[broker]),
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
        GlobalStorage storage s = globalData();
        address flagger = _msgSender();
        require(flagTimestamp[target] == 0 && block.timestamp > protectionEndTimestamp[target], "error_cannotFlagAgain"); // solhint-disable-line not-rely-on-time
        require(s.stakedWei[flagger] >= s.minimumStakeWei, "error_notEnoughStake");
        require(s.stakedWei[target] > 0, "error_flagTargetNotStaked");

        // the flag target risks to lose 10% if the flag resolves to KICK
        // take at least 10% of minimumStake to ensure everyone can get paid!
        uint slashBasisWei = max(globalData().stakedWei[target], globalData().minimumStakeWei);
        targetStakeAtRiskWei[target] = slashBasisWei / 10;
        globalData().committedStakeWei[target] += targetStakeAtRiskWei[target];

        // TODO: after taking at least minimumStake, all 9/10s here are probably overthinking; it's enough that FLAG_STAKE_WEI is 10/9 of the total reviewer reward
        // the limit for flagging is 9/10s of the stake so that there's still room to get flagged and lose the remaining 10% of minimumStake
        globalData().committedStakeWei[flagger] += FLAG_STAKE_WEI;
        require(globalData().committedStakeWei[flagger] * 10 <= 9 * globalData().stakedWei[flagger], "error_notEnoughStake");
        flaggerAddress[target] = flagger;

        flagTimestamp[target] = block.timestamp; // solhint-disable-line not-rely-on-time

        // only secondarily select peers that are in the same bounty as the flagging target
        BrokerPool[REVIEWER_COUNT] memory sameBountyPeers;
        uint sameBountyPeerCount = 0;

        BrokerPoolFactory factory = BrokerPoolFactory(globalData().streamrConstants.brokerPoolFactory());
        uint brokerPoolCount = factory.deployedBrokerPoolsLength();
        // uint randomBytes = block.difficulty; // see https://github.com/ethereum/solidity/pull/13759
        bytes32 randomBytes = keccak256(abi.encode(target, brokerPoolCount)); // TODO temporary hack; polygon doesn't seem to support PREVRANDAO yet
        assert(REVIEWER_COUNT <= 32); // to raise maxReviewersSearch, tweak >>= below, keccak gives 256 bits of "randomness"

        // primary selection: live peers that are not in the same bounty
        for (uint i = 0; i < REVIEWER_SELECTION_ITERATIONS && reviewers[target].length < REVIEWER_COUNT; i++) {
            randomBytes >>= 8; // if REVIEWER_COUNT > 20, replace this with keccak256(randomBytes) or smth
            uint index = uint(randomBytes) % brokerPoolCount;
            BrokerPool peer = factory.deployedBrokerPools(index);
            if (address(peer) == _msgSender() || address(peer) == target || reviewerState[target][peer] != Reviewer.NOT_SELECTED) {
                // console.log(index, "skipping", address(peer));
                continue;
            }
            // TODO: check is broker live
            if (globalData().stakedWei[address(peer)] > 0) {
                if (sameBountyPeerCount + reviewers[target].length < REVIEWER_COUNT) {
                    sameBountyPeers[sameBountyPeerCount++] = peer;
                    reviewerState[target][peer] = Reviewer.IS_SELECTED_SECONDARY;
                }
                // console.log(index, "in same bounty", address(peer));
                continue;
            }
            // console.log(index, "selecting", address(peer));
            reviewerState[target][peer] = Reviewer.IS_SELECTED;
            peer.onReviewRequest(target);
            reviewers[target].push(peer);
        }

        // secondary selection: peers from the same bounty
        for (uint i = 0; i < sameBountyPeerCount; i++) {
            BrokerPool peer = sameBountyPeers[i];
            if (reviewerState[target][peer] == Reviewer.IS_SELECTED) {
                // console.log("already selected", address(peer));
                continue;
            }
            if (reviewers[target].length >= REVIEWER_COUNT) {
                reviewerState[target][peer] = Reviewer.NOT_SELECTED;
                // console.log("not selecting", address(peer));
                continue;
            }
            // console.log("selecting from same bounty", address(peer));
            reviewerState[target][peer] = Reviewer.IS_SELECTED;
            peer.onReviewRequest(target);
            reviewers[target].push(peer);
        }
        require(reviewers[target].length > 0, "error_notEnoughReviewers");
        emit FlagUpdate(flagger, target, targetStakeAtRiskWei[target], 0);
    }

    /**
     * Tally votes and trigger resolution when everyone has voted
     * After voting period ends, anyone can trigger the resolution by calling this function
     */
    function onVote(address target, bytes32 voteData) external {
        // console.log("onVote", msg.sender, target);
        require(flagTimestamp[target] > 0, "error_notFlagged");
        require(block.timestamp > flagTimestamp[target] + REVIEW_PERIOD_SECONDS, "error_votingNotStarted"); // solhint-disable-line not-rely-on-time
        if (block.timestamp > flagTimestamp[target] + REVIEW_PERIOD_SECONDS + VOTING_PERIOD_SECONDS) { // solhint-disable-line not-rely-on-time
            // console.log("Vote timeout", target, block.timestamp, flagTimestamp[target] + REVIEW_PERIOD_SECONDS + VOTING_PERIOD_SECONDS);
            _endVote(target);
            return;
        }
        BrokerPool voter = BrokerPool(_msgSender());
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
        if (totalVotesBefore + addVotes + 1 == 2 * reviewers[target].length) {
            // console.log("Everyone voted", target);
            _endVote(target);
        }
    }

    /* solhint-disable reentrancy */ // TODO: figure out what solhint means with this exactly

    function _endVote(address target) internal {
        // console.log("endVote", target);
        address flagger = flaggerAddress[target];
        bool flaggerIsGone = globalData().stakedWei[flagger] == 0;
        bool targetIsGone = globalData().stakedWei[target] == 0;
        uint reviewerCount = reviewers[target].length;

        // release stake commitments before vote resolution so that slashings and kickings during resolution aren't affected
        // if either the flagger or the target has forceUnstaked or been kicked, the committed stake was moved to committedFundsWei
        if (flaggerIsGone) {
            globalData().committedFundsWei -= FLAG_STAKE_WEI;
        } else {
            globalData().committedStakeWei[flagger] -= FLAG_STAKE_WEI;
        }
        if (targetIsGone) {
            globalData().committedFundsWei -= targetStakeAtRiskWei[target];
        } else {
            globalData().committedStakeWei[target] -= targetStakeAtRiskWei[target];
        }

        if (votesForKick[target] > votesAgainstKick[target]) {
            uint slashingWei = targetStakeAtRiskWei[target];
            // if targetIsGone: the tokens are still in Bounty, accounted in committedFundsWei (which will be subtracted in cleanup, so no need to _slash)
            if (!targetIsGone) {
                _kick(target, slashingWei);
            }

            // pay the flagger and those reviewers who voted correctly from the slashed stake
            if (!flaggerIsGone) {
                token.transfer(BrokerPool(flagger).reviewRewardsBeneficiary(), FLAGGER_REWARD_WEI);
                slashingWei -= FLAGGER_REWARD_WEI;
            }
            for (uint i = 0; i < reviewerCount; i++) {
                BrokerPool reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_KICK) {
                    token.transfer(reviewer.reviewRewardsBeneficiary(), REVIEWER_REWARD_WEI);
                    slashingWei -= REVIEWER_REWARD_WEI;
                }
                delete reviewerState[target][reviewer]; // clean up
            }
            _addSponsorship(address(this), slashingWei); // leftovers are added to sponsorship
        } else {
            // false flag, no kick; pay the reviewers who voted correctly from the flagger's stake, return the leftovers to the flagger
            protectionEndTimestamp[target] = block.timestamp + PROTECTION_SECONDS; // solhint-disable-line not-rely-on-time
            uint rewardsWei = 0;
            for (uint i = 0; i < reviewerCount; i++) {
                BrokerPool reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_NO_KICK) {
                    token.transfer(reviewer.reviewRewardsBeneficiary(), REVIEWER_REWARD_WEI);
                    rewardsWei += REVIEWER_REWARD_WEI;
                }
                delete reviewerState[target][reviewer]; // clean up
            }
            if (flaggerIsGone) {
                uint leftoverWei = FLAG_STAKE_WEI - rewardsWei;
                _addSponsorship(address(this), leftoverWei); // flagger forfeited its flagstake, so the leftovers go to sponsorship
            } else {
                _slash(flagger, rewardsWei); // just slash enough to cover the rewards, the rest will be uncommitted = released
            }
        }

        delete reviewers[target];
        delete flaggerAddress[target];
        delete flagTimestamp[target];
        delete targetStakeAtRiskWei[target];
        delete votesForKick[target];
        delete votesAgainstKick[target];
    }

    /* solhint-enable reentrancy */
}
