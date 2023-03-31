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

    mapping (address => address) public flaggerAddress;

    enum Reviewer {
        NOT_SELECTED,
        IS_SELECTED,
        VOTED_KICK,
        VOTED_NO_KICK,
        IS_SELECTED_SECONDARY
    }

    mapping (address => uint) public voteStartTimestamp;
    mapping (address => uint) public voteEndTimestamp; // needs to be cached, in case config changes
    mapping (address => uint) public flagStakeWei; // needs to be cached, in case config changes
    mapping (address => uint) public flaggerRewardWei; // needs to be cached, in case config changes
    mapping (address => uint) public reviewerRewardWei; // needs to be cached, in case config changes
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
        if (voteStartTimestamp[broker] == 0) {
            return 0;
        }
        return uint(bytes32(abi.encodePacked(
            uint160(flaggerAddress[broker]),
            uint32(voteStartTimestamp[broker]),
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
        require(voteStartTimestamp[target] == 0 && block.timestamp > protectionEndTimestamp[target], "error_cannotFlagAgain"); // solhint-disable-line not-rely-on-time
        require(s.stakedWei[flagger] >= s.minimumStakeWei, "error_notEnoughStake");
        require(s.stakedWei[target] > 0, "error_flagTargetNotStaked");

        // the flag target risks to lose 10% if the flag resolves to KICK
        // take at least 10% of minimumStake to ensure everyone can get paid!
        targetStakeAtRiskWei[target] = max(s.stakedWei[target], s.minimumStakeWei) / 10;
        s.committedStakeWei[target] += targetStakeAtRiskWei[target];

        // cache these just in case the config changes during the flag
        flagStakeWei[target] = s.streamrConfig.flagStakeWei();
        voteStartTimestamp[target] = block.timestamp + s.streamrConfig.reviewPeriodSeconds(); // solhint-disable-line not-rely-on-time
        voteEndTimestamp[target] = voteStartTimestamp[target] + s.streamrConfig.votingPeriodSeconds(); // solhint-disable-line not-rely-on-time
        reviewerRewardWei[target] = s.streamrConfig.flagReviewerRewardWei();
        flaggerRewardWei[target] = s.streamrConfig.flaggerRewardWei();

        // TODO: after taking at least minimumStake, all 9/10s here are probably overthinking; it's enough that flagStakeWei is 10/9 of the total reviewer reward
        // the limit for flagging is 9/10s of the stake so that there's still room to get flagged and lose the remaining 10% of minimumStake
        s.committedStakeWei[flagger] += flagStakeWei[target];
        require(s.committedStakeWei[flagger] * 10 <= 9 * s.stakedWei[flagger], "error_notEnoughStake");
        flaggerAddress[target] = flagger;

        // only secondarily select peers that are in the same bounty as the flagging target
        BrokerPool[32] memory sameBountyPeers;
        uint sameBountyPeerCount = 0;

        BrokerPoolFactory factory = BrokerPoolFactory(s.streamrConfig.brokerPoolFactory());
        uint brokerPoolCount = factory.deployedBrokerPoolsLength();
        // uint randomBytes = block.difficulty; // see https://github.com/ethereum/solidity/pull/13759
        bytes32 randomBytes = keccak256(abi.encode(target, brokerPoolCount)); // TODO temporary hack; polygon doesn't seem to support PREVRANDAO yet

        // primary selection: live peers that are not in the same bounty
        uint maxIterations = s.streamrConfig.flagReviewerSelectionIterations();
        uint maxReviewerCount = s.streamrConfig.flagReviewerCount();
        for (uint i = 0; i < maxIterations && reviewers[target].length < maxReviewerCount; i++) {
            randomBytes >>= 8; // if flagReviewerCount > 20, replace this with keccak256(randomBytes) or smth
            uint index = uint(randomBytes) % brokerPoolCount;
            BrokerPool peer = factory.deployedBrokerPools(index);
            if (address(peer) == _msgSender() || address(peer) == target || reviewerState[target][peer] != Reviewer.NOT_SELECTED) {
                // console.log(index, "skipping", address(peer));
                continue;
            }
            // TODO: check is broker live
            if (s.stakedWei[address(peer)] > 0) {
                if (sameBountyPeerCount + reviewers[target].length < maxReviewerCount) {
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
            if (reviewers[target].length >= maxReviewerCount) {
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
        require(voteStartTimestamp[target] > 0, "error_notFlagged");
        require(block.timestamp > voteStartTimestamp[target], "error_votingNotStarted"); // solhint-disable-line not-rely-on-time
        if (block.timestamp > voteEndTimestamp[target]) { // solhint-disable-line not-rely-on-time
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
        GlobalStorage storage s = globalData();
        // console.log("endVote", target);
        address flagger = flaggerAddress[target];
        bool flaggerIsGone = s.stakedWei[flagger] == 0;
        bool targetIsGone = s.stakedWei[target] == 0;
        uint reviewerCount = reviewers[target].length;

        // release stake commitments before vote resolution so that slashings and kickings during resolution aren't affected
        // if either the flagger or the target has forceUnstaked or been kicked, the committed stake was moved to committedFundsWei
        if (flaggerIsGone) {
            s.committedFundsWei -= flagStakeWei[target];
        } else {
            s.committedStakeWei[flagger] -= flagStakeWei[target];
        }
        if (targetIsGone) {
            s.committedFundsWei -= targetStakeAtRiskWei[target];
        } else {
            s.committedStakeWei[target] -= targetStakeAtRiskWei[target];
        }

        if (votesForKick[target] > votesAgainstKick[target]) {
            uint slashingWei = targetStakeAtRiskWei[target];
            // if targetIsGone: the tokens are still in Bounty, accounted in committedFundsWei (which will be subtracted in cleanup, so no need to _slash)
            if (!targetIsGone) {
                _kick(target, slashingWei);
            }

            // pay the flagger and those reviewers who voted correctly from the slashed stake
            if (!flaggerIsGone) {
                token.transferAndCall(flagger, flaggerRewardWei[target], abi.encode(BrokerPool(flagger).broker()));
                slashingWei -= flaggerRewardWei[target];
            }
            for (uint i = 0; i < reviewerCount; i++) {
                BrokerPool reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_KICK) {
                    token.transferAndCall(address(reviewer), reviewerRewardWei[target], abi.encode(reviewer.broker()));
                    slashingWei -= reviewerRewardWei[target];
                }
                delete reviewerState[target][reviewer]; // clean up
            }
            _addSponsorship(address(this), slashingWei); // leftovers are added to sponsorship
        } else {
            // false flag, no kick; pay the reviewers who voted correctly from the flagger's stake, return the leftovers to the flagger
            protectionEndTimestamp[target] = block.timestamp + s.streamrConfig.flagProtectionSeconds(); // solhint-disable-line not-rely-on-time
            uint rewardsWei = 0;
            for (uint i = 0; i < reviewerCount; i++) {
                BrokerPool reviewer = reviewers[target][i];
                if (reviewerState[target][reviewer] == Reviewer.VOTED_NO_KICK) {
                    token.transferAndCall(address(reviewer), reviewerRewardWei[target], abi.encode(reviewer.broker()));
                    rewardsWei += reviewerRewardWei[target];
                }
                delete reviewerState[target][reviewer]; // clean up
            }
            if (flaggerIsGone) {
                uint leftoverWei = flagStakeWei[target] - rewardsWei;
                _addSponsorship(address(this), leftoverWei); // flagger forfeited its flagstake, so the leftovers go to sponsorship
            } else {
                _slash(flagger, rewardsWei); // just slash enough to cover the rewards, the rest will be uncommitted = released
            }
        }

        delete reviewers[target];
        delete flaggerAddress[target];
        delete voteStartTimestamp[target];
        delete voteEndTimestamp[target];
        delete targetStakeAtRiskWei[target];
        delete votesForKick[target];
        delete votesAgainstKick[target];
        delete flaggerRewardWei[target];
        delete reviewerRewardWei[target];
        delete flagStakeWei[target];
    }

    /* solhint-enable reentrancy */
}
