import { ethers as hardhatEthers } from "hardhat"
import { Wallet, utils} from "ethers"

import type { Bounty, BountyFactory, BrokerPool, BrokerPoolFactory, IAllocationPolicy, TestToken,
    IJoinPolicy, IKickPolicy, ILeavePolicy, IPoolJoinPolicy, IPoolYieldPolicy, IPoolExitPolicy, StreamrConfig } from "../../../typechain"

const { getContractFactory } = hardhatEthers
import { Chains } from "@streamr/config"

const {
    CHAIN = "dev1",
} = process.env
const {
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
    }
} = Chains.load()[CHAIN]

export type TestContracts = {
    token: TestToken;
    streamrConfig: StreamrConfig;
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
    deployer: Wallet;
}

export async function deployPoolFactory(contracts: Partial<TestContracts>, signer: Wallet): Promise<{
    poolFactory: BrokerPoolFactory,
    poolTemplate: BrokerPool
}> {
    const {
        token, streamrConfig,
        defaultPoolJoinPolicy, defaultPoolYieldPolicy, defaultPoolExitPolicy,
    } = contracts
    const poolTemplate = await (await getContractFactory("BrokerPool", { signer })).deploy()
    const poolFactory = await (await getContractFactory("BrokerPoolFactory", { signer })).deploy()
    await poolFactory.deployed()
    await (await poolFactory.initialize(
        poolTemplate!.address,
        token!.address,
        streamrConfig!.address
    )).wait()
    await (await poolFactory.addTrustedPolicies([
        defaultPoolJoinPolicy!.address,
        defaultPoolYieldPolicy!.address,
        defaultPoolExitPolicy!.address,
    ])).wait()

    await (await streamrConfig!.setBrokerPoolFactory(poolFactory.address)).wait()
    await (await streamrConfig!.setStreamRegistryAddress(STREAM_REGISTRY_ADDRESS)).wait()

    return { poolFactory, poolTemplate }
}

/**
 * Deploy all contracts needed by tests. This should be called in "before/beforeAll".
 *     see @openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol
 * @param signer wallet used for all deployments
 * @returns mapping: name string -> ethers.Contract object
 */
export async function deployTestContracts(signer: Wallet): Promise<TestContracts> {
    const token = await (await getContractFactory("TestToken", { signer })).deploy("TestToken", "TEST")
    await (await token.mint(signer.address, utils.parseEther("1000000"))).wait()

    const streamrConfig = await (await getContractFactory("StreamrConfig", { signer })).deploy()
    await streamrConfig.deployed()
    await(await streamrConfig.initialize()).wait()

    // bounty and policies
    const maxBrokersJoinPolicy = await (await getContractFactory("MaxAmountBrokersJoinPolicy", { signer })).deploy()
    const brokerPoolOnlyJoinPolicy = await (await getContractFactory("BrokerPoolOnlyJoinPolicy", { signer })).deploy()
    const allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", { signer })).deploy()
    const leavePolicy = await (await getContractFactory("DefaultLeavePolicy", { signer })).deploy()
    const adminKickPolicy = await (await getContractFactory("AdminKickPolicy", { signer })).deploy()
    const voteKickPolicy = await (await getContractFactory("VoteKickPolicy", { signer })).deploy()
    const bountyTemplate = await (await getContractFactory("Bounty", { signer })).deploy()
    await bountyTemplate.deployed()

    const bountyFactory = await (await getContractFactory("BountyFactory", { signer })).deploy()
    await bountyFactory.deployed()
    await (await bountyFactory.initialize(
        bountyTemplate.address,
        token.address,
        streamrConfig.address
    )).wait()
    await bountyFactory.deployed()
    await (await bountyFactory.addTrustedPolicies([
        allocationPolicy.address,
        leavePolicy.address,
        adminKickPolicy.address,
        voteKickPolicy.address,
        maxBrokersJoinPolicy.address,
        brokerPoolOnlyJoinPolicy.address,
    ])).wait()

    await (await streamrConfig!.setPoolOnlyJoinPolicy(brokerPoolOnlyJoinPolicy.address)).wait()
    await (await streamrConfig!.setBountyFactory(bountyFactory.address)).wait()

    // broker pool and policies
    const defaultPoolJoinPolicy = await (await getContractFactory("DefaultPoolJoinPolicy", { signer })).deploy()
    const defaultPoolYieldPolicy = await (await getContractFactory("DefaultPoolYieldPolicy", { signer })).deploy()
    const defaultPoolExitPolicy = await (await getContractFactory("DefaultPoolExitPolicy", { signer })).deploy()

    const { poolFactory, poolTemplate } = await deployPoolFactory({
        token, streamrConfig,
        defaultPoolJoinPolicy, defaultPoolYieldPolicy, defaultPoolExitPolicy,
    }, signer)

    return {
        token, streamrConfig,
        bountyTemplate, bountyFactory, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy, allocationPolicy,
        leavePolicy, adminKickPolicy, voteKickPolicy, poolTemplate, poolFactory, defaultPoolJoinPolicy, defaultPoolYieldPolicy, defaultPoolExitPolicy,
        deployer: signer
    }
}
