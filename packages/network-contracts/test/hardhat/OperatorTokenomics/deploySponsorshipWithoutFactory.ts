import { ContractFactory } from "@ethersproject/contracts"
import { parseEther } from "@ethersproject/units"

import { Sponsorship, IAllocationPolicy, IJoinPolicy, IKickPolicy } from "../../../typechain"
import { sponsorshipABI, sponsorshipBytecode } from "../../../src/exports"
import type { StreamrContracts } from "../../../src/StreamrEnvDeployer"

export let sponsorshipCounter = 0

/**
 * Deploy the Sponsorship contract directly, skipping the factory
 * This is useful for tests that don't want e.g. the mandatory VoteKickPolicy policy
 */
export async function deploySponsorshipWithoutFactory(
    contracts: StreamrContracts, {
        minHorizonSeconds = 0,
        minOperatorCount = 1,
        penaltyPeriodSeconds = -1,
        maxOperatorCount = -1,
        allocationWeiPerSecond = parseEther("1"),
        operatorOnly = false,
    } = {},
    extraJoinPolicies?: IJoinPolicy[],
    extraJoinPolicyParams?: string[],
    overrideAllocationPolicy?: IAllocationPolicy,
    overrideAllocationPolicyParam?: string,
    overrideKickPolicy?: IKickPolicy,
): Promise<Sponsorship> {
    const {
        DATA: token,
        maxOperatorsJoinPolicy: sponsorshipMaxOperatorsJoinPolicy,
        stakeWeightedAllocationPolicy: sponsorshipStakeWeightedAllocationPolicy,
        defaultLeavePolicy: sponsorshipDefaultLeavePolicy,
        voteKickPolicy: sponsorshipVoteKickPolicy,
        operatorContractOnlyJoinPolicy: sponsorshipOperatorContractOnlyJoinPolicy,
        streamRegistry,
    } = contracts

    // get sponsorship deploy tx signer from streamRegistry
    const deployerAddress = await streamRegistry.signer.getAddress()
    const sponsorship = await (new ContractFactory(
        sponsorshipABI,
        sponsorshipBytecode,
        streamRegistry.signer,
    )).deploy() as Sponsorship
    await sponsorship.deployed()

    const streamPath = "/sponsorship/" + sponsorshipCounter++
    const streamId = deployerAddress.toLowerCase() + streamPath
    await (await streamRegistry.createStream(streamPath, streamId)).wait()

    await sponsorship.initialize(
        streamId,
        "metadata",
        contracts.streamrConfig.address,
        token.address,
        [
            minHorizonSeconds.toString(),
            minOperatorCount.toString(),
            overrideAllocationPolicyParam ?? allocationWeiPerSecond.toString()
        ],
        overrideAllocationPolicy?.address ?? sponsorshipStakeWeightedAllocationPolicy.address,
    )

    await sponsorship.setKickPolicy(overrideKickPolicy?.address ?? sponsorshipVoteKickPolicy.address, deployerAddress)
    if (penaltyPeriodSeconds > -1) {
        await sponsorship.setLeavePolicy(sponsorshipDefaultLeavePolicy.address, penaltyPeriodSeconds.toString())
    }
    if (maxOperatorCount > -1) {
        sponsorship.addJoinPolicy(sponsorshipMaxOperatorsJoinPolicy.address, maxOperatorCount.toString())
    }
    if (operatorOnly) {
        await sponsorship.addJoinPolicy(sponsorshipOperatorContractOnlyJoinPolicy.address, "0")
    }
    if (extraJoinPolicies) {
        if (!extraJoinPolicyParams) { throw new Error("must give extraJoinPolicyParams if giving extraJoinPolicies") }
        if (extraJoinPolicies.length !== extraJoinPolicyParams.length) {
            throw new Error("extraJoinPolicies and extraJoinPolicyParams must be same length")
        }
        for (let i = 0; i < extraJoinPolicies.length; i++) {
            await sponsorship.addJoinPolicy(extraJoinPolicies[i].address, extraJoinPolicyParams[i])
        }
    }
    // renounce DEFAULT_ADMIN_ROLE because factory does it, too (no other reason so far)
    await (await sponsorship.renounceRole(await sponsorship.DEFAULT_ADMIN_ROLE(), deployerAddress)).wait()
    await (await token.approve(sponsorship.address, parseEther("100000"))).wait()
    return sponsorship
}
