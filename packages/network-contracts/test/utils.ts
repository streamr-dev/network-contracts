import { upgrades, ethers as hardhatEthers } from "hardhat"
const { provider: hardhatProvider } = hardhatEthers
import { utils, Wallet } from "ethers"

import type { Bounty, BountyFactory, BrokerPool, BrokerPoolFactory, IAllocationPolicy,
    IJoinPolicy, IKickPolicy, ILeavePolicy, IPoolJoinPolicy, IPoolYieldPolicy, IPoolExitPolicy, StreamrConstants } from "../typechain"
import { TestToken } from "../typechain/TestToken"

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

export function newPoolName(): string {
    return `Pool-${Date.now()}-${poolindex++}`
}

export type TestContracts = {
    token: TestToken;
    minStakeJoinPolicy: IJoinPolicy;
    maxBrokersJoinPolicy: IJoinPolicy;
    allocationPolicy: IAllocationPolicy;
    leavePolicy: ILeavePolicy;
    kickPolicy: IKickPolicy;
    bountyFactory: BountyFactory;
    bountyTemplate: Bounty;
    poolFactory: BrokerPoolFactory;
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
    const token = await (await getContractFactory("TestToken", deployer)).deploy("TestToken", "TEST") as TestToken
    const streamrConstants = await (await getContractFactory("StreamrConstants", deployer)).deploy() as StreamrConstants
    await streamrConstants.deployed()
    // bounty and policies
    const minStakeJoinPolicy = await (await getContractFactory("MinimumStakeJoinPolicy", deployer)).deploy() as IJoinPolicy
    const maxBrokersJoinPolicy = await (await getContractFactory("MaxAmountBrokersJoinPolicy", deployer)).deploy() as IJoinPolicy
    const allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", deployer)).deploy() as IAllocationPolicy
    const leavePolicy = await (await getContractFactory("DefaultLeavePolicy", deployer)).deploy() as ILeavePolicy
    const kickPolicy = await (await getContractFactory("AdminKickPolicy", deployer)).deploy() as IKickPolicy
    const bountyTemplate = await (await getContractFactory("Bounty")).deploy() as Bounty
    await bountyTemplate.deployed()

    // function initialize(address templateAddress, address trustedForwarderAddress, address _tokenAddress) public initializer {
    const bountyFactoryFactory = await getContractFactory("BountyFactory", deployer)
    const bountyFactory = await upgrades.deployProxy(bountyFactoryFactory, [
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
    ])).wait()

    // broker pool and policies
    const poolTemplate = await (await getContractFactory("BrokerPool")).deploy() as BrokerPool
    const defaultPoolJoinPolicy = await (await getContractFactory("DefaultPoolJoinPolicy", deployer)).deploy() as IPoolJoinPolicy
    const defaultPoolYieldPolicy = await (await getContractFactory("DefaultPoolYieldPolicy", deployer)).deploy() as IPoolYieldPolicy
    const defaultPoolExitPolicy = await (await getContractFactory("DefaultPoolExitPolicy", deployer)).deploy() as IPoolExitPolicy

    const poolFactoryFactory = await getContractFactory("BrokerPoolFactory", deployer)
    const poolFactory = await upgrades.deployProxy(poolFactoryFactory, [
        poolTemplate.address,
        token.address
    ]) as BrokerPoolFactory
    await poolFactory.deployed()
    await (await poolFactory.connect(deployer).addTrustedPolicies([
        defaultPoolJoinPolicy.address,
        defaultPoolYieldPolicy.address,
        defaultPoolExitPolicy.address,
    ])).wait()

    return {
        token, minStakeJoinPolicy, maxBrokersJoinPolicy, allocationPolicy, leavePolicy, kickPolicy, 
        bountyTemplate, bountyFactory, poolFactory, defaultPoolJoinPolicy, defaultPoolYieldPolicy, defaultPoolExitPolicy
    }
}

// export async function deployBrokerPool(deployer: Wallet, token: Contract, trustedForwarder?: Wallet): Promise<BrokerPool> {
//     const brokerPool = await (await getContractFactory("BrokerPool", deployer)).deploy() as BrokerPool
//     await brokerPool.deployed()
//     await (await brokerPool.initialize(
//         token.address,
//         deployer.address,
//         trustedForwarder?.address ?? "0x0000000000000000000000000000000000000000",
//         "0",
//     ))
//     return brokerPool
// }

export async function deployBountyContract(contracts: TestContracts, {
    minHorizonSeconds = 0,
    minBrokerCount = 1,
    penaltyPeriodSeconds = 0,
    minStakeWei = 1,
    maxBrokerCount = 100,
    allocationWeiPerSecond = parseEther("1"),
} = {}): Promise<Bounty> {
    const {
        token, minStakeJoinPolicy, maxBrokersJoinPolicy, allocationPolicy, leavePolicy, kickPolicy, bountyTemplate, bountyFactory
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
        ],
        [
            allocationWeiPerSecond.toString(),
            penaltyPeriodSeconds.toString(),
            "0",
            minStakeWei.toString(),
            maxBrokerCount.toString()
        ]
    )
    const bountyDeployReceipt = await bountyDeployTx.wait()
    const newBountyEvent = bountyDeployReceipt.events?.find((e) => e.event === "NewBounty")
    const newBountyAddress = newBountyEvent?.args?.bountyContract
    const bounty = bountyTemplate.attach(newBountyAddress)
    await (await token.approve(bounty.address, parseEther("100000"))).wait()
    return bounty
}
