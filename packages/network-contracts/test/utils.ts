import { upgrades, ethers as hardhatEthers } from "hardhat"
const { provider: hardhatProvider } = hardhatEthers
import { utils, Wallet } from "ethers"

import type { Bounty, BountyFactory, BrokerPool, BrokerPoolFactory, IAllocationPolicy, TestToken,
    IJoinPolicy, IKickPolicy, ILeavePolicy, IPoolJoinPolicy, IPoolYieldPolicy, IPoolExitPolicy, StreamrConstants } from "../typechain"

const { parseEther } = utils
const { getContractFactory } = hardhatEthers
let poolindex = 0

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
    kickPolicy: IKickPolicy;
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
    const kickPolicy = await (await getContractFactory("AdminKickPolicy", deployer)).deploy()
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
        kickPolicy.address,
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
        bountyTemplate, bountyFactory, minStakeJoinPolicy, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy, allocationPolicy, leavePolicy, kickPolicy,
        poolTemplate, poolFactory, defaultPoolJoinPolicy, defaultPoolYieldPolicy, defaultPoolExitPolicy,
    }
}

/**
 * @param deployer should be the broker's Wallet
 * @returns BrokerPool
 */
export async function deployBrokerPool(contracts: TestContracts, deployer: Wallet, {
    maintenanceMarginPercent = 0,
    maxBrokerDivertPercent = 0,
    minBrokerStakePercent = 0,
    brokerSharePercent = 0,
} = {}): Promise<BrokerPool> {
    const {
        poolFactory, poolTemplate,
    } = contracts
    const brokerPoolReceipt = await (await poolFactory.connect(deployer).deployBrokerPool(
        0,
        `Pool-${Date.now()}-${poolindex++}`,
        [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
        [0, minBrokerStakePercent, 0, maintenanceMarginPercent, minBrokerStakePercent, brokerSharePercent, maxBrokerDivertPercent, 0]
    )).wait()
    const newPoolAddress = brokerPoolReceipt.events?.find((e) => e.event === "NewBrokerPool")?.args?.poolAddress
    return poolTemplate.attach(newPoolAddress).connect(deployer)
}

export async function deployBountyContract(contracts: TestContracts, {
    minHorizonSeconds = 0,
    minBrokerCount = 1,
    penaltyPeriodSeconds = 0,
    minStakeWei = 1,
    maxBrokerCount = 100,
    allocationWeiPerSecond = parseEther("1"),
    brokerPoolOnly = false,    // TODO: add test for true
} = {}): Promise<Bounty> {
    const {
        token,
        minStakeJoinPolicy, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy,
        allocationPolicy, leavePolicy, kickPolicy,
        bountyTemplate, bountyFactory
    } = contracts
    /**
     * Policies array is interpreted as follows:
     *   0: allocation policy (address(0) for none)
     *   1: leave policy (address(0) for none)
     *   2: kick policy (address(0) for none)
     *   3+: join policies (leave out if none)
     * @param policies smart contract addresses found in the trustedPolicies
     function deployBountyAgreement(
        uint32 initialMinHorizonSeconds,
        uint32 initialMinBrokerCount,
        string memory bountyName,
        address[] memory policies,
        uint[] memory initParams
    )
    */
    const bountyDeployTx = await bountyFactory.deployBountyAgreement(
        minHorizonSeconds.toString(),
        minBrokerCount.toString(),
        `Bounty-${Date.now()}`,
        [
            allocationPolicy.address,
            leavePolicy.address,
            kickPolicy.address,
            minStakeJoinPolicy.address,
            maxBrokersJoinPolicy.address,
            ...(brokerPoolOnly ? [brokerPoolOnlyJoinPolicy.address] : []),
        ],
        [
            allocationWeiPerSecond.toString(),
            penaltyPeriodSeconds.toString(),
            "0",
            minStakeWei.toString(),
            maxBrokerCount.toString(),
            ...(brokerPoolOnly ? ["0"] : []),
        ]
    )
    const bountyDeployReceipt = await bountyDeployTx.wait()
    const newBountyEvent = bountyDeployReceipt.events?.find((e) => e.event === "NewBounty")
    const newBountyAddress = newBountyEvent?.args?.bountyContract
    const bounty = bountyTemplate.attach(newBountyAddress)
    await (await token.approve(bounty.address, parseEther("100000"))).wait()
    return bounty
}
