import { Contract } from "@ethersproject/contracts"
import { parseEther } from "@ethersproject/units"

import { sponsorshipABI } from "./exports"

import { Sponsorship, IAllocationPolicy, IJoinPolicy, IKickPolicy, StreamRegistryV4 } from "../typechain"
import type { StreamrContracts } from "./StreamrEnvDeployer"

let sponsorshipCounter = 0

/**
 * "Happy path" Sponsorship deployment from SponsorshipFactory
 * TODO: Maybe even a library (such as streamr-client), one day... :)
 */
export async function deploySponsorship(
    contracts: StreamrContracts,
    {
        minOperatorCount = 1,
        penaltyPeriodSeconds = -1,
        maxOperatorCount = -1,
        allocationWeiPerSecond = parseEther("1"),
        sponsoredStreamId = "",
    } = {},
    extraJoinPolicies?: IJoinPolicy[],
    extraJoinPolicyParams?: string[],
    overrideAllocationPolicy?: IAllocationPolicy,
    overrideAllocationPolicyParam?: string,
    overrideKickPolicy?: IKickPolicy,
    overrideKickPolicyParam?: string,
): Promise<Sponsorship> {
    const {
        maxOperatorsJoinPolicy,
        stakeWeightedAllocationPolicy,
        defaultLeavePolicy,
        voteKickPolicy,
        sponsorshipFactory,
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
    const allocationPolicyAddress = overrideAllocationPolicy?.address ?? stakeWeightedAllocationPolicy.address
    const allocationPolicyParam = overrideAllocationPolicyParam ?? allocationWeiPerSecond.toString()
    const leavePolicyAddress = penaltyPeriodSeconds > -1 ? defaultLeavePolicy.address : "0x0000000000000000000000000000000000000000"
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
        if (!extraJoinPolicyParams) { throw new Error("must give extraJoinPolicyParams if giving extraJoinPolicies") }
        if (extraJoinPolicies.length !== extraJoinPolicyParams.length) {
            throw new Error("extraJoinPolicies and extraJoinPolicyParams must be same length")
        }
        for (let i = 0; i < extraJoinPolicies.length; i++) {
            policyAddresses.push(extraJoinPolicies[i].address)
            policyParams.push(extraJoinPolicyParams[i])
        }
    }
    const streamId = sponsoredStreamId || await createStream(streamRegistry)
    const sponsorshipDeployTx = await sponsorshipFactory.deploySponsorship(
        minOperatorCount.toString(),
        streamId,
        "metadata",
        policyAddresses,
        policyParams
    )
    const sponsorshipDeployReceipt = await sponsorshipDeployTx.wait() // as ContractReceipt
    const newSponsorshipEvent = sponsorshipDeployReceipt.events?.find((e) => e.event === "NewSponsorship")
    const newSponsorshipAddress = newSponsorshipEvent?.args?.sponsorshipContract
    return new Contract(newSponsorshipAddress, sponsorshipABI, sponsorshipFactory.signer) as Sponsorship
}

async function createStream(streamRegistry: StreamRegistryV4): Promise<string> {
    const deployerAddress = await streamRegistry.signer.getAddress()
    const streamPath = "/sponsorship/" + sponsorshipCounter++
    const streamId = deployerAddress.toLowerCase() + streamPath
    await (await streamRegistry.createStream(streamPath, streamId)).wait()
    return streamId
}
