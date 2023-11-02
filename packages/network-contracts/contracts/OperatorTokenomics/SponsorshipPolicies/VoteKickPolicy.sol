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

    function setParam(uint) external {}

    /**
     * Division by a "fraction" expressed as multiple of 1e18, like ether (1e18 = 100%)
     * @return result = x / fraction, rounding UP
     */
    function divByFraction(uint x, uint fraction) internal pure returns (uint) {
        return (x * 1 ether + fraction - 1) / fraction;
    }

    /**
     * You can't cash out the locked part of your stake, or go below the minimum stake.
     * When joining, locked stake is zero, so the limit is the same minimumStakeWei for everyone.
     * In addition to locked stake, the individual limit must have enough room for flagging (if not already flagged). When a flag is raised:
     *    lockedStakeAfter = lockedStakeBefore + stake * slashingFraction
     * If we require that in all circumstances lockedStake < stake, then we get:
     *    stake > lockedStakeAfter = lockedStakeBefore + stake * slashingFraction
     * Solving for stake:
     *    stake > lockedStakeBefore / (1 - slashingFraction) = minimumStake
     * @dev round UP, it's better to require 1 wei too much than too little.
     */
    function getMinimumStakeOf(address operator) override public view returns (uint) {
        uint minimumStakeWei = streamrConfig.minimumStakeWei();
        uint lockedStake = lockedStakeWei[operator];
        // only bake in the "room for flagging" if not yet flagged
        if (voteStartTimestamp[operator] == 0) {
            lockedStake = divByFraction(lockedStake, 1 ether - streamrConfig.slashingFraction());
        }
        return max(lockedStake, minimumStakeWei);
    }

    /**
     * Info about flag packed in 32 bytes:
     * 20 bytes: flagger address
     * 4 bytes: vote start timestamp
     * 4 bytes: vote fraction for kick (100% = 2**32 = 4294967296)
     * 4 bytes: vote fraction against kick (100% = 2**32 = 4294967296)
     */
    function getFlagData(address target) override external view returns (uint flagData) {
        if (voteStartTimestamp[target] == 0) {
            return 0;
        }
        return uint(bytes32(abi.encodePacked(
            uint160(flaggerAddress[target]),
            uint32(voteStartTimestamp[target]),
            uint32(2**32 * votesForKick[target] / votersTotalValueWei[target]),
            uint32(2**32 * votesAgainstKick[target] / votersTotalValueWei[target])
        )));
    }

    /**
     * Start the flagging process: lock some of the flagger's and the target's stake, find reviewers
     */
    function onFlag(address target, address flagger) external {
        require(flagger != target, "error_cannotFlagSelf");
        require(voteStartTimestamp[target] == 0 && block.timestamp > protectionEndTimestamp[target], "error_cannotFlagAgain"); // solhint-disable-line not-rely-on-time
        require(stakedWei[target] > 0, "error_flagTargetNotStaked");

        // the flag target risks to lose a slashingFraction if the flag resolves to KICK
        // take at least slashingFraction of minimumStakeWei to ensure everyone can get paid, even if the target somehow has managed to go under the minimum stake
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

        // added locked stake may also raise the flagger's minimum stake
        lockedStakeWei[flagger] += flagStakeWei[target];
        require(stakedWei[flagger] >= getMinimumStakeOf(flagger), "error_notEnoughStake");

        IVoterRegistry voterRegistry = IVoterRegistry(streamrConfig.voterRegistry());
        uint voterCount = voterRegistry.voterCount();
        require(voterCount > 0, "error_noEligibleVoters");
        uint maxReviewerCount = streamrConfig.flagReviewerCount();
        // uint maxIterations = streamrConfig.flagReviewerSelectionIterations(); // avoid "stack too deep"

        // If we don't have a good randomness source set in streamrConfig, we generate the outcome from a seed deterministically.
        // Set the seed to only depend on target (until a voter (dis)appears), so that attacker who simulates transactions
        //   can't "re-roll" the reviewers e.g. once per block; instead, they only get to "re-roll" once every voter-set change
        bytes32 randomBytes32 = bytes32((voterCount << 160) | uint160(target));
        uint totalValueWei; // = 0
        uint biggestVoterWeight; // = 0
        Operator biggestVoter;
        for (uint i; reviewers[target].length < maxReviewerCount && (i < maxReviewerCount || i < streamrConfig.flagReviewerSelectionIterations()); i++) {
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
            try peer.onReviewRequest(target) {} catch {
                continue;
            }
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

        emit StakeLockUpdate(flagger, lockedStakeWei[flagger], getMinimumStakeOf(flagger));
        emit StakeLockUpdate(target, lockedStakeWei[target], getMinimumStakeOf(target));
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

    /** Vote ends either when everyone voted, or `streamrConfig.votingPeriodSeconds()` passed */
    function _endVote(address target) private {
        // Some stake may be "lost" during the flagging, e.g. if flagger or target forceUnstaked while some of their stake was locked.
        // Send the leftovers out of the contract in order to make it impossible for malicious operators to get them for themselves:
        //   an operator can deliberately lose their delegators' tokens, and leaving them into the Sponsorship would enable the operator to pocket them
        uint leftoverWei = (votesForKick[target] > votesAgainstKick[target]) ? _handleKick(target) : _handleNoKick(target);
        token.transfer(streamrConfig.protocolFeeBeneficiary(), leftoverWei);

        delete flaggerAddress[target];
        delete voteStartTimestamp[target];
        delete voteEndTimestamp[target];
        delete targetStakeAtRiskWei[target];

        delete reviewers[target];
        // reviewerState was cleaned up inside the reviewer payment loop in _kick() or _noKick()
        delete votesForKick[target];
        delete votesAgainstKick[target];
        delete votersTotalValueWei[target];

        delete flaggerRewardWei[target];
        delete reviewerRewardWei[target];
        delete flagStakeWei[target];

        emit SponsorshipUpdate(totalStakedWei, remainingWei, uint32(operatorCount), isRunning());
    }

    function safeSendRewards(address to, uint amountWei) internal returns (uint actuallySentWei) {
        (bool success, bytes memory owner) = to.call(abi.encodeWithSignature("owner()")); // solhint-disable-line avoid-low-level-calls
        if (success && owner.length == 32) {
            try token.transferAndCall(to, amountWei, owner) {
                actuallySentWei = amountWei;
            } catch {}
        }
    }

    /** successful flag: target gets kicked and the flagger+reviewers are paid from the slashing */
    function _handleKick(address target) private returns (uint leftoverWei) {
        address flagger = flaggerAddress[target];
        uint reviewerCount = reviewers[target].length;

        // Take the slashing from target's locked stake...
        uint slashingWei = targetStakeAtRiskWei[target];
        if (lockedStakeWei[target] >= slashingWei) {
            lockedStakeWei[target] -= slashingWei;
            _kick(target, slashingWei); // ignore return value, there should be enough (now unlocked) stake to slash
        } else {
            //...unless target has forceUnstaked, in which case the locked stake was moved into forfeited stake, and they already paid for the KICK
            forfeitedStakeWei -= slashingWei - lockedStakeWei[target];
            lockedStakeWei[target] = 0;
            if (stakedWei[target] > 0) {
                emit StakeLockUpdate(target, lockedStakeWei[target], getMinimumStakeOf(target));
            }
        }

        // Unlock the flagger's stake and pay them from the slashed stake
        uint flagStake = flagStakeWei[target];
        if (lockedStakeWei[flagger] >= flagStake) {
            lockedStakeWei[flagger] -= flagStake;
            slashingWei -= safeSendRewards(flagger, flaggerRewardWei[target]);
        } else {
            //...unless flagger has forceUnstaked or been kicked; so unlock the remaining part from forfeitedStake
            forfeitedStakeWei -= flagStake - lockedStakeWei[flagger];
            lockedStakeWei[flagger] = 0;
            leftoverWei += flagStake;
        }
        if (stakedWei[flagger] > 0) {
            emit StakeLockUpdate(flagger, lockedStakeWei[flagger], getMinimumStakeOf(flagger));
        }

        // pay from the slashed stake those reviewers who voted correctly
        for (uint i; i < reviewerCount; i++) {
            Operator reviewer = reviewers[target][i];
            if (reviewerState[target][reviewer] == VOTED_KICK) {
                slashingWei -= safeSendRewards(address(reviewer), reviewerRewardWei[target]);
            }
            delete reviewerState[target][reviewer]; // clean up here, to avoid another loop
        }

        // after flagger and reviewers got paid, the rest belongs to no one (target still must be slashed to keep the negative incentive)
        leftoverWei += slashingWei;
        emit FlagUpdate(target, FlagState.KICKED, votesForKick[target], votesAgainstKick[target], address(0), 0);
    }

    /** false flag: no kick, flagger pays the reviewers */
    function _handleNoKick(address target) private returns (uint leftoverWei) {
        address flagger = flaggerAddress[target];
        uint reviewerCount = reviewers[target].length;

        // Unlock the target's stake
        uint targetStake = targetStakeAtRiskWei[target];
        if (lockedStakeWei[target] >= targetStake) {
            lockedStakeWei[target] -= targetStake;
        } else {
            //...unless target has forceUnstaked, in which case the locked stake was moved into forfeited stake
            // unlock the remaining part from forfeitedStake
            forfeitedStakeWei -= targetStake - lockedStakeWei[target];
            lockedStakeWei[target] = 0;
            leftoverWei += targetStake;
        }
        if (stakedWei[target] > 0) {
            emit StakeLockUpdate(target, lockedStakeWei[target], getMinimumStakeOf(target));
        }

        // Pay the reviewers who voted correctly from the flagger's stake, return the leftovers to the flagger
        protectionEndTimestamp[target] = block.timestamp + streamrConfig.flagProtectionSeconds(); // solhint-disable-line not-rely-on-time
        uint rewardsWei; // = 0
        for (uint i; i < reviewerCount; i++) {
            Operator reviewer = reviewers[target][i];
            if (reviewerState[target][reviewer] == VOTED_NO_KICK) {
                rewardsWei += safeSendRewards(address(reviewer), reviewerRewardWei[target]);
            }
            delete reviewerState[target][reviewer]; // clean up here, to avoid another loop
        }

        // Unlock the flagger's stake. Slash just enough to cover the rewards, the rest will be unlocked = released
        uint flagStake = flagStakeWei[target];
        if (lockedStakeWei[flagger] >= flagStake) {
            lockedStakeWei[flagger] -= flagStake;
            _slash(flagger, rewardsWei);
        } else {
            //...unless flagger has forceUnstaked or been kicked, in which case the locked flag-stake was moved into forfeited stake
            forfeitedStakeWei -= flagStake - lockedStakeWei[flagger];
            lockedStakeWei[flagger] = 0;
            leftoverWei += flagStake - rewardsWei;
        }
        if (stakedWei[flagger] > 0) {
            emit StakeLockUpdate(flagger, lockedStakeWei[flagger], getMinimumStakeOf(flagger));
        }

        emit FlagUpdate(target, FlagState.NOT_KICKED, votesForKick[target], votesAgainstKick[target], address(0), 0);
    }
}
