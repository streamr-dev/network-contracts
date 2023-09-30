// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Sponsorship.sol";
import "../OperatorFactory.sol";
import "../Operator.sol";

// import "hardhat/console.sol";

/**
 * @dev Only Operators can be selected as reviewers, so OperatorContractOnlyJoinPolicy is expected on the Sponsorship!
 */
contract VoteKickPolicy is IKickPolicy, Sponsorship {
    enum Reviewer {
        NOT_SELECTED,
        IS_SELECTED,
        VOTED_KICK,
        VOTED_NO_KICK,
        IS_SELECTED_SECONDARY
    }

    uint public constant MAX_REVIEWER_COUNT = 32; // enforced in StreamrConfig.setFlagReviewerCount

    // flag
    mapping (address => address) public flaggerAddress;
    mapping (address => uint) public voteStartTimestamp;
    mapping (address => uint) public voteEndTimestamp;
    mapping (address => uint) public targetStakeAtRiskWei; // slashingFraction of the target's stake that is in the risk of being slashed upon kick

    // voting
    mapping (address => Operator[]) public reviewers; // list of reviewers, for rewarding
    mapping (address => mapping (Operator => Reviewer)) public reviewerState; // votes
    mapping (address => uint) public votesForKick; // vote totals, for knowing when voting should end
    mapping (address => uint) public votesAgainstKick;

    // global StreamrConfig that needs to be cached, in case config changes during the flag
    mapping (address => uint) public flagStakeWei;
    mapping (address => uint) public flaggerRewardWei;
    mapping (address => uint) public reviewerRewardWei;

    // can't be flagged again right after a no-kick result
    mapping (address => uint) public protectionEndTimestamp;

    function setParam(uint) external {

    }

    function getFlagData(address operator) override external view returns (uint flagData) {
        if (voteStartTimestamp[operator] == 0) {
            return 0;
        }
        return uint(bytes32(abi.encodePacked(
            uint160(flaggerAddress[operator]),
            uint32(voteStartTimestamp[operator]),
            uint16(reviewers[operator].length),
            uint16(votesForKick[operator]),
            uint16(votesAgainstKick[operator])
            // uint16()
        )));
    }

    /**
     * Start flagging process
     */
    function onFlag(address target) external {
        address flagger = _msgSender();
        require(flagger != target, "error_cannotFlagSelf");
        require(voteStartTimestamp[target] == 0 && block.timestamp > protectionEndTimestamp[target], "error_cannotFlagAgain"); // solhint-disable-line not-rely-on-time
        require(stakedWei[flagger] >= minimumStakeOf(flagger), "error_notEnoughStake");
        require(stakedWei[target] > 0, "error_flagTargetNotStaked");

        flaggerAddress[target] = flagger;
        voteStartTimestamp[target] = block.timestamp + streamrConfig.reviewPeriodSeconds(); // solhint-disable-line not-rely-on-time
        voteEndTimestamp[target] = voteStartTimestamp[target] + streamrConfig.votingPeriodSeconds(); // solhint-disable-line not-rely-on-time

        // the flag target risks to lose a slashingFraction if the flag resolves to KICK
        // take at least slashingFraction of minimumStakeWei to ensure everyone can get paid!
        targetStakeAtRiskWei[target] = max(stakedWei[target], streamrConfig.minimumStakeWei()) * streamrConfig.slashingFraction() / 1 ether;
        lockedStakeWei[target] += targetStakeAtRiskWei[target];

        // cache these just in case the config changes during the flag
        flagStakeWei[target] = streamrConfig.flagStakeWei();
        reviewerRewardWei[target] = streamrConfig.flagReviewerRewardWei();
        flaggerRewardWei[target] = streamrConfig.flaggerRewardWei();

        lockedStakeWei[flagger] += flagStakeWei[target];
        require(lockedStakeWei[flagger] * 1 ether <= stakedWei[flagger] * (1 ether - streamrConfig.slashingFraction()), "error_notEnoughStake");

        // only secondarily select peers that are in the same sponsorship as the flagging target
        Operator[MAX_REVIEWER_COUNT] memory sameSponsorshipPeers;
        uint sameSponsorshipPeerCount = 0;

        OperatorFactory factory = OperatorFactory(streamrConfig.operatorFactory());
        uint operatorCount = factory.liveOperatorCount();

        // set the seed to only depend on target (until an operator [un]stakes), so that attacker who simulates transactions
        //   can't "re-roll" the reviewers e.g. once per block; instead, they only get to "re-roll" once every [un]stake
        streamrConfig.setPseudorandomSeed(bytes32((operatorCount << 160) | uint160(target)));

        // primary selection: live peers that are not in the same sponsorship
        uint maxIterations = streamrConfig.flagReviewerSelectionIterations();
        uint maxReviewerCount = streamrConfig.flagReviewerCount();
        bytes32 randomBytes32;
        for (uint i = 0; i < maxIterations && reviewers[target].length < maxReviewerCount; i++) {
            if (i % 32 == 0) {
                randomBytes32 = streamrConfig.bestEffortRandomBytes32();
            } else {
                randomBytes32 >>= 8;
            }
            uint index = uint(randomBytes32) % operatorCount;
            Operator peer = factory.liveOperators(index);
            if (address(peer) == _msgSender() || address(peer) == target || reviewerState[target][peer] != Reviewer.NOT_SELECTED) {
                continue;
            }
            if (stakedWei[address(peer)] > 0) {
                if (sameSponsorshipPeerCount + reviewers[target].length < maxReviewerCount) {
                    sameSponsorshipPeers[sameSponsorshipPeerCount++] = peer;
                    reviewerState[target][peer] = Reviewer.IS_SELECTED_SECONDARY;
                }
                continue;
            }
            reviewerState[target][peer] = Reviewer.IS_SELECTED;
            peer.onReviewRequest(target);
            reviewers[target].push(peer);
        }

        // secondary selection: peers from the same sponsorship
        for (uint i = 0; i < sameSponsorshipPeerCount && reviewers[target].length < maxReviewerCount; i++) {
            Operator peer = sameSponsorshipPeers[i];
            reviewerState[target][peer] = Reviewer.IS_SELECTED;
            peer.onReviewRequest(target);
            reviewers[target].push(peer);
        }
        require(reviewers[target].length > 0, "error_notEnoughReviewers");
        emit FlagUpdate(flagger, target, targetStakeAtRiskWei[target], 0, flagMetadataJson[target]);
    }

    /**
     * Tally votes and trigger resolution when everyone has voted
     * After voting period ends, anyone can trigger the resolution by calling this function
     */
    function onVote(address target, bytes32 voteData) external {
        require(voteStartTimestamp[target] > 0, "error_notFlagged");
        require(block.timestamp > voteStartTimestamp[target], "error_votingNotStarted"); // solhint-disable-line not-rely-on-time
        if (block.timestamp > voteEndTimestamp[target]) { // solhint-disable-line not-rely-on-time
            _endVote(target);
            return;
        }
        Operator voter = Operator(_msgSender());
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
            _endVote(target);
        }
    }

    function _endVote(address target) internal {
        address flagger = flaggerAddress[target];
        bool flaggerIsGone = stakedWei[flagger] == 0;
        bool targetIsGone = stakedWei[target] == 0;
        uint reviewerCount = reviewers[target].length;

        // release stake locks before vote resolution so that slashings and kickings during resolution aren't affected
        // if either the flagger or the target has forceUnstaked or been kicked, the lockedStakeWei was moved to forfeitedStakeWei
        if (flaggerIsGone) {
            forfeitedStakeWei -= flagStakeWei[target];
        } else {
            lockedStakeWei[flagger] -= flagStakeWei[target];
        }
        if (targetIsGone) {
            forfeitedStakeWei -= targetStakeAtRiskWei[target];
        } else {
            lockedStakeWei[target] -= targetStakeAtRiskWei[target];
        }

        if (votesForKick[target] > votesAgainstKick[target]) {
            uint slashingWei = targetStakeAtRiskWei[target];
            // if targetIsGone: the tokens are still in Sponsorship, accounted in forfeitedStakeWei (so "slashing" was already done)
            if (!targetIsGone) {
                _kick(target, slashingWei);
            }

            // pay the flagger and those reviewers who voted correctly from the slashed stake
            if (!flaggerIsGone) {
                token.transferAndCall(flagger, flaggerRewardWei[target], abi.encode(Operator(flagger).owner()));
                slashingWei -= flaggerRewardWei[target];
            }
            for (uint i = 0; i < reviewerCount; i++) {
                Operator reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_KICK) {
                    token.transferAndCall(address(reviewer), reviewerRewardWei[target], abi.encode(reviewer.owner()));
                    slashingWei -= reviewerRewardWei[target];
                }
                delete reviewerState[target][reviewer]; // clean up
            }
            _addSponsorship(address(this), slashingWei); // leftovers are added to sponsorship
        } else {
            // false flag, no kick; pay the reviewers who voted correctly from the flagger's stake, return the leftovers to the flagger
            protectionEndTimestamp[target] = block.timestamp + streamrConfig.flagProtectionSeconds(); // solhint-disable-line not-rely-on-time
            uint rewardsWei = 0;
            for (uint i = 0; i < reviewerCount; i++) {
                Operator reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_NO_KICK) {
                    token.transferAndCall(address(reviewer), reviewerRewardWei[target], abi.encode(reviewer.owner()));
                    rewardsWei += reviewerRewardWei[target];
                }
                delete reviewerState[target][reviewer]; // clean up here, to avoid another loop
            }
            if (flaggerIsGone) {
                uint leftoverWei = flagStakeWei[target] - rewardsWei;
                _addSponsorship(address(this), leftoverWei); // flagger forfeited its flagstake, so the leftovers go to sponsorship
            } else {
                _slash(flagger, rewardsWei); // just slash enough to cover the rewards, the rest will be unlocked = released
            }
        }

        delete flaggerAddress[target];
        delete voteStartTimestamp[target];
        delete voteEndTimestamp[target];
        delete targetStakeAtRiskWei[target];

        delete reviewers[target];
        // reviewerState was cleaned up inside the loop above
        delete votesForKick[target];
        delete votesAgainstKick[target];

        delete flaggerRewardWei[target];
        delete reviewerRewardWei[target];
        delete flagStakeWei[target];
    }
}
