
// TODO: avoid hardhat direct dependency. Take deployFunc as argument maybe.
// This whole file should ideally be mostly DRYed up with StreamrEnvDeployer.
import { ethers as hardhatEthers, upgrades } from "hardhat"
import Debug from "debug"
import type { Wallet } from "@ethersproject/wallet"

import type {
    TestToken,
    Sponsorship, SponsorshipFactory, Operator, OperatorFactory,
    StreamRegistryV4, IKickPolicy,
    StreamrConfig, NodeModule, QueueModule, StakeModule, MinimalForwarder
} from "../../../typechain"

import type { StreamrContracts } from "../../../src/StreamrEnvDeployer"
import { Contract } from "ethers"

const { getContractFactory } = hardhatEthers
const log = Debug("Streamr:deployTestContracts")

// export type TestContracts = {
//     token: TestToken;
//     streamrConfig: StreamrConfig;
//     maxOperatorsJoinPolicy: IJoinPolicy;
//     operatorContractOnlyJoinPolicy: IJoinPolicy
//     allocationPolicy: IAllocationPolicy;
//     leavePolicy: ILeavePolicy;
//     adminKickPolicy: IKickPolicy;
//     voteKickPolicy: IKickPolicy;
//     sponsorshipFactory: SponsorshipFactory;
//     sponsorshipTemplate: Sponsorship;
//     operatorFactory: OperatorFactory;
//     operatorTemplate: Operator;
//     defaultDelegationPolicy: IDelegationPolicy;
//     defaultExchangeRatePolicy: IExchangeRatePolicy;
//     defaultUndelegationPolicy: IUndelegationPolicy;
//     nodeModule: NodeModule;
//     queueModule: QueueModule;
//     stakeModule: StakeModule;
//     minimalForwarder: MinimalForwarder;
//     deployer: Wallet;
//     streamRegistry: StreamRegistryV4;
// }

export type TestContracts = StreamrContracts & {
    token: TestToken;
    sponsorshipTemplate: Sponsorship;
    operatorTemplate: Operator;
    adminKickPolicy: IKickPolicy;
    nodeModule: NodeModule;
    queueModule: QueueModule;
    stakeModule: StakeModule;
    minimalForwarder: MinimalForwarder;
    deployer: Wallet;
}

export async function deployOperatorFactory(contracts: Partial<TestContracts>, signer: Wallet): Promise<{
    operatorFactory: OperatorFactory,
    operatorTemplate: Operator
}> {
    const {
        token, streamrConfig,
        defaultDelegationPolicy,
        defaultExchangeRatePolicy,
        defaultUndelegationPolicy,
        nodeModule, queueModule, stakeModule
    } = contracts
    const operatorTemplate = await (await getContractFactory("Operator", { signer })).deploy() as Operator
    const contractFactory = await getContractFactory("OperatorFactory", signer)
    const operatorFactory = await(await upgrades.deployProxy(contractFactory, [
        operatorTemplate.address,
        token!.address,
        streamrConfig!.address,
        nodeModule!.address,
        queueModule!.address,
        stakeModule!.address,
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

export async function deployStreamrConfig(deployer: Wallet): Promise<StreamrConfig> {
    const streamrConfigFactory = await getContractFactory("StreamrConfig", deployer)
    return await(await upgrades.deployProxy(streamrConfigFactory, [], { kind: "uups" })).deployed() as StreamrConfig
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
    const stakeWeightedAllocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", { signer })).deploy()
    const defaultLeavePolicy = await (await getContractFactory("DefaultLeavePolicy", { signer })).deploy()
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
        stakeWeightedAllocationPolicy.address,
        defaultLeavePolicy.address,
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

    const contracts: TestContracts = {
        token, DATA: token, streamrConfig, streamRegistry,
        sponsorshipTemplate, sponsorshipFactory,
        maxOperatorsJoinPolicy, operatorContractOnlyJoinPolicy, stakeWeightedAllocationPolicy,
        defaultLeavePolicy, voteKickPolicy, adminKickPolicy,
        operatorTemplate, operatorFactory,
        defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy,
        nodeModule, queueModule, stakeModule, minimalForwarder,
        deployer: signer,

        // TODO: these here now just to make ts happy. Tokenomics tests don't use them.
        // TODO: Probably should include in a full-setup script, like streamrEnvDeployer?
        // TODO: maybe split StreamsContracts into TokenomicsContracts etc.
        ENS: token,
        FIFSRegistrar: token,
        publicResolver: token,
        trackerRegistry: token,
        storageNodeRegistry: token,
        ensCacheV2: token,
        streamStorageRegistry: token,
    }
    log(JSON.stringify(Object.fromEntries(Object.entries(contracts).map(([name, contract]) => [ name, contract.address ])), null, 2))
    return contracts
}
