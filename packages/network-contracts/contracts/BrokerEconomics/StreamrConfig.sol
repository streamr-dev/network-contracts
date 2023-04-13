// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title Chain-specific parameters and addresses for the Streamr Network tokenomics (Bounty, BrokerPool)
 */
contract StreamrConfig is Initializable, UUPSUpgradeable, AccessControlUpgradeable {

    /**
     * 10% of minimumStakeWei must be enough to pay reviewers+flagger
     * That is: minimumStakeWei >= 10 * (flaggerRewardWei + flagReviewerCount * flagReviewerRewardWei)
     */
    function minimumStakeWei() public view returns (uint) {
        return 10 * (flaggerRewardWei + flagReviewerCount * flagReviewerRewardWei);
    }

    /**
     * maxPenaltyPeriodSeconds is the global maximum time a bounty can slash a broker for leaving any Bounty early.
     *
     * For a given Bounty b, b. is the minimum time a broker has to be in a bounty without being slashed.
     * This value can vary from bounty to bounty, and it can be 0, then the broker can leave immediately
     * without being slashed.
     *
     * maxPenaltyPeriodSeconds is the global maximum value that MIN_JOIN_TIME can have across all bounties.
     * This garuantees that a broker (and thus a pool) can get the money back from any and all bounties
     * without being slashed (provided it does the work) in a fixed maximum time.
     *
     * TODO: is this actually used/needed? It's only used when setting penaltyperiod, but what's the other constraint where it should be used?
     */
    uint public maxPenaltyPeriodSeconds;

    /**
     * The real-time precise pool value can not be kept track of, since it would mean looping through all bounties in each transaction.
     * Everyone can update the "pool-value" of a list of Bounties.
     * If the difference between the actual "pool-value sum" and the updated pool-value sum is more than poolValueDriftLimitFraction,
     *   the broker is slashed a little when updateApproximatePoolvalueOfBounties is called.
     * This means broker should call updateApproximatePoolvalueOfBounties often enough to not get slashed.
     * Fraction means this value is between 0.0 ~ 1.0, expressed as multiple of 1e18, like ETH or tokens.
     */
    uint public poolValueDriftLimitFraction;

    /**
     * In case "pool-value sum" of updateApproximatePoolvalueOfBounties is above poolValueDriftLimitFraction,
     *   this is the fraction of the broker's stake that is slashed.
     * Fraction means this value is between 0.0 ~ 1.0, expressed as multiple of 1e18, like ETH or tokens.
     */
    uint public poolValueDriftPenaltyFraction;

    /** How many reviewers we ideally (=usually) select to review a Bounty flag, see VoteKickPolicy.sol */
    uint public flagReviewerCount;

    /** How much we pay each reviewer that votes correctly */
    uint public flagReviewerRewardWei;

    /** How much we pay the flagger if the flagging-target gets kicked (a valid flag) */
    uint public flaggerRewardWei;

    /**
     * How many times we try to select a reviewer for a flagging.
     * Higher number makes it more likely we select a full flagReviewerCount, but may cost more gas.
     *
     * @dev Probability of finding flagReviewerCount peers for the review is: 1 - sum_{N = 0...flagReviewerCount-1} p(pick exactly N),
     *        and a non-worst-case first-order approximation is
     *              1 - (flagReviewerCount / peerCount) ^ (flagReviewerSelectionIterations - flagReviewerCount)
     *        for exact simulation, take a look at scripts/calculateFullReviewProbability.ts; some example values:
     *          - worst case: select 5 out of 7 (only one correct solution, everyone who can be selected must be selected!)
     *          => Probability of success after i iterations:  [ 0, 0, 0, 0, 0.0071, 0.0275, 0.0632, 0.1127, 0.1727, 0.2393,
     *                                       0.3087, 0.3781, 0.4451, 0.5083, 0.5668, 0.6201, 0.6682, 0.7111, 0.7492, 0.7827,
     *                                        0.812, 0.8377,   0.86, 0.8794, 0.8962, 0.9107, 0.9232,  0.934, 0.9433, 0.9513 ]
     *          - better case: select 5 out of 20
     *          => Success rate is 32% with the minimum of 5 iterations, 64% with 6 iterations, >99% after 10 iterations,
     *          => After 18 iterations, failure rate is less than 1 / 1 000 000
     *          - super duper worst case: select 32 out of 34
     *          => Success rate 16.5% after 100 iterations
     *          => Most likely number of reviewers after i iterations: [ 1,  2,  3,  4,  5,  5,  6,  7,  8,  8,
     *                           9, 10, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19,
     *                          19, 20, 20, 20, 21, 21, 21, 22, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25,
     *                          25, 25, 26, 26, 26, 26, 26, 26, 27, 27, 27, 27, 27, 27, 28, 28, 28, 28, 28, 28,
     *                          28, 28, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 30, 30, 30, 30, 30, 30, 30, 30,
     *                          30, 30, 30, 30, 30, 30, 31, 31, 31, 31 ], i.e. up to half (16), it picks every 1...2nd time, as you would expect
     */
    uint public flagReviewerSelectionIterations;

    /**
     * How much the flagger must stake to flag another BrokerPool in a Bounty.
     * @dev flagStakeWei must be enough to pay all the reviewers, even after the flagger would be kicked (and slashed 10% of the total stake).
     *      If the broker decides to reduceStake, committed stake is the limit how much stake must be left into Bounty.
     *      The total committed stake must be enough to pay the reviewers of all flags.
     *        flag stakes >= reviewer fees + 10% of stake that's left into the bounty (= committed)
     *      After n flags: n * flagStakeWei >= n * reviewer fees + 10% of total committed stake
     *        =>  n * flagStakeWei >= n * (flagReviewerCount * flagReviewerRewardWei) + 10% of (n * flagStakeWei) (assuming only flagging causes committed stake)
     *        =>  flagStakeWei * 9/10 >= flagReviewerCount * flagReviewerRewardWei
     *        =>  flagStakeWei >= flagReviewerCount * flagReviewerRewardWei * 10/9
     *      That is where the 10/9 comes from. TODO: not sure if this reasoning is necessary anymore, now that we always take at least 10% of minimumStake
     */
    uint public flagStakeWei;

    /**
     * How long to wait after flagging before voting can start.
     * Expect reviewers to do their review just before voting, in the end of this period.
     * The flagging target also gets some time to resume work.
     **/
    uint public reviewPeriodSeconds;

    /**
     * After reviewPeriodSeconds after flagging, the reviewers have a time window to submit their votes.
     */
    uint public votingPeriodSeconds;

    /**
     * When a flag-target is not kicked, their stake is uncommitted, and they can unstake their whole stake if they so wish.
     * To make it harder to grief by repeatedly flagging, the flag-target gets a short flag-protection after a no-kick vote.
     */
    uint public flagProtectionSeconds;

    address public bountyFactory;
    address public brokerPoolFactory;
    address public brokerPoolLivenessRegistry; // same as BrokerPoolFactory, for now

    /**
     * A mandatory joinpolicy for Bounties from BountyFactory. Ensures only BrokerPools from BrokerPoolFactory can join.
     */
    address public poolOnlyJoinPolicy;

    // TODO: initializer arguments?
    function initialize() public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);

        maxPenaltyPeriodSeconds = 30 days;
        poolValueDriftLimitFraction = 0.1 ether;
        poolValueDriftPenaltyFraction = 0.005 ether;
        flagReviewerCount = 5;
        flagReviewerRewardWei = 1 ether;
        flaggerRewardWei = 1 ether;
        flagReviewerSelectionIterations = 20;
        flagStakeWei = 10 ether;
        reviewPeriodSeconds = 1 days;
        votingPeriodSeconds = 1 hours;
        flagProtectionSeconds = 1 hours;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function setBountyFactory(address bountyFactoryAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bountyFactory = bountyFactoryAddress;
    }

    function setBrokerPoolFactory(address brokerPoolFactoryAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        brokerPoolFactory = brokerPoolFactoryAddress;
        brokerPoolLivenessRegistry = brokerPoolFactoryAddress;
    }

    function setPoolOnlyJoinPolicy(address poolOnlyJoinPolicyAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        poolOnlyJoinPolicy = poolOnlyJoinPolicyAddress;
    }

    function setMaxPenaltyPeriodSeconds(uint newMaxPenaltyPeriodSeconds) public onlyRole(DEFAULT_ADMIN_ROLE) {
        maxPenaltyPeriodSeconds = newMaxPenaltyPeriodSeconds;
    }

    function setPoolValueDriftLimitFraction(uint newPoolValueDriftLimitFraction) public onlyRole(DEFAULT_ADMIN_ROLE) {
        poolValueDriftLimitFraction = newPoolValueDriftLimitFraction;
    }

    function setPoolValueDriftPenaltyFraction(uint newPoolValueDriftPenaltyFraction) public onlyRole(DEFAULT_ADMIN_ROLE) {
        poolValueDriftPenaltyFraction = newPoolValueDriftPenaltyFraction;
    }

    /**
     * @dev For higher flagReviewerCount, VoteKickPolicy.onFlag needs more random bytes; keccak gives 256 bits of "randomness".
     * @dev It's also possible to tweak the >>= in the primary selection to something less than 8 (spend the randomness more slowly)
     * @dev   or even replace >>= with randomness source (though that's of course more expensive)
     */
    function setFlagReviewerCount(uint newFlagReviewerCount) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(flagReviewerCount >= 1, "error_tooLow");
        require(flagReviewerCount <= 32, "error_tooHigh");
        flagReviewerCount = newFlagReviewerCount;
    }

    function setFlagReviewerRewardWei(uint newFlagReviewerRewardWei) public onlyRole(DEFAULT_ADMIN_ROLE) {
        flagReviewerRewardWei = newFlagReviewerRewardWei;
    }

    function setFlaggerRewardWei(uint newFlaggerRewardWei) public onlyRole(DEFAULT_ADMIN_ROLE) {
        flaggerRewardWei = newFlaggerRewardWei;
    }

    function setFlagReviewerSelectionIterations(uint newFlagReviewerSelectionIterations) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFlagReviewerSelectionIterations >= flagReviewerCount, "error_tooLow"); // we can't select more than 1 reviewer per iteration
        flagReviewerSelectionIterations = newFlagReviewerSelectionIterations;
    }

    function setFlagStakeWei(uint newFlagStakeWei) public onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFlagStakeWei >= flagReviewerCount * flagReviewerRewardWei * 10 / 9, "error_tooLow");
        flagStakeWei = newFlagStakeWei;
    }

    function setReviewPeriodSeconds(uint newReviewPeriodSeconds) public onlyRole(DEFAULT_ADMIN_ROLE) {
        reviewPeriodSeconds = newReviewPeriodSeconds;
    }

    function setVotingPeriodSeconds(uint newVotingPeriodSeconds) public onlyRole(DEFAULT_ADMIN_ROLE) {
        votingPeriodSeconds = newVotingPeriodSeconds;
    }

    function setFlagProtectionSeconds(uint newFlagProtectionSeconds) public onlyRole(DEFAULT_ADMIN_ROLE) {
        flagProtectionSeconds = newFlagProtectionSeconds;
    }
}
