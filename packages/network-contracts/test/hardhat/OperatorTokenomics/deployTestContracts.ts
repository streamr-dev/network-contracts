import { ethers as hardhatEthers, upgrades } from "hardhat"
import type { Wallet } from "ethers"

import type { Sponsorship, SponsorshipFactory, Operator, OperatorFactory, IAllocationPolicy, TestToken,
    StreamRegistryV4,
    IJoinPolicy, IKickPolicy, ILeavePolicy, IDelegationPolicy, IExchangeRatePolicy, IUndelegationPolicy,
    StreamrConfigV1_1, NodeModule, QueueModule, StakeModule, MinimalForwarder } from "../../../typechain"

const { getContractFactory } = hardhatEthers

export type TestContracts = {
    token: TestToken;
    streamrConfig: StreamrConfigV1_1;
    maxOperatorsJoinPolicy: IJoinPolicy;
    operatorContractOnlyJoinPolicy: IJoinPolicy
    allocationPolicy: IAllocationPolicy;
    leavePolicy: ILeavePolicy;
    adminKickPolicy: IKickPolicy;
    voteKickPolicy: IKickPolicy;
    sponsorshipFactory: SponsorshipFactory;
    sponsorshipTemplate: Sponsorship;
    operatorFactory: OperatorFactory;
    operatorTemplate: Operator;
    defaultDelegationPolicy: IDelegationPolicy;
    defaultExchangeRatePolicy: IExchangeRatePolicy;
    defaultUndelegationPolicy: IUndelegationPolicy;
    nodeModule: NodeModule;
    queueModule: QueueModule;
    stakeModule: StakeModule;
    minimalForwarder: MinimalForwarder;
    deployer: Wallet;
    streamRegistry: StreamRegistryV4;
}

export async function deployOperatorFactory(contracts: Partial<TestContracts>, signer: Wallet): Promise<{
    operatorFactory: OperatorFactory,
    operatorTemplate: Operator
}> {
    const {
        token, streamrConfig,
        defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy,
    } = contracts
    const operatorTemplate = await (await getContractFactory("Operator", { signer })).deploy()
    const contractFactory = await getContractFactory("OperatorFactory", signer)
    const operatorFactory = await(await upgrades.deployProxy(contractFactory, [
        operatorTemplate!.address,
        token!.address,
        streamrConfig!.address,
        contracts.nodeModule!.address,
        contracts.queueModule!.address,
        contracts.stakeModule!.address,
        // { gasLimit: 500000 } // solcover makes the gas estimation require 1000+ ETH for transaction, this fixes it
    ], { kind: "uups", unsafeAllow: ["delegatecall"] })).deployed() as OperatorFactory
    await (await operatorFactory.addTrustedPolicies([
        defaultDelegationPolicy!.address,
        defaultExchangeRatePolicy!.address,
        defaultUndelegationPolicy!.address
    ], { gasLimit: 500000 })).wait()
    await (await streamrConfig!.setOperatorFactory(operatorFactory.address)).wait()
    return { operatorFactory, operatorTemplate }
}

export async function deployStreamrConfig(deployer: Wallet): Promise<StreamrConfigV1_1> {
    const streamrConfigFactory = await getContractFactory("StreamrConfigV1_1", deployer)
    return await(await upgrades.deployProxy(streamrConfigFactory, [], { kind: "uups" })).deployed() as StreamrConfigV1_1
}

/**
 * Deploy all contracts needed by tests. This should be called in "before/beforeAll".
 *     see @openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol
 * @param signer wallet used for all deployments
 * @returns mapping: name string -> ethers.Contract object
 */
export async function deployTestContracts(signer: Wallet): Promise<TestContracts> {
    const token = await (await getContractFactory("TestToken", { signer })).deploy("TestToken", "TEST")
    await (await token.mint(signer.address, "1000000000000000000000000")).wait() // 1M tokens

    const streamrConfig = await deployStreamrConfig(signer)

    // sponsorship and policies
    const maxOperatorsJoinPolicy = await (await getContractFactory("MaxOperatorsJoinPolicy", { signer })).deploy()
    const operatorContractOnlyJoinPolicy = await (await getContractFactory("OperatorContractOnlyJoinPolicy", { signer })).deploy()
    const allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", { signer })).deploy()
    const leavePolicy = await (await getContractFactory("DefaultLeavePolicy", { signer })).deploy()
    const adminKickPolicy = await (await getContractFactory("AdminKickPolicy", { signer })).deploy()
    const voteKickPolicy = await (await getContractFactory("VoteKickPolicy", { signer })).deploy()
    const sponsorshipTemplate = await (await getContractFactory("Sponsorship", { signer })).deploy()
    await sponsorshipTemplate.deployed()

    upgrades.silenceWarnings()
    const contractFactory = await getContractFactory("SponsorshipFactory", signer)
    const sponsorshipFactory = await(await upgrades.deployProxy(contractFactory, [
        sponsorshipTemplate.address,
        token.address,
        streamrConfig.address
    ], { kind: "uups", unsafeAllow: ["delegatecall"] })).deployed() as SponsorshipFactory
    await (await sponsorshipFactory.addTrustedPolicies([
        allocationPolicy.address,
        leavePolicy.address,
        adminKickPolicy.address,
        voteKickPolicy.address,
        maxOperatorsJoinPolicy.address,
        operatorContractOnlyJoinPolicy.address,
    ])).wait()

    const minimalForwarderFactory = await hardhatEthers.getContractFactory("MinimalForwarder", signer)
    const minimalForwarder = await minimalForwarderFactory.deploy() as MinimalForwarder

    await (await streamrConfig.setOperatorContractOnlyJoinPolicy(operatorContractOnlyJoinPolicy.address)).wait()
    await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
    await (await streamrConfig.setTrustedForwarder(minimalForwarder.address)).wait()

    // operator contract and policies
    const defaultDelegationPolicy = await (await getContractFactory("DefaultDelegationPolicy", { signer })).deploy()
    const defaultExchangeRatePolicy = await (await getContractFactory("DefaultExchangeRatePolicy", { signer })).deploy()
    const defaultUndelegationPolicy = await (await getContractFactory("DefaultUndelegationPolicy", { signer })).deploy()

    const nodeModule = await (await getContractFactory("NodeModule", { signer })).deploy() as NodeModule
    const queueModule = await (await getContractFactory("QueueModule", { signer })).deploy() as QueueModule
    const stakeModule = await (await getContractFactory("StakeModule", { signer })).deploy() as StakeModule

    const { operatorFactory, operatorTemplate } = await deployOperatorFactory({
        token, streamrConfig,
        defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy,
        nodeModule, queueModule, stakeModule
    }, signer)

    const streamRegistryFactory = await getContractFactory("StreamRegistryV4", { signer })
    const streamRegistry = await upgrades.deployProxy(streamRegistryFactory,
        [hardhatEthers.constants.AddressZero, hardhatEthers.Wallet.createRandom().address], { kind: "uups" }) as StreamRegistryV4

    await (await streamrConfig!.setStreamRegistryAddress(streamRegistry.address)).wait()

    return {
        token, streamrConfig, streamRegistry,
        sponsorshipTemplate, sponsorshipFactory, maxOperatorsJoinPolicy, operatorContractOnlyJoinPolicy, allocationPolicy,
        leavePolicy, adminKickPolicy, voteKickPolicy, operatorTemplate, operatorFactory,
        defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy, nodeModule, queueModule, stakeModule, minimalForwarder,
        deployer: signer
    }
}
