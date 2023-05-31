import assert from "assert"
import { utils, BigNumber, ContractReceipt, Wallet } from "ethers"
import { ethers as hardhatEthers } from "hardhat"

import { Sponsorship, IAllocationPolicy, IJoinPolicy, IKickPolicy, StreamRegistryV4 } from "../../../typechain"
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
        minOperatorCount = 1,
        penaltyPeriodSeconds = -1,
        maxOperatorCount = -1,
        allocationWeiPerSecond = parseEther("1"),
    } = {},
    extraJoinPolicies?: IJoinPolicy[],
    extraJoinPolicyParams?: string[],
    overrideAllocationPolicy?: IAllocationPolicy,
    overrideAllocationPolicyParam?: string,
    overrideKickPolicy?: IKickPolicy,
    overrideKickPolicyParam?: string,
): Promise<Sponsorship> {
    const {
        deployer,
        maxOperatorsJoinPolicy, allocationPolicy, leavePolicy, voteKickPolicy,
        sponsorshipTemplate, sponsorshipFactory,
        streamRegistry,
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
    if (maxOperatorCount > -1) {
        policyAddresses.push(maxOperatorsJoinPolicy.address)
        policyParams.push(maxOperatorCount.toString())
    }
    if (extraJoinPolicies) {
        assert(extraJoinPolicyParams, "must give extraJoinPolicyParams if giving extraJoinPolicies")
        assert(extraJoinPolicies.length === extraJoinPolicyParams.length, "extraJoinPolicies and extraJoinPolicyParams must be same length")
        for (let i = 0; i < extraJoinPolicies.length; i++) {
            policyAddresses.push(extraJoinPolicies[i].address)
            policyParams.push(extraJoinPolicyParams[i])
        }
    }
    const streamId = createStream(deployer.address, streamRegistry)
    const sponsorshipDeployTx = await sponsorshipFactory.deploySponsorship(
        minimumStakeWei.toString(),
        minHorizonSeconds.toString(),
        minOperatorCount.toString(),
        streamId,
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
        minOperatorCount = 1,
        penaltyPeriodSeconds = -1,
        maxOperatorCount = -1,
        allocationWeiPerSecond = parseEther("1"),
        operatorOnly = false,
        adminKickInsteadOfVoteKick = false,
    } = {},
    extraJoinPolicies?: IJoinPolicy[],
    extraJoinPolicyParams?: string[],
    overrideAllocationPolicy?: IAllocationPolicy,
    overrideAllocationPolicyParam?: string,
): Promise<Sponsorship> {
    const {
        token, deployer,
        maxOperatorsJoinPolicy, operatorContractOnlyJoinPolicy,
        allocationPolicy, leavePolicy, adminKickPolicy, voteKickPolicy,
        streamRegistry,
    } = contracts

    const sponsorship = await (await getContractFactory("Sponsorship", { signer: deployer })).deploy()
    await sponsorship.deployed()
    const streamId = createStream(deployer.address, streamRegistry)
    await sponsorship.initialize(
        streamId,
        "metadata",
        contracts.streamrConfig.address,
        token.address,
        [
            minimumStakeWei.toString(),
            minHorizonSeconds.toString(),
            minOperatorCount.toString(),
            overrideAllocationPolicyParam ?? allocationWeiPerSecond.toString()
        ],
        overrideAllocationPolicy?.address ?? allocationPolicy.address,
    )

    await sponsorship.setKickPolicy(adminKickInsteadOfVoteKick ? adminKickPolicy.address : voteKickPolicy.address, deployer.address)
    if (penaltyPeriodSeconds > -1) {
        await sponsorship.setLeavePolicy(leavePolicy.address, penaltyPeriodSeconds.toString())
    }
    if (maxOperatorCount > -1) {
        sponsorship.addJoinPolicy(maxOperatorsJoinPolicy.address, maxOperatorCount.toString())
    }
    if (operatorOnly) {
        await sponsorship.addJoinPolicy(operatorContractOnlyJoinPolicy.address, "0")
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

async function createStream(deployerAddress: string, streamRegistry: StreamRegistryV4): Promise<string> {
    const streamPath = "/" + sponsorshipCounter++
    const streamId = deployerAddress.toLowerCase() + streamPath
    await (await streamRegistry.createStream(streamPath, streamId)).wait()
    return streamId
}