import assert from "assert"
import { utils, BigNumber, ContractReceipt } from "ethers"
import { ethers as hardhatEthers } from "hardhat"

import { Bounty, IAllocationPolicy, IJoinPolicy, IKickPolicy } from "../../../typechain"
import type { TestContracts } from "./deployTestContracts"

const { parseEther } = utils
const { getContractFactory } = hardhatEthers

export let bountyCounter = 0

/**
 * "Happy path" Bounty deployment from BountyFactory
 * TODO: Maybe even a library (such as streamr-client), one day... :)
 */
export async function deployBounty(
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
    overrideKickPolicy?: IKickPolicy,
): Promise<Bounty> {
    const {
        token,
        maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy,
        allocationPolicy, leavePolicy, adminKickPolicy, voteKickPolicy,
        bountyTemplate, bountyFactory
    } = contracts

    /**
     * From BountyFactory.sol:deployBounty:
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
    const bountyDeployTx = await bountyFactory.deployBounty(
        minimumStakeWei.toString(),
        minHorizonSeconds.toString(),
        minBrokerCount.toString(),
        `Bounty-${bountyCounter++}-${Date.now()}`,
        policyAdresses,
        policyParams
    )
    const bountyDeployReceipt = await bountyDeployTx.wait() as ContractReceipt
    const newBountyEvent = bountyDeployReceipt.events?.find((e) => e.event === "NewBounty")
    const newBountyAddress = newBountyEvent?.args?.bountyContract
    const bounty = bountyTemplate.attach(newBountyAddress)
    await (await token.approve(bounty.address, parseEther("100000"))).wait()
    return bounty
}

/**
 * Deploy the Bounty contract directly, skipping the factory
 * This is useful for tests that don't want e.g. the mandatory VoteKickPolicy policy
 */
export async function deployBountyContract(
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
): Promise<Bounty> {
    const {
        token, deployer,
        maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy,
        allocationPolicy, leavePolicy, adminKickPolicy, voteKickPolicy,
    } = contracts

    const bounty = await (await getContractFactory("Bounty", { signer: deployer })).deploy()
    await bounty.deployed()
    await bounty.initialize(
        contracts.streamrConstants.address,
        deployer.address,
        token.address,
        minimumStakeWei.toString(),
        minHorizonSeconds.toString(),
        minBrokerCount.toString(),
        overrideAllocationPolicy?.address ?? allocationPolicy.address,
        overrideAllocationPolicyParam ?? allocationWeiPerSecond.toString()
    )

    await bounty.setKickPolicy(adminKickInsteadOfVoteKick ? adminKickPolicy.address : voteKickPolicy.address, "0")
    if (penaltyPeriodSeconds > -1) {
        await bounty.setLeavePolicy(leavePolicy.address, penaltyPeriodSeconds.toString())
    }
    if (maxBrokerCount > -1) {
        bounty.addJoinPolicy(maxBrokersJoinPolicy.address, maxBrokerCount.toString())
    }
    if (brokerPoolOnly) {
        await bounty.addJoinPolicy(brokerPoolOnlyJoinPolicy.address, "0")
    }
    if (extraJoinPolicies) {
        assert(extraJoinPolicyParams, "must give extraJoinPolicyParams if giving extraJoinPolicies")
        assert(extraJoinPolicies.length === extraJoinPolicyParams.length, "extraJoinPolicies and extraJoinPolicyParams must be same length")
        for (let i = 0; i < extraJoinPolicies.length; i++) {
            await bounty.addJoinPolicy(extraJoinPolicies[i].address, extraJoinPolicyParams[i])
        }
    }
    // renounce DEFAULT_ADMIN_ROLE because factory does it, too (no other reason so far)
    await (await bounty.renounceRole(await bounty.DEFAULT_ADMIN_ROLE(), deployer.address)).wait()
    await (await token.approve(bounty.address, parseEther("100000"))).wait()
    return bounty
}
