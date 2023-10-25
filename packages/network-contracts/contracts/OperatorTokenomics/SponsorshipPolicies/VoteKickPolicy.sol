// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "./IKickPolicy.sol";
import "../Sponsorship.sol";
import "../IVoterRegistry.sol";
import "../Operator.sol";
import "../IRandomOracle.sol";

/**
 * @dev Only Operators can be selected as reviewers, so OperatorContractOnlyJoinPolicy is expected on the Sponsorship!
 */
contract VoteKickPolicy is IKickPolicy, Sponsorship {

    int private constant VOTED_KICK = -1;
    int private constant VOTED_NO_KICK = -2;

    // flag
    mapping (address => address) private flaggerAddress;
    mapping (address => uint) private voteStartTimestamp;
    mapping (address => uint) private voteEndTimestamp;
    mapping (address => uint) private targetStakeAtRiskWei; // slashingFraction of the target's stake that is in the risk of being slashed upon kick

    // voting
    mapping (address => Operator[]) private reviewers; // list of reviewers, for rewarding
    mapping (address => mapping (Operator => int)) private reviewerState; // 0 = non-reviewer, + = voting-weight, - = voted
    mapping (address => uint) private votesForKick;
    mapping (address => uint) private votesAgainstKick;
    mapping (address => uint) private votersTotalValueWei;

    // global StreamrConfig that needs to be cached, in case config changes during the flag
    mapping (address => uint) private flagStakeWei;
    mapping (address => uint) private flaggerRewardWei;
    mapping (address => uint) private reviewerRewardWei;

    // can't be flagged again right after a no-kick result
    mapping (address => uint) private protectionEndTimestamp;

    function setParam(uint) external {

    }

    function getFlagData(address target) override external view returns (uint flagData) {
        if (voteStartTimestamp[target] == 0) {
            return 0;
        }
        return uint(bytes32(abi.encodePacked(
            uint160(flaggerAddress[target]),
            uint32(voteStartTimestamp[target]),
            uint16(2**16 * votesForKick[target] / votersTotalValueWei[target]),
            uint16(2**16 * votesAgainstKick[target] / votersTotalValueWei[target])
            // uint32() unused space
        )));
    }

    /**
     * Start the flagging process: lock some of the flagger's and the target's stake, find reviewers
     */
    function onFlag(address target, address flagger) external {
        require(flagger != target, "error_cannotFlagSelf");
        require(voteStartTimestamp[target] == 0 && block.timestamp > protectionEndTimestamp[target], "error_cannotFlagAgain"); // solhint-disable-line not-rely-on-time
        require(stakedWei[flagger] >= minimumStakeOf(flagger), "error_notEnoughStake");
        require(stakedWei[target] > 0, "error_flagTargetNotStaked");

        // the flag target risks to lose a slashingFraction if the flag resolves to KICK
        // take at least slashingFraction of minimumStakeWei to ensure everyone can get paid!
        targetStakeAtRiskWei[target] = max(stakedWei[target], streamrConfig.minimumStakeWei()) * streamrConfig.slashingFraction() / 1 ether;
        lockedStakeWei[target] += targetStakeAtRiskWei[target];

        // this can happen if we raise the minimumStakeWei. It's not the target-operator's fault, so don't slash them for this flag, just kick them out.
        if (lockedStakeWei[target] > stakedWei[target]) {
            lockedStakeWei[target] -= targetStakeAtRiskWei[target]; // unlock this flag's stake to avoid slashing when kicking
            delete targetStakeAtRiskWei[target];
            _kick(target, 0);
            return;
        }

        flaggerAddress[target] = flagger;
        voteStartTimestamp[target] = block.timestamp + streamrConfig.reviewPeriodSeconds(); // solhint-disable-line not-rely-on-time
        voteEndTimestamp[target] = voteStartTimestamp[target] + streamrConfig.votingPeriodSeconds();

        // cache these just in case the config changes during the flag
        flagStakeWei[target] = streamrConfig.flagStakeWei();
        reviewerRewardWei[target] = streamrConfig.flagReviewerRewardWei();
        flaggerRewardWei[target] = streamrConfig.flaggerRewardWei();

        lockedStakeWei[flagger] += flagStakeWei[target];
        require(lockedStakeWei[flagger] * 1 ether <= stakedWei[flagger] * (1 ether - streamrConfig.slashingFraction()), "error_notEnoughStake");

        IVoterRegistry voterRegistry = IVoterRegistry(streamrConfig.voterRegistry());
        uint voterCount = voterRegistry.voterCount();
        require(voterCount > 0, "error_noEligibleVoters");
        uint maxReviewerCount = streamrConfig.flagReviewerCount();
        // uint maxIterations = streamrConfig.flagReviewerSelectionIterations(); // avoid "stack too deep"

        // If we don't have a good randomness source set in streamrConfig, we generate the outcome from a seed deterministically.
        // Set the seed to only depend on target (until a voter (dis)appears), so that attacker who simulates transactions
        //   can't "re-roll" the reviewers e.g. once per block; instead, they only get to "re-roll" once every voter-set change
        bytes32 randomBytes32 = bytes32((voterCount << 160) | uint160(target));
        uint totalValueWei = 0;
        uint biggestVoterWeight = 0;
        Operator biggestVoter;
        for (uint i = 0; reviewers[target].length < maxReviewerCount && (i < maxReviewerCount || i < streamrConfig.flagReviewerSelectionIterations()); i++) {
            if (i % 32 == 0) {
                if (streamrConfig.randomOracle() != address(0)) {
                    randomBytes32 = IRandomOracle(streamrConfig.randomOracle()).getRandomBytes32();
                } else {
                    randomBytes32 = keccak256(abi.encode(randomBytes32));
                }
            } else {
                randomBytes32 >>= 8;
            }
            Operator peer = Operator(voterRegistry.voters(uint(randomBytes32) % voterCount));
            if (address(peer) == flagger || address(peer) == target || reviewerState[target][peer] > 0) {
                continue;
            }
            peer.onReviewRequest(target);
            reviewers[target].push(peer);

            // every Operator gets as many votes as they have DATA value locked (capped to half of total voter weight)
            uint voterWeight = peer.valueWithoutEarnings();
            totalValueWei += voterWeight;
            reviewerState[target][peer] = int(voterWeight);
            if (voterWeight > biggestVoterWeight) {
                biggestVoterWeight = voterWeight;
                biggestVoter = peer;
            }
        }

        // no voter should decide the vote alone (among >2 voters), so cap voting power to just below half of total voting power
        if (biggestVoterWeight * 2 >= totalValueWei && reviewers[target].length > 2) {
            totalValueWei -= biggestVoterWeight;
            reviewerState[target][biggestVoter] = int(totalValueWei - 1);
            totalValueWei += totalValueWei - 1;
        }

        votersTotalValueWei[target] = totalValueWei;
        require(reviewers[target].length > 0, "error_failedToFindReviewers");

        emit StakeUpdate(flagger, stakedWei[flagger], getEarnings(flagger), lockedStakeWei[flagger]);
        emit StakeUpdate(target, stakedWei[target], getEarnings(target), lockedStakeWei[target]);
        emit Flagged(target, flagger, targetStakeAtRiskWei[target], reviewers[target].length, flagMetadataJson[target]);
    }

    /**
     * Tally votes and trigger resolution when everyone has voted
     * After voting period ends, anyone can trigger the resolution by calling this function
     */
    function onVote(address target, bytes32 voteData, address voterAddress) external {
        require(voteStartTimestamp[target] > 0, "error_notFlagged");
        require(block.timestamp > voteStartTimestamp[target], "error_votingNotStarted"); // solhint-disable-line not-rely-on-time
        if (block.timestamp > voteEndTimestamp[target]) { // solhint-disable-line not-rely-on-time
            _endVote(target);
            return;
        }

        Operator voter = Operator(voterAddress);
        int voterWeight = reviewerState[target][voter];     // reviewerState > 0: not yet voted, reviewerState = number of votes
        require(voterWeight >= 0, "error_alreadyVoted");    // reviewerState < 0: already voted
        require(voterWeight > 0, "error_reviewersOnly");    // reviewerState = 0: not a voter

        int voterWeightSigned;
        if (uint(voteData) & 0x1 == 1) {
            reviewerState[target][voter] = VOTED_KICK;
            votesForKick[target] += uint(voterWeight);
            voterWeightSigned = voterWeight;
        } else {
            reviewerState[target][voter] = VOTED_NO_KICK;
            votesAgainstKick[target] += uint(voterWeight);
            voterWeightSigned = -voterWeight;
        }

        emit FlagUpdate(target, FlagState.VOTING, votesForKick[target], votesAgainstKick[target], address(voter), voterWeightSigned);

        // end voting early when everyone's votes are in
        if (votesForKick[target] + votesAgainstKick[target] == votersTotalValueWei[target]) {
            _endVote(target);
        }
    }

    function _endVote(address target) private {
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
                slashingWei = _kick(target, slashingWei);
            }

            // pay the flagger and those reviewers who voted correctly from the slashed stake
            if (flaggerIsGone) {
                // ...unless the flagger left and forfeited its flag-stake. Add the forfeited stake on top of "slashing" that will go to sponsorship
                slashingWei += flagStakeWei[target];
            } else {
                token.transferAndCall(flagger, flaggerRewardWei[target], abi.encode(Operator(flagger).owner()));
                slashingWei -= flaggerRewardWei[target];
            }
            for (uint i = 0; i < reviewerCount; i++) {
                Operator reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == VOTED_KICK) {
                    token.transferAndCall(address(reviewer), reviewerRewardWei[target], abi.encode(reviewer.owner()));
                    slashingWei -= reviewerRewardWei[target];
                }
                delete reviewerState[target][reviewer]; // clean up here, to avoid another loop
            }
            _addSponsorship(address(this), slashingWei); // leftovers are added to sponsorship
            emit FlagUpdate(target, FlagState.KICKED, votesForKick[target], votesAgainstKick[target], address(0), 0);
        } else {
            // false flag, no kick; pay the reviewers who voted correctly from the flagger's stake, return the leftovers to the flagger
            protectionEndTimestamp[target] = block.timestamp + streamrConfig.flagProtectionSeconds(); // solhint-disable-line not-rely-on-time
            uint rewardsWei = 0;
            for (uint i = 0; i < reviewerCount; i++) {
                Operator reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == VOTED_NO_KICK) {
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
            emit FlagUpdate(target, FlagState.NOT_KICKED, votesForKick[target], votesAgainstKick[target], address(0), 0);
            if (!targetIsGone) {
                emit StakeUpdate(target, stakedWei[target], getEarnings(target), lockedStakeWei[target]);
            }
        }

        if (!flaggerIsGone) {
            emit StakeUpdate(flagger, stakedWei[flagger], getEarnings(flagger), lockedStakeWei[flagger]);
        }
        emit SponsorshipUpdate(totalStakedWei, remainingWei, uint32(operatorCount), isRunning());

        delete flaggerAddress[target];
        delete voteStartTimestamp[target];
        delete voteEndTimestamp[target];
        delete targetStakeAtRiskWei[target];

        delete reviewers[target];
        // reviewerState was cleaned up inside the loop above
        delete votesForKick[target];
        delete votesAgainstKick[target];
        delete votersTotalValueWei[target];

        delete flaggerRewardWei[target];
        delete reviewerRewardWei[target];
        delete flagStakeWei[target];
    }
}
