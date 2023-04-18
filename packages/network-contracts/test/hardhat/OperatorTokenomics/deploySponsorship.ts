import assert from "assert"
import { utils, BigNumber, ContractReceipt } from "ethers"
import { ethers as hardhatEthers } from "hardhat"

import { Sponsorship, IAllocationPolicy, IJoinPolicy, IKickPolicy } from "../../../typechain"
import type { TestContracts } from "./deployTestContracts"

const { parseEther } = utils
const { getContractFactory } = hardhatEthers

export let sponsorshipCounter = 0

/**
 * "Happy path" Sponsorship deployment from SponsorshipFactory
 * TODO: Maybe even a library (such as streamr-client), one day... :)
 */
export async function deploySponsorship(
    contracts: TestContracts, {
        minimumStakeWei = parseEther("60"),
        minHorizonSeconds = 0,
        minBrokerCount = 1,
        penaltyPeriodSeconds = -1,
        maxBrokerCount = -1,
        allocationWeiPerSecond = parseEther("1"),
        brokerPoolOnly = false,
    } = {},
    extraJoinPolicies?: IJoinPolicy[],
    extraJoinPolicyParams?: string[],
    overrideAllocationPolicy?: IAllocationPolicy,
    overrideAllocationPolicyParam?: string,
    overrideKickPolicy?: IKickPolicy,
    overrideKickPolicyParam?: string,
): Promise<Sponsorship> {
    const {
        maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy,
        allocationPolicy, leavePolicy, voteKickPolicy,
        sponsorshipTemplate, sponsorshipFactory
    } = contracts

    /**
     * From SponsorshipFactory.sol:deploySponsorship:
     * Policies array is interpreted as follows:
     *   0: allocation policy (address(0) for none)
     *   1: leave policy (address(0) for none)
     *   2: kick policy (address(0) for none)
     *   3+: join policies (leave out if none)
     */
    const allocationPolicyAddress = overrideAllocationPolicy?.address ?? allocationPolicy.address
    const allocationPolicyParam = overrideAllocationPolicyParam ?? allocationWeiPerSecond.toString()
    const leavePolicyAddress = penaltyPeriodSeconds > -1 ? leavePolicy.address : "0x0000000000000000000000000000000000000000"
    const leavePolicyParam = penaltyPeriodSeconds > -1 ? penaltyPeriodSeconds.toString() : "0"
    const kickPolicyAddress = overrideKickPolicy?.address ?? voteKickPolicy.address
    const kickPolicyParam = overrideKickPolicyParam ?? "0"
    const policyAddresses = [allocationPolicyAddress, leavePolicyAddress, kickPolicyAddress]
    const policyParams = [allocationPolicyParam, leavePolicyParam, kickPolicyParam]
    if (maxBrokerCount > -1) {
        policyAddresses.push(maxBrokersJoinPolicy.address)
        policyParams.push(maxBrokerCount.toString())
    }
    if (brokerPoolOnly) {
        policyAddresses.push(brokerPoolOnlyJoinPolicy.address)
        policyParams.push("0")
    }
    if (extraJoinPolicies) {
        assert(extraJoinPolicyParams, "must give extraJoinPolicyParams if giving extraJoinPolicies")
        assert(extraJoinPolicies.length === extraJoinPolicyParams.length, "extraJoinPolicies and extraJoinPolicyParams must be same length")
        for (let i = 0; i < extraJoinPolicies.length; i++) {
            policyAddresses.push(extraJoinPolicies[i].address)
            policyParams.push(extraJoinPolicyParams[i])
        }
    }
    const sponsorshipDeployTx = await sponsorshipFactory.deploySponsorship(
        minimumStakeWei.toString(),
        minHorizonSeconds.toString(),
        minBrokerCount.toString(),
        `Sponsorship-${sponsorshipCounter++}-${Date.now()}`,
        "metadata",
        policyAddresses,
        policyParams
    )
    const sponsorshipDeployReceipt = await sponsorshipDeployTx.wait() as ContractReceipt
    const newSponsorshipEvent = sponsorshipDeployReceipt.events?.find((e) => e.event === "NewSponsorship")
    const newSponsorshipAddress = newSponsorshipEvent?.args?.sponsorshipContract
    return sponsorshipTemplate.attach(newSponsorshipAddress)
}

/**
 * Deploy the Sponsorship contract directly, skipping the factory
 * This is useful for tests that don't want e.g. the mandatory VoteKickPolicy policy
 */
export async function deploySponsorshipWithoutFactory(
    contracts: TestContracts, {
        minimumStakeWei = BigNumber.from(1),
        minHorizonSeconds = 0,
        minBrokerCount = 1,
        penaltyPeriodSeconds = -1,
        maxBrokerCount = -1,
        allocationWeiPerSecond = parseEther("1"),
        brokerPoolOnly = false,
        adminKickInsteadOfVoteKick = false,
    } = {},
    extraJoinPolicies?: IJoinPolicy[],
    extraJoinPolicyParams?: string[],
    overrideAllocationPolicy?: IAllocationPolicy,
    overrideAllocationPolicyParam?: string,
): Promise<Sponsorship> {
    const {
        token, deployer,
        maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy,
        allocationPolicy, leavePolicy, adminKickPolicy, voteKickPolicy,
    } = contracts

    const sponsorship = await (await getContractFactory("Sponsorship", { signer: deployer })).deploy()
    await sponsorship.deployed()
    await sponsorship.initialize(
        "streamID",
        "metadata",
        contracts.streamrConfig.address,
        token.address,
        [
            minimumStakeWei.toString(),
            minHorizonSeconds.toString(),
            minBrokerCount.toString(),
            overrideAllocationPolicyParam ?? allocationWeiPerSecond.toString()
        ],
        overrideAllocationPolicy?.address ?? allocationPolicy.address,
    )

    await sponsorship.setKickPolicy(adminKickInsteadOfVoteKick ? adminKickPolicy.address : voteKickPolicy.address, deployer.address)
    if (penaltyPeriodSeconds > -1) {
        await sponsorship.setLeavePolicy(leavePolicy.address, penaltyPeriodSeconds.toString())
    }
    if (maxBrokerCount > -1) {
        sponsorship.addJoinPolicy(maxBrokersJoinPolicy.address, maxBrokerCount.toString())
    }
    if (brokerPoolOnly) {
        await sponsorship.addJoinPolicy(brokerPoolOnlyJoinPolicy.address, "0")
    }
    if (extraJoinPolicies) {
        assert(extraJoinPolicyParams, "must give extraJoinPolicyParams if giving extraJoinPolicies")
        assert(extraJoinPolicies.length === extraJoinPolicyParams.length, "extraJoinPolicies and extraJoinPolicyParams must be same length")
        for (let i = 0; i < extraJoinPolicies.length; i++) {
            await sponsorship.addJoinPolicy(extraJoinPolicies[i].address, extraJoinPolicyParams[i])
        }
    }
    // renounce DEFAULT_ADMIN_ROLE because factory does it, too (no other reason so far)
    await (await sponsorship.renounceRole(await sponsorship.DEFAULT_ADMIN_ROLE(), deployer.address)).wait()
    await (await token.approve(sponsorship.address, parseEther("100000"))).wait()
    return sponsorship
}
