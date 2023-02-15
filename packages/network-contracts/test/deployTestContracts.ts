import { upgrades, ethers as hardhatEthers } from "hardhat"
const { provider: hardhatProvider } = hardhatEthers
import { Wallet } from "ethers"

import type { Bounty, BountyFactory, BrokerPool, BrokerPoolFactory, IAllocationPolicy, TestToken,
    IJoinPolicy, IKickPolicy, ILeavePolicy, IPoolJoinPolicy, IPoolYieldPolicy, IPoolExitPolicy, StreamrConstants } from "../typechain"

const { getContractFactory } = hardhatEthers

export const log = (..._: unknown[]): void => { /* skip logging */ }
// export const { log } = console // TODO: use pino for logging?

export async function advanceToTimestamp(timestamp: number, message?: string): Promise<void> {
    log("\nt = %s ", timestamp, message ?? "")
    await hardhatProvider.send("evm_setNextBlockTimestamp", [timestamp])
    await hardhatProvider.send("evm_mine", [0])
}

/** Block timestamp, rounded up to nearest million for test log readability */
export async function getBlockTimestamp(): Promise<number> {
    return Math.floor(((await hardhatProvider.getBlock("latest")).timestamp / 1000000) + 1) * 1000000
}

export type TestContracts = {
    token: TestToken;
    streamrConstants: StreamrConstants;
    minStakeJoinPolicy: IJoinPolicy;
    maxBrokersJoinPolicy: IJoinPolicy;
    brokerPoolOnlyJoinPolicy: IJoinPolicy
    allocationPolicy: IAllocationPolicy;
    leavePolicy: ILeavePolicy;
    adminKickPolicy: IKickPolicy;
    voteKickPolicy: IKickPolicy;
    bountyFactory: BountyFactory;
    bountyTemplate: Bounty;
    poolFactory: BrokerPoolFactory;
    poolTemplate: BrokerPool;
    defaultPoolJoinPolicy: IPoolJoinPolicy;
    defaultPoolYieldPolicy: IPoolYieldPolicy;
    defaultPoolExitPolicy: IPoolExitPolicy;
}

/**
 * Deploy all contracts needed by tests. This should be called in "before/beforeAll".
 *     see @openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol
 * @param deployer wallet used for all deployments
 * @returns mapping: name string -> ethers.Contract object
 */
export async function deployTestContracts(deployer: Wallet): Promise<TestContracts> {
    const token = await (await getContractFactory("TestToken", deployer)).deploy("TestToken", "TEST")
    const streamrConstants = await upgrades.deployProxy(await getContractFactory("StreamrConstants", deployer), []) as StreamrConstants
    await streamrConstants.deployed()

    // bounty and policies
    const minStakeJoinPolicy = await (await getContractFactory("MinimumStakeJoinPolicy", deployer)).deploy()
    const maxBrokersJoinPolicy = await (await getContractFactory("MaxAmountBrokersJoinPolicy", deployer)).deploy()
    const brokerPoolOnlyJoinPolicy = await (await getContractFactory("BrokerPoolOnlyJoinPolicy", deployer)).deploy()
    const allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", deployer)).deploy()
    const leavePolicy = await (await getContractFactory("DefaultLeavePolicy", deployer)).deploy()
    const adminKickPolicy = await (await getContractFactory("AdminKickPolicy", deployer)).deploy()
    const voteKickPolicy = await (await getContractFactory("VoteKickPolicy", deployer)).deploy()
    const bountyTemplate = await (await getContractFactory("Bounty")).deploy()
    await bountyTemplate.deployed()

    const bountyFactory = await upgrades.deployProxy(await getContractFactory("BountyFactory", deployer), [
        bountyTemplate.address,
        token.address,
        streamrConstants.address
    ]) as BountyFactory
    await bountyFactory.deployed()
    await (await bountyFactory.connect(deployer).addTrustedPolicies([
        allocationPolicy.address,
        leavePolicy.address,
        adminKickPolicy.address,
        voteKickPolicy.address,
        minStakeJoinPolicy.address,
        maxBrokersJoinPolicy.address,
        brokerPoolOnlyJoinPolicy.address,
    ])).wait()

    // broker pool and policies
    const poolTemplate = await (await getContractFactory("BrokerPool")).deploy()
    const defaultPoolJoinPolicy = await (await getContractFactory("DefaultPoolJoinPolicy", deployer)).deploy()
    const defaultPoolYieldPolicy = await (await getContractFactory("DefaultPoolYieldPolicy", deployer)).deploy()
    const defaultPoolExitPolicy = await (await getContractFactory("DefaultPoolExitPolicy", deployer)).deploy()

    const poolFactory = await upgrades.deployProxy(await getContractFactory("BrokerPoolFactory", deployer), [
        poolTemplate.address,
        token.address,
        streamrConstants.address
    ]) as BrokerPoolFactory
    await poolFactory.deployed()
    await (await poolFactory.connect(deployer).addTrustedPolicies([
        defaultPoolJoinPolicy.address,
        defaultPoolYieldPolicy.address,
        defaultPoolExitPolicy.address,
    ])).wait()

    await (await streamrConstants.setBountyFactory(bountyFactory.address)).wait()
    await (await streamrConstants.setBrokerPoolFactory(poolFactory.address)).wait()

    return {
        token, streamrConstants,
        bountyTemplate, bountyFactory, minStakeJoinPolicy, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy, allocationPolicy, 
        leavePolicy, adminKickPolicy, voteKickPolicy, poolTemplate, poolFactory, defaultPoolJoinPolicy, defaultPoolYieldPolicy, defaultPoolExitPolicy,
    }
}
