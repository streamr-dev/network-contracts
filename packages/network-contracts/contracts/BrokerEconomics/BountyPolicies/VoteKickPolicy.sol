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
    enum Reviewer {
        NOT_SELECTED,
        IS_SELECTED,
        VOTED_KICK,
        VOTED_NO_KICK,
        IS_SELECTED_SECONDARY
    }

    uint public constant MAX_REVIEWER_COUNT = 32; // enforced in StreamrConfig

    mapping (address => address) public flaggerAddress;
    mapping (address => uint) public flagTimestamp;
    mapping (address => mapping (BrokerPool => Reviewer)) public reviewerState;
    mapping (address => BrokerPool[]) public reviewers;
    mapping (address => uint) public votesForKick;
    mapping (address => uint) public votesAgainstKick;
    mapping (address => uint) public protectionEndTimestamp; // can't be flagged again right after a no-kick result

    // 10% of the target's stake that is in the risk of being slashed upon kick
    mapping (address => uint) public targetStakeAtRiskWei;

    struct LocalStorage {
        uint openFlagsCount;

        // timeline: flag -> review -> vote
        uint reviewPeriodSeconds;
        uint votingPeriodSeconds;

        // peer review selection parameters
        uint reviewerCount;
        uint reviewerSelectionIterations;

        // rewards and staking
        uint flagStakeWei;
        uint reviewerRewardWei;
        uint flaggerRewardWei;
    }

    function localData() internal view returns(LocalStorage storage data) {
        bytes32 storagePosition = keccak256(abi.encodePacked("bounty.storage.VoteKickPolicy", address(this)));
        assembly {data.slot := storagePosition} // solhint-disable-line no-inline-assembly
    }

    function setParam(uint256) external {
        LocalStorage storage local = localData();
        require(local.openFlagsCount == 0, "error_cannotUpdateParamsWhileFlagsOpen");

        StreamrConfig config = globalData().streamrConfig;
        local.reviewPeriodSeconds = config.reviewPeriodSeconds();
        local.votingPeriodSeconds = config.votingPeriodSeconds();
        local.reviewerCount = config.flagReviewerCount();
        local.reviewerSelectionIterations = config.flagReviewerSelectionIterations();
        local.flagStakeWei = config.flagStakeWei();
        local.reviewerRewardWei = config.flagReviewerRewardWei();
        local.flaggerRewardWei = config.flaggerRewardWei();
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
        GlobalStorage storage global = globalData();
        LocalStorage storage local = localData();
        address flagger = _msgSender();
        require(flagTimestamp[target] == 0 && block.timestamp > protectionEndTimestamp[target], "error_cannotFlagAgain"); // solhint-disable-line not-rely-on-time
        require(global.stakedWei[flagger] >= global.minimumStakeWei, "error_notEnoughStake");
        require(global.stakedWei[target] > 0, "error_flagTargetNotStaked");
        local.openFlagsCount += 1;

        // the flag target risks to lose 10% if the flag resolves to KICK
        // take at least 10% of minimumStake to ensure everyone can get paid!
        targetStakeAtRiskWei[target] = max(global.stakedWei[target], global.minimumStakeWei) / 10;
        global.committedStakeWei[target] += targetStakeAtRiskWei[target];

        // TODO: after taking at least minimumStake, all 9/10s here are probably overthinking; it's enough that flagStakeWei is 10/9 of the total reviewer reward
        //       the limit for flagging is 9/10s of the stake so that there's still room to get flagged and lose the remaining 10% of minimumStake
        // TODO: try to find the "extreme case" by writing more tests and see if the 10/9 can safely be removed
        global.committedStakeWei[flagger] += local.flagStakeWei;
        require(global.committedStakeWei[flagger] * 10 <= 9 * global.stakedWei[flagger], "error_notEnoughStake");
        flaggerAddress[target] = flagger;

        flagTimestamp[target] = block.timestamp; // solhint-disable-line not-rely-on-time

        // only secondarily select peers that are in the same bounty as the flagging target
        BrokerPool[MAX_REVIEWER_COUNT] memory sameBountyPeers;
        uint sameBountyPeerCount = 0;

        BrokerPoolFactory factory = BrokerPoolFactory(global.streamrConfig.brokerPoolFactory());
        uint brokerPoolCount = factory.deployedBrokerPoolsLength();
        // uint randomBytes = block.difficulty; // see https://github.com/ethereum/solidity/pull/13759
        bytes32 randomBytes = keccak256(abi.encode(target, brokerPoolCount)); // TODO temporary hack; polygon doesn't seem to support PREVRANDAO yet

        // primary selection: live peers that are not in the same bounty
        for (uint i = 0; i < local.reviewerSelectionIterations && reviewers[target].length < local.reviewerCount; i++) {
            randomBytes >>= 8; // if REVIEWER_COUNT > 20, replace this with keccak256(randomBytes) or smth
            uint index = uint(randomBytes) % brokerPoolCount;
            BrokerPool peer = factory.deployedBrokerPools(index);
            if (address(peer) == _msgSender() || address(peer) == target || reviewerState[target][peer] != Reviewer.NOT_SELECTED) {
                // console.log(index, "skipping", address(peer));
                continue;
            }
            // TODO: check is broker live
            if (global.stakedWei[address(peer)] > 0) {
                if (sameBountyPeerCount + reviewers[target].length < local.reviewerCount) {
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
            if (reviewers[target].length >= local.reviewerCount) {
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
        LocalStorage storage local = localData();
        // console.log("onVote", msg.sender, target);
        require(flagTimestamp[target] > 0, "error_notFlagged");
        require(block.timestamp > flagTimestamp[target] + local.reviewPeriodSeconds, "error_votingNotStarted"); // solhint-disable-line not-rely-on-time
        if (block.timestamp > flagTimestamp[target] + local.reviewPeriodSeconds + local.votingPeriodSeconds) { // solhint-disable-line not-rely-on-time
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
        GlobalStorage storage global = globalData();
        LocalStorage storage local = localData();
        // console.log("endVote", target);
        address flagger = flaggerAddress[target];
        bool flaggerIsGone = global.stakedWei[flagger] == 0;
        bool targetIsGone = global.stakedWei[target] == 0;
        uint reviewerCount = reviewers[target].length;

        // release stake commitments before vote resolution so that slashings and kickings during resolution aren't affected
        // if either the flagger or the target has forceUnstaked or been kicked, the committed stake was moved to committedFundsWei
        if (flaggerIsGone) {
            global.committedFundsWei -= local.flagStakeWei;
        } else {
            global.committedStakeWei[flagger] -= local.flagStakeWei;
        }
        if (targetIsGone) {
            global.committedFundsWei -= targetStakeAtRiskWei[target];
        } else {
            global.committedStakeWei[target] -= targetStakeAtRiskWei[target];
        }

        if (votesForKick[target] > votesAgainstKick[target]) {
            uint slashingWei = targetStakeAtRiskWei[target];
            // if targetIsGone: the tokens are still in Bounty, accounted in committedFundsWei (which will be subtracted in cleanup, so no need to _slash)
            if (!targetIsGone) {
                _kick(target, slashingWei);
            }

            // pay the flagger and those reviewers who voted correctly from the slashed stake
            if (!flaggerIsGone) {
                token.transferAndCall(flagger, local.flaggerRewardWei, abi.encode(BrokerPool(flagger).broker()));
                slashingWei -= local.flaggerRewardWei;
            }
            for (uint i = 0; i < reviewerCount; i++) {
                BrokerPool reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_KICK) {
                    token.transferAndCall(address(reviewer), local.reviewerRewardWei, abi.encode(reviewer.broker()));
                    slashingWei -= local.reviewerRewardWei;
                }
                delete reviewerState[target][reviewer]; // clean up
            }
            _addSponsorship(address(this), slashingWei); // leftovers are added to sponsorship
        } else {
            // false flag, no kick; pay the reviewers who voted correctly from the flagger's stake, return the leftovers to the flagger
            protectionEndTimestamp[target] = block.timestamp + global.streamrConfig.flagProtectionSeconds(); // solhint-disable-line not-rely-on-time
            uint rewardsWei = 0;
            for (uint i = 0; i < reviewerCount; i++) {
                BrokerPool reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_NO_KICK) {
                    token.transferAndCall(address(reviewer), local.reviewerRewardWei, abi.encode(reviewer.broker()));
                    rewardsWei += local.reviewerRewardWei;
                }
                delete reviewerState[target][reviewer]; // clean up
            }
            if (flaggerIsGone) {
                uint leftoverWei = local.flagStakeWei - rewardsWei;
                _addSponsorship(address(this), leftoverWei); // flagger forfeited its flagstake, so the leftovers go to sponsorship
            } else {
                _slash(flagger, rewardsWei); // just slash enough to cover the rewards, the rest will be uncommitted = released
            }
        }

        local.openFlagsCount -= 1;
        delete reviewers[target];
        delete flaggerAddress[target];
        delete flagTimestamp[target];
        delete targetStakeAtRiskWei[target];
        delete votesForKick[target];
        delete votesAgainstKick[target];
    }

    /* solhint-enable reentrancy */
}
