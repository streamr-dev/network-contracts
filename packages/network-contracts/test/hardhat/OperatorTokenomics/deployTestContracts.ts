import { ethers as hardhatEthers, upgrades } from "hardhat"
import { Wallet, utils} from "ethers"

import type { Sponsorship, SponsorshipFactory, Operator, OperatorFactory, IAllocationPolicy, TestToken,
    IJoinPolicy, IKickPolicy, ILeavePolicy, IDelegationPolicy, IPoolYieldPolicy, IUndelegationPolicy, StreamrConfig } from "../../../typechain"

const { getContractFactory } = hardhatEthers

export type TestContracts = {
    token: TestToken;
    streamrConfig: StreamrConfig;
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
    defaultPoolYieldPolicy: IPoolYieldPolicy;
    defaultUndelegationPolicy: IUndelegationPolicy;
    deployer: Wallet;
    streamRegistry: StreamRegistryV4;
}

export async function deployOperatorFactory(contracts: Partial<TestContracts>, signer: Wallet): Promise<{
    operatorFactory: OperatorFactory,
    operatorTemplate: Operator
}> {
    const {
        token, streamrConfig,
        defaultDelegationPolicy, defaultPoolYieldPolicy, defaultUndelegationPolicy,
    } = contracts
    const operatorTemplate = await (await getContractFactory("Operator", { signer })).deploy()
    const operatorFactory = await (await getContractFactory("OperatorFactory", { signer })).deploy()
    await operatorFactory.deployed()
    await (await operatorFactory.initialize(
        operatorTemplate!.address,
        token!.address,
        streamrConfig!.address,
        { gasLimit: 500000 } // solcover makes the gas estimation require 1000+ ETH for transaction, this fixes it
    )).wait()
    await (await operatorFactory.addTrustedPolicies([
        defaultDelegationPolicy!.address,
        defaultPoolYieldPolicy!.address,
        defaultUndelegationPolicy!.address
    ], { gasLimit: 500000 })).wait()
    await (await streamrConfig!.setOperatorFactory(operatorFactory.address)).wait()
    return { operatorFactory, operatorTemplate }
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

    // sponsorship and policies
    const maxOperatorsJoinPolicy = await (await getContractFactory("MaxOperatorsJoinPolicy", { signer })).deploy()
    const operatorContractOnlyJoinPolicy = await (await getContractFactory("OperatorContractOnlyJoinPolicy", { signer })).deploy()
    const allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", { signer })).deploy()
    const leavePolicy = await (await getContractFactory("DefaultLeavePolicy", { signer })).deploy()
    const adminKickPolicy = await (await getContractFactory("AdminKickPolicy", { signer })).deploy()
    const voteKickPolicy = await (await getContractFactory("VoteKickPolicy", { signer })).deploy()
    const sponsorshipTemplate = await (await getContractFactory("Sponsorship", { signer })).deploy()
    await sponsorshipTemplate.deployed()

    const sponsorshipFactory = await (await getContractFactory("SponsorshipFactory", { signer })).deploy()
    await sponsorshipFactory.deployed()
    await (await sponsorshipFactory.initialize(
        sponsorshipTemplate.address,
        token.address,
        streamrConfig.address
    )).wait()
    await sponsorshipFactory.deployed()
    await (await sponsorshipFactory.addTrustedPolicies([
        allocationPolicy.address,
        leavePolicy.address,
        adminKickPolicy.address,
        voteKickPolicy.address,
        maxOperatorsJoinPolicy.address,
        operatorContractOnlyJoinPolicy.address,
    ])).wait()

    await (await streamrConfig!.setOperatorContractOnlyJoinPolicy(operatorContractOnlyJoinPolicy.address)).wait()
    await (await streamrConfig!.setSponsorshipFactory(sponsorshipFactory.address)).wait()

    // operator contract and policies
    const defaultDelegationPolicy = await (await getContractFactory("DefaultDelegationPolicy", { signer })).deploy()
    const defaultPoolYieldPolicy = await (await getContractFactory("DefaultPoolYieldPolicy", { signer })).deploy()
    const defaultUndelegationPolicy = await (await getContractFactory("DefaultUndelegationPolicy", { signer })).deploy()

    const { operatorFactory, operatorTemplate } = await deployOperatorFactory({
        token, streamrConfig,
        defaultDelegationPolicy, defaultPoolYieldPolicy, defaultUndelegationPolicy,
    }, signer)

    const streamRegistryFactory = await getContractFactory("StreamRegistryV4", { signer })
    const streamRegistry = await upgrades.deployProxy(streamRegistryFactory,
        [hardhatEthers.constants.AddressZero, Wallet.createRandom().address], { kind: "uups" }) as StreamRegistryV4

    await (await streamrConfig!.setStreamRegistryAddress(streamRegistry.address)).wait()

    return {
        token, streamrConfig, streamRegistry,
        sponsorshipTemplate, sponsorshipFactory, maxOperatorsJoinPolicy, operatorContractOnlyJoinPolicy, allocationPolicy,
        leavePolicy, adminKickPolicy, voteKickPolicy, operatorTemplate, operatorFactory,
        defaultDelegationPolicy, defaultPoolYieldPolicy, defaultUndelegationPolicy,
        deployer: signer
    }
}