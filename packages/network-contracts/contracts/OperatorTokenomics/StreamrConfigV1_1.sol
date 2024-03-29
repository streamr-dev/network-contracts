// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title Chain-specific parameters and addresses for the Streamr Network tokenomics (Sponsorship, Operator)
 *
 * `ADMIN_ROLE()` can grant `CONFIGURATOR_ROLE()` to others, who can then change the parameters.
 * `ADMIN_ROLE()` can grant `UPGRADER_ROLE()` to others, who can then upgrade this contract.
 */
// solhint-disable-next-line contract-name-camelcase
contract StreamrConfigV1_1 is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CONFIGURATOR_ROLE = keccak256("CONFIGURATOR_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    event ConfigChanged(string indexed key, uint indexed newValue, address indexed newAddress);

    error TooHigh(uint value, uint limit);
    error TooLow(uint value, uint limit);

    /**
     * Division by a "fraction" expressed as multiple of 1e18, like ether (1e18 = 100%)
     * @return result = x / fraction, rounding UP
     */
    function divByFraction(uint x, uint fraction) internal pure returns (uint) {
        return (x * 1 ether + fraction - 1) / fraction;
    }

    /**
     * Minimum stake whose slashing is enough to pay reviewers+flagger in case of a voting that results in KICK.
     * That is: stakeWei * slashingFraction >= flaggerRewardWei + flagReviewerCount * flagReviewerRewardWei
     * Or: minimumStakeWei = total rewards / slashingFraction
     * Round UP so that the possible rounding error doesn't cause reward money to run out. Better to require 1 wei too much than too little.
     */
    function minimumStakeWei() public view returns (uint) {
        return divByFraction(flaggerRewardWei + flagReviewerCount * flagReviewerRewardWei, slashingFraction);
    }

    /**
     * Fraction of stake that operators lose if they are found to be violating protocol rules and kicked out from a sponsorship
     */
    uint public slashingFraction;

    /**
     * The minimum share of the Operator contract's own token should belong to the owner ("skin in the game")
     * By default, further delegation is prevented if the operator's own delegation would fall below this fraction of the total delegations (= token supply).
     **/
    uint public minimumSelfDelegationFraction;

    /** Prevent "sand delegations" that could mess with rounding errors */
    uint public minimumDelegationWei;

    /**
     * The time the operator is given for paying out the undelegation queue.
     * If the front of the queue is older than maxQueueSeconds, anyone can call forceUnstake to pay out the queue.
     */
    uint public maxQueueSeconds;

    /**
     * maxPenaltyPeriodSeconds is the global maximum time a sponsorship can require an operator to stay under threat of earlyLeaverPenalty.
     * Penalty period can vary from sponsorship to sponsorship, or it can also be 0, in which case
     *   the operators can unstake immediately after staking without being slashed.
     */
    uint public maxPenaltyPeriodSeconds;

    /**
     * DefaultLeavePolicy: If an operator unstakes from a Sponsorship before penaltyPeriodSeconds is over, they get slashed earlyLeaverPenaltyWei.
     */
    uint public earlyLeaverPenaltyWei;

    /**
     * The real-time precise operator value (that includes earnings) can not be kept track of,
     *   since it would mean looping through all Sponsorships in each transaction.
     * However, if `withdrawEarningsFromSponsorships` is called often enough, the `valueWithoutEarnings` is a good approximation.
     * If the withdrawn earnings are more than `maxAllowedEarningsFraction * valueWithoutEarnings`,
     *   then `fishermanRewardFraction` is the fraction of the withdrawn earnings that is un-selfdelegated (burned) from the operator and sent to the fisherman
     * This means operator should call `withdrawEarningsFromSponsorships` often enough to not accumulate too much earnings.
     * Fraction means this value is between 0.0 ~ 1.0, expressed as multiple of 1e18, like ETH or tokens.
     */
    uint public maxAllowedEarningsFraction;

    /**
     * If the withdrawn earnings are more than `maxAllowedEarningsFraction * valueWithoutEarnings`,
     *   then `fishermanRewardFraction` is the fraction of the withdrawn earnings that is un-selfdelegated (burned) from the operator and sent to the fisherman
     * E.g. if `fishermanRewardFraction = 0.1`, and the incoming earnings are 100 DATA, then whoever called the `withdrawEarningsFromSponsorships` will receive 10 DATA.
     * Fraction means this value is between 0.0 ~ 1.0, expressed as multiple of 1e18, like ETH or tokens.
     */
    uint public fishermanRewardFraction;

    /** Protocol fee is collected when earnings arrive to Operator, fraction expressed as fixed-point decimal between 0.0 ~ 1.0, like ether: 1e18 ~= 100% */
    uint public protocolFeeFraction;

    /** Address where the protocol fee is sent */
    address public protocolFeeBeneficiary;

    /** As a sybil defense, only voters that control this fraction of global staking are eligible to vote */
    uint public minEligibleVoterFractionOfAllStake;

    /** As a sybil defense, too new operators can't be selected as voters if this is set to non-zero */
    uint public minEligibleVoterAge;

    /** How many reviewers we ideally (=usually) select to review a Sponsorship flag, see VoteKickPolicy.sol */
    uint public flagReviewerCount;

    /** How much we pay each reviewer that votes correctly */
    uint public flagReviewerRewardWei;

    /** How much we pay the flagger if the flagging-target gets kicked (a valid flag) */
    uint public flaggerRewardWei;

    /** How many times we try to select a reviewer for a flagging. */
    uint public flagReviewerSelectionIterations;

    /** How much the flagger must stake to flag another Operator in a Sponsorship. */
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
     * When a flag-target is not kicked, their stake is unlocked, and they can unstake their whole stake if they so wish.
     * To make it harder to grief by repeatedly flagging, the flag-target gets a short flag-protection after a no-kick vote.
     */
    uint public flagProtectionSeconds;

    address public sponsorshipFactory;
    address public operatorFactory;
    address public voterRegistry; // same as OperatorFactory, for now

    address public trustedForwarder;

    /**
     * A mandatory joinpolicy for Sponsorships from SponsorshipFactory. Ensures only contracts deployed by this.operatorFactory() can join.
     */
    address public operatorContractOnlyJoinPolicy;

    address public streamRegistryAddress;

    /**
     * If there's good randomness available in the network, plug in a random oracle here.
     * Zero by default; in the case, use fallback to give back cheap pseudorandom numbers.
     **/
    address public randomOracle;

    /** Prevent "skimming the earnings" by delegating, withdrawing and instantly undelegating */
    uint public minimumDelegationSeconds;

    function initialize() public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _setupRole(ADMIN_ROLE, msg.sender);
        _setupRole(UPGRADER_ROLE, msg.sender);
        _setupRole(CONFIGURATOR_ROLE, msg.sender);
        _setRoleAdmin(ADMIN_ROLE, ADMIN_ROLE);
        _setRoleAdmin(UPGRADER_ROLE, ADMIN_ROLE);
        _setRoleAdmin(CONFIGURATOR_ROLE, ADMIN_ROLE);

        setSlashingFraction(0.1 ether); // 10% of stake is slashed if operator gets kicked after a vote
        setEarlyLeaverPenaltyWei(5000 ether); // at least initially earlyLeaverPenalty is set to the same as minimum stake

        // Operator's "skin in the game" = minimum share of total delegation (= Operator token supply)
        setMinimumSelfDelegationFraction(0.05 ether); // 5% of the operator tokens must be held by the operator, or else new delegations are prevented

        // Prevent "sand delegations", set minimum delegation to 1 full operator token (1e18)
        setMinimumDelegationWei(1 ether);

        // Prevent "skimming the earnings" by delegating, withdrawing and instantly undelegating
        setMinimumDelegationSeconds(2 days);

        // Sponsorship leave penalty parameter limit
        setMaxPenaltyPeriodSeconds(14 days);

        // Undelegation escape hatch: self-service available after maxQueueSeconds
        // Must be more than maxPenaltyPeriodSeconds to allow operator to service the queue in all cases
        setMaxQueueSeconds(30 days);

        // Withdraw incentivization
        setMaxAllowedEarningsFraction(0.05 ether); // 5% of valueWithoutEarnings is when fisherman gets rewarded from the operator's self-delegation
        setFishermanRewardFraction(0.25 ether); // 25% of withdrawn earnings

        // protocol fee
        setProtocolFeeFraction(0.05 ether); // 5% of earnings go to protocol fee
        setProtocolFeeBeneficiary(msg.sender);

        // flagging + voting
        setMinEligibleVoterAge(0); // no age limit
        setMinEligibleVoterFractionOfAllStake(0.005 ether); // every voter controls at least 0.5% of global stake
        setFlagReviewerCount(7);
        setFlagReviewerRewardWei(20 ether);
        setFlaggerRewardWei(360 ether);
        setFlagReviewerSelectionIterations(20);
        setFlagStakeWei(500 ether);
        setReviewPeriodSeconds(1 hours);
        setVotingPeriodSeconds(15 minutes);
        setFlagProtectionSeconds(1 hours);
    }

    function setSlashingFraction(uint newSlashingFraction) public onlyRole(CONFIGURATOR_ROLE) {
        if (newSlashingFraction >= 1 ether) {
            // can't be 100%
            revert TooHigh({ value: newSlashingFraction, limit: 1 ether });
        }
        slashingFraction = newSlashingFraction;
        emit ConfigChanged("slashingFraction", newSlashingFraction, address(0));
    }

    function setEarlyLeaverPenaltyWei(uint newEarlyLeaverPenaltyWei) public onlyRole(CONFIGURATOR_ROLE) {
        earlyLeaverPenaltyWei = newEarlyLeaverPenaltyWei;
        emit ConfigChanged("earlyLeaverPenaltyWei", newEarlyLeaverPenaltyWei, address(0));
    }

    function setMinimumDelegationWei(uint newMinimumDelegationWei) public onlyRole(CONFIGURATOR_ROLE) {
        minimumDelegationWei = newMinimumDelegationWei;
        emit ConfigChanged("minimumDelegationWei", newMinimumDelegationWei, address(0));
    }

    function setMinimumDelegationSeconds(uint newMinimumDelegationSeconds) public onlyRole(CONFIGURATOR_ROLE) {
        minimumDelegationSeconds = newMinimumDelegationSeconds;
        emit ConfigChanged("minimumDelegationSeconds", newMinimumDelegationSeconds, address(0));
    }

    function setMinimumSelfDelegationFraction(uint newMinimumSelfDelegationFraction) public onlyRole(CONFIGURATOR_ROLE) {
        if (newMinimumSelfDelegationFraction > 1 ether) {
            // can't be more than 100%
            revert TooHigh({ value: newMinimumSelfDelegationFraction, limit: 1 ether });
        }
        minimumSelfDelegationFraction = newMinimumSelfDelegationFraction;
        emit ConfigChanged("minimumSelfDelegationFraction", newMinimumSelfDelegationFraction, address(0));
    }

    /**
     * maxPenaltyPeriodSeconds is the global maximum time a sponsorship can require an operator to stay under threat of earlyLeaverPenalty.
     * Penalty period can vary from sponsorship to sponsorship, or it can also be 0, in which case
     *   the operators can unstake immediately after staking without being slashed.
     * Can't be more than maxQueueSeconds. This guarantees that forceUnstake due to queue age can never slash earlyLeaverPenaltyWei.
     */
    function setMaxPenaltyPeriodSeconds(uint newMaxPenaltyPeriodSeconds) public onlyRole(CONFIGURATOR_ROLE) {
        maxPenaltyPeriodSeconds = newMaxPenaltyPeriodSeconds;
        emit ConfigChanged("maxPenaltyPeriodSeconds", newMaxPenaltyPeriodSeconds, address(0));
    }

    /**
     * The time the operator is given for paying out the undelegation queue.
     * If the front of the queue is older than maxQueueSeconds, anyone can call forceUnstake to pay out the queue.
     * Can't be less than maxPenaltyPeriodSeconds. This guarantees that forceUnstake due to queue age can never slash earlyLeaverPenaltyWei.
     **/
    function setMaxQueueSeconds(uint newMaxQueueSeconds) public onlyRole(CONFIGURATOR_ROLE) {
        if (newMaxQueueSeconds <= maxPenaltyPeriodSeconds) {
            revert TooLow({
                value: newMaxQueueSeconds,
                limit: maxPenaltyPeriodSeconds
            });
        }
        maxQueueSeconds = newMaxQueueSeconds;
        emit ConfigChanged("maxQueueSeconds", newMaxQueueSeconds, address(0));
    }

    function setMaxAllowedEarningsFraction(uint newMaxAllowedEarningsFraction) public onlyRole(CONFIGURATOR_ROLE) {
        if (newMaxAllowedEarningsFraction > 1 ether) {
            // can't be more than 100%
            revert TooHigh({ value: newMaxAllowedEarningsFraction, limit: 1 ether });
        }
        maxAllowedEarningsFraction = newMaxAllowedEarningsFraction;
        emit ConfigChanged("maxAllowedEarningsFraction", newMaxAllowedEarningsFraction, address(0));
    }

    function setFishermanRewardFraction(uint newFishermanRewardFraction) public onlyRole(CONFIGURATOR_ROLE) {
        if (newFishermanRewardFraction > 1 ether) {
            // can't be more than 100%
            revert TooHigh({ value: newFishermanRewardFraction, limit: 1 ether });
        }
        fishermanRewardFraction = newFishermanRewardFraction;
        emit ConfigChanged("fishermanRewardFraction", newFishermanRewardFraction, address(0));
    }

    function setProtocolFeeFraction(uint newProtocolFeeFraction) public onlyRole(CONFIGURATOR_ROLE) {
        if (newProtocolFeeFraction > 1 ether) {
            // can't be more than 100%
            revert TooHigh({ value: newProtocolFeeFraction, limit: 1 ether });
        }
        protocolFeeFraction = newProtocolFeeFraction;
        emit ConfigChanged("protocolFeeFraction", newProtocolFeeFraction, address(0));
    }

    function setProtocolFeeBeneficiary(address newProtocolFeeBeneficiary) public onlyRole(CONFIGURATOR_ROLE) {
        protocolFeeBeneficiary = newProtocolFeeBeneficiary;
        emit ConfigChanged("protocolFeeBeneficiary", 0, newProtocolFeeBeneficiary);
    }

    function setMinEligibleVoterAge(uint ageLimitSeconds) public onlyRole(CONFIGURATOR_ROLE) {
        minEligibleVoterAge = ageLimitSeconds;
        emit ConfigChanged("minEligibleVoterAge", ageLimitSeconds, address(0));
    }

    function setMinEligibleVoterFractionOfAllStake(uint newMinEligibleVoterFractionOfAllStake) public onlyRole(CONFIGURATOR_ROLE) {
        if (newMinEligibleVoterFractionOfAllStake > 1 ether) {
            // can't be more than 100%
            revert TooHigh({ value: newMinEligibleVoterFractionOfAllStake, limit: 1 ether });
        }
        minEligibleVoterFractionOfAllStake = newMinEligibleVoterFractionOfAllStake;
        emit ConfigChanged("minEligibleVoterFractionOfAllStake", newMinEligibleVoterFractionOfAllStake, address(0));
    }

    function setFlagReviewerCount(uint newFlagReviewerCount) public onlyRole(CONFIGURATOR_ROLE) {
        if (newFlagReviewerCount < 1) { revert TooLow({ value: newFlagReviewerCount, limit: 1 }); }
        flagReviewerCount = newFlagReviewerCount;
        // we can't select more than 1 reviewer per iteration, so we have to try at least as many times
        if (flagReviewerSelectionIterations < flagReviewerCount) {
            flagReviewerSelectionIterations = flagReviewerCount;
        }
        emit ConfigChanged("flagReviewerCount", newFlagReviewerCount, address(0));
    }

    function setFlagReviewerRewardWei(uint newFlagReviewerRewardWei) public onlyRole(CONFIGURATOR_ROLE) {
        flagReviewerRewardWei = newFlagReviewerRewardWei;
        emit ConfigChanged("flagReviewerRewardWei", newFlagReviewerRewardWei, address(0));
    }

    function setFlaggerRewardWei(uint newFlaggerRewardWei) public onlyRole(CONFIGURATOR_ROLE) {
        flaggerRewardWei = newFlaggerRewardWei;
        emit ConfigChanged("flaggerRewardWei", newFlaggerRewardWei, address(0));
    }

    /**
     * Reviewer selection iterations: higher number makes it more likely we select a full flagReviewerCount, but may cost more gas.
     * @param newFlagReviewerSelectionIterations how many times we try to select a reviewer for a flagging.
     * @dev Probability of finding flagReviewerCount peers for the review is: 1 - sum_{N = 0...flagReviewerCount-1} p(pick exactly N),
     * @dev   and a non-worst-case first-order approximation is
     * @dev         1 - (flagReviewerCount / peerCount) ^ (flagReviewerSelectionIterations - flagReviewerCount)
     * @dev   for exact simulation, take a look at scripts/calculateFullReviewProbability.ts; some example values:
     * @dev     - worst case: select 5 out of 7 (only one correct solution, everyone who can be selected must be selected!)
     * @dev     => Probability of success after i iterations:  [ 0, 0, 0, 0, 0.0071, 0.0275, 0.0632, 0.1127, 0.1727, 0.2393,
     * @dev                                  0.3087, 0.3781, 0.4451, 0.5083, 0.5668, 0.6201, 0.6682, 0.7111, 0.7492, 0.7827,
     * @dev                                   0.812, 0.8377,   0.86, 0.8794, 0.8962, 0.9107, 0.9232,  0.934, 0.9433, 0.9513 ]
     * @dev     - better case: select 5 out of 20
     * @dev     => Success rate is 32% with the minimum of 5 iterations, 64% with 6 iterations, >99% after 10 iterations,
     * @dev     => After 18 iterations, failure rate is less than 1 / 1 000 000
     * @dev     - super duper worst case: select 32 out of 34
     * @dev     => Success rate 16.5% after 100 iterations
     * @dev     => Most likely number of reviewers after i iterations: [ 1,  2,  3,  4,  5,  5,  6,  7,  8,  8,
     * @dev                      9, 10, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19,
     * @dev                     19, 20, 20, 20, 21, 21, 21, 22, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25,
     * @dev                     25, 25, 26, 26, 26, 26, 26, 26, 27, 27, 27, 27, 27, 27, 28, 28, 28, 28, 28, 28,
     * @dev                     28, 28, 29, 29, 29, 29, 29, 29, 29, 29, 29, 29, 30, 30, 30, 30, 30, 30, 30, 30,
     * @dev                     30, 30, 30, 30, 30, 30, 31, 31, 31, 31 ], i.e. up to half (16), it picks every 1...2nd time, as you would expect
     */
    function setFlagReviewerSelectionIterations(uint newFlagReviewerSelectionIterations) public onlyRole(CONFIGURATOR_ROLE) {
        if (newFlagReviewerSelectionIterations < flagReviewerCount) {
            revert TooLow({
                value: newFlagReviewerSelectionIterations,
                limit: flagReviewerCount
            });
        }
        flagReviewerSelectionIterations = newFlagReviewerSelectionIterations;
        emit ConfigChanged("flagReviewerSelectionIterations", newFlagReviewerSelectionIterations, address(0));
    }

    /**
     * @dev flagStakeWei must be enough to pay all the reviewers, even after the flagger would be kicked (and slashed the "slashingFraction" of the total stake).
     * @dev If the operator decides to reduceStake, locked stake is the limit how much stake must be left into Sponsorship.
     * @dev The total locked stake must be enough to pay the reviewers of all flags.
     * @dev   flag stakes >= reviewer fees + slashing from the locked stake
     * @dev After n flags: n * flagStakeWei >= n * reviewer fees + slashing from total locked stake
     * @dev   =>  flagStakeWei >= flagReviewerCount * flagReviewerRewardWei + slashingFraction * flagStakeWei (assuming only flagging causes locked stake)
     * @dev   =>  flagStakeWei >= flagReviewerCount * flagReviewerRewardWei / (1 - slashingFraction)
     * @dev round UP, it's better to require a 1 wei too much than too little
     */
    function setFlagStakeWei(uint newFlagStakeWei) public onlyRole(CONFIGURATOR_ROLE) {
        uint minFlagStakeWei = divByFraction(flagReviewerCount * flagReviewerRewardWei, 1 ether - slashingFraction);
        if (newFlagStakeWei < minFlagStakeWei) {
            revert TooLow({
                value: newFlagStakeWei,
                limit: minFlagStakeWei
            });
        }
        flagStakeWei = newFlagStakeWei;
        emit ConfigChanged("flagStakeWei", newFlagStakeWei, address(0));
    }

    function setReviewPeriodSeconds(uint newReviewPeriodSeconds) public onlyRole(CONFIGURATOR_ROLE) {
        reviewPeriodSeconds = newReviewPeriodSeconds;
        emit ConfigChanged("reviewPeriodSeconds", newReviewPeriodSeconds, address(0));
    }

    function setVotingPeriodSeconds(uint newVotingPeriodSeconds) public onlyRole(CONFIGURATOR_ROLE) {
        votingPeriodSeconds = newVotingPeriodSeconds;
        emit ConfigChanged("votingPeriodSeconds", newVotingPeriodSeconds, address(0));
    }

    function setFlagProtectionSeconds(uint newFlagProtectionSeconds) public onlyRole(CONFIGURATOR_ROLE) {
        flagProtectionSeconds = newFlagProtectionSeconds;
        emit ConfigChanged("flagProtectionSeconds", newFlagProtectionSeconds, address(0));
    }

    /**
     * If there's good randomness available in the network, plug in a random oracle here
     * For instance, in Ethereum mainnet, block.difficulty would be such, see https://github.com/ethereum/solidity/pull/13759
     * Important criterion is: it's not possible to know the outcome by simulating the transaction (e.g. using estimateGas)
     **/
    function setRandomOracle(address newRandomOracle) public onlyRole(CONFIGURATOR_ROLE) {
        randomOracle = newRandomOracle;
        emit ConfigChanged("randomOracle", 0, newRandomOracle);
    }

    function setTrustedForwarder(address newTrustedForwarder) public onlyRole(CONFIGURATOR_ROLE) {
        trustedForwarder = newTrustedForwarder;
        emit ConfigChanged("trustedForwarder", 0, newTrustedForwarder);
    }

    function setSponsorshipFactory(address sponsorshipFactoryAddress) external onlyRole(CONFIGURATOR_ROLE) {
        sponsorshipFactory = sponsorshipFactoryAddress;
        emit ConfigChanged("sponsorshipFactory", 0, sponsorshipFactoryAddress);
    }

    function setOperatorFactory(address operatorFactoryAddress) external onlyRole(CONFIGURATOR_ROLE) {
        operatorFactory = operatorFactoryAddress;
        voterRegistry = operatorFactoryAddress;
        emit ConfigChanged("operatorFactory", 0, operatorFactoryAddress);
        emit ConfigChanged("voterRegistry", 0, operatorFactoryAddress);
    }

    function setOperatorContractOnlyJoinPolicy(address operatorContractOnlyJoinPolicyAddress) external onlyRole(CONFIGURATOR_ROLE) {
        operatorContractOnlyJoinPolicy = operatorContractOnlyJoinPolicyAddress;
        emit ConfigChanged("operatorContractOnlyJoinPolicy", 0, operatorContractOnlyJoinPolicyAddress);
    }

    function setStreamRegistryAddress(address streamRegistryAddress_) external onlyRole(CONFIGURATOR_ROLE) {
        streamRegistryAddress = streamRegistryAddress_;
        emit ConfigChanged("streamRegistryAddress", 0, streamRegistryAddress_);
    }

    function _authorizeUpgrade(address newImplementation) internal onlyRole(UPGRADER_ROLE) override {}
}
