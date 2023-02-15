import assert from "assert"
import { utils, BigNumber } from "ethers"
import { Bounty, IAllocationPolicy, IJoinPolicy, IKickPolicy } from "../typechain"
import type { TestContracts } from "./deployTestContracts"

const { parseEther } = utils

export let bountyCounter = 0

/**
 * "Happy path" Bounty deployment from BountyFactory
 * TODO: Maybe even a library (such as streamr-client), one day... :)
 */
export async function deployBountyContract(
    contracts: TestContracts, {
        minHorizonSeconds = 0,
        minBrokerCount = 1,
        penaltyPeriodSeconds = -1,
        minStakeWei = BigNumber.from(-1),
        maxBrokerCount = -1,
        allocationWeiPerSecond = parseEther("1"),
        brokerPoolOnly = false,
        adminKickInsteadOfVoteKick = false,
    } = {},
    extraJoinPolicies?: IJoinPolicy[],
    extraJoinPolicyParams?: string[],
    overrideAllocationPolicy?: IAllocationPolicy,
    overrideAllocationPolicyParam?: string,
    overrideKickPolicy?: IKickPolicy,
): Promise<Bounty> {
    const {
        token,
        minStakeJoinPolicy, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy,
        allocationPolicy, leavePolicy, adminKickPolicy, voteKickPolicy,
        bountyTemplate, bountyFactory
    } = contracts

    /**
     * From BountyFactory.sol:deployBountyAgreement:
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
    const kickPolicyAddress = overrideKickPolicy?.address ?? (adminKickInsteadOfVoteKick ? adminKickPolicy.address : voteKickPolicy.address)
    const kickPolicyParam = "0"
    const policyAdresses = [allocationPolicyAddress, leavePolicyAddress, kickPolicyAddress]
    const policyParams = [allocationPolicyParam, leavePolicyParam, kickPolicyParam]
    if (minStakeWei.gt(-1)) {
        policyAdresses.push(minStakeJoinPolicy.address)
        policyParams.push(minStakeWei.toString())
    }
    if (maxBrokerCount > -1) {
        policyAdresses.push(maxBrokersJoinPolicy.address)
        policyParams.push(maxBrokerCount.toString())
    }
    if (brokerPoolOnly) {
        policyAdresses.push(brokerPoolOnlyJoinPolicy.address)
        policyParams.push("0")
    }
    if (extraJoinPolicies) {
        assert(extraJoinPolicyParams, "must give extraJoinPolicyParams if giving extraJoinPolicies")
        assert(extraJoinPolicies.length === extraJoinPolicyParams.length, "extraJoinPolicies and extraJoinPolicyParams must be same length")
        for (let i = 0; i < extraJoinPolicies.length; i++) {
            policyAdresses.push(extraJoinPolicies[i].address)
            policyParams.push(extraJoinPolicyParams[i])
        }
    }
    const bountyDeployTx = await bountyFactory.deployBountyAgreement(
        minHorizonSeconds.toString(),
        minBrokerCount.toString(),
        `Bounty-${bountyCounter++}-${Date.now()}`,
        policyAdresses,
        policyParams
    )
    const bountyDeployReceipt = await bountyDeployTx.wait()
    const newBountyEvent = bountyDeployReceipt.events?.find((e) => e.event === "NewBounty")
    const newBountyAddress = newBountyEvent?.args?.bountyContract
    const bounty = bountyTemplate.attach(newBountyAddress)
    await (await token.approve(bounty.address, parseEther("100000"))).wait()
    return bounty
}
