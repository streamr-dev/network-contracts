/* eslint-disable require-atomic-updates */
import { upgrades, ethers as hardhatEthers } from "hardhat"
import { config } from "@streamr/config"
import { abi as ERC20ABI } from "../artifacts/@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol/IERC20Metadata.json"
import { StreamRegistry, operatorFactoryABI, sponsorshipFactoryABI, streamRegistryABI, streamrConfigABI } from "../src/exports"

import type { Overrides, Wallet } from "ethers"
import type {
    IERC20Metadata, IERC677, StreamrConfig,
    SponsorshipFactory, StakeWeightedAllocationPolicy, VoteKickPolicy,
    MaxOperatorsJoinPolicy, OperatorContractOnlyJoinPolicy, DefaultLeavePolicy,
    Operator, OperatorFactory,
    NodeModule, StakeModule, QueueModule,
    DefaultDelegationPolicy, DefaultExchangeRatePolicy, DefaultUndelegationPolicy,
} from "../typechain"

const { log } = console

const {
    provider, // specified in hardhat.config.ts
    getSigners, // specified in hardhat.config.ts, read from environment variable KEY
    Contract,
    getContractFactory,
    utils: { formatEther, formatUnits, parseUnits, getAddress },
} = hardhatEthers

export type StreamrTokenomicsContracts = {
    "DATA": IERC677,
    "streamRegistry": StreamRegistry,
    "streamrConfig": StreamrConfig,

    "sponsorshipDefaultLeavePolicy": DefaultLeavePolicy,
    "sponsorshipMaxOperatorsJoinPolicy": MaxOperatorsJoinPolicy,
    "sponsorshipOperatorContractOnlyJoinPolicy": OperatorContractOnlyJoinPolicy,
    "sponsorshipStakeWeightedAllocationPolicy": StakeWeightedAllocationPolicy,
    "sponsorshipVoteKickPolicy": VoteKickPolicy,
    "sponsorshipFactory": SponsorshipFactory,

    "operatorDefaultDelegationPolicy": DefaultDelegationPolicy,
    "operatorDefaultUndelegationPolicy": DefaultUndelegationPolicy,
    "operatorDefaultExchangeRatePolicy": DefaultExchangeRatePolicy,
    "operatorFactory": OperatorFactory,
}

const {
    CHAIN,
    GAS_PRICE_GWEI,

    IGNORE_BALANCE,
    IGNORE_TOKEN_SYMBOL, // set to bypass token check for testing
} = process.env
if (!CHAIN) {
    throw new Error("Must set CHAIN environment variable, e.g. CHAIN=dev2")
}

const ethersOptions: Overrides = {}
if (GAS_PRICE_GWEI) {
    ethersOptions.gasPrice = parseUnits(GAS_PRICE_GWEI, "gwei")
}

const {
    contracts: {
        DATA: DATA_TOKEN_ADDRESS,
        StreamrConfig: STREAMR_CONFIG_ADDRESS,
        OperatorFactory: OPERATOR_FACTORY_ADDRESS,
        SponsorshipFactory: SPONSORSHIP_FACTORY_ADDRESS,
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
    }
} = (config as any)[CHAIN]
if (!DATA_TOKEN_ADDRESS) {
    throw new Error(`DATA must be set in the config! Not found in chain "${CHAIN}". Check CHAIN environment variable.`)
}

async function main() {
    const [ deployer ] = await getSigners() as Wallet[] // specified in hardhat.config.ts
    console.log("Connected to network %o", await provider.getNetwork())

    const gasRequired = 60000000 // measured in hardhat test network
    const gasPrice = await provider.getGasPrice()
    const estimatedGasCost = gasPrice.mul(gasRequired)
    log("Estimated gas cost: %s ETH (gas price %s gwei)", formatEther(estimatedGasCost), formatUnits(gasPrice, "gwei"))

    const balanceBefore = await provider.getBalance(deployer.address)
    log("Balance of %s: %s ETH", deployer.address, formatEther(balanceBefore))
    if (balanceBefore.lt(estimatedGasCost)) {
        if (!IGNORE_BALANCE) {
            throw new Error(
                `Insufficient native tokens for deployment in ${deployer.address} (${formatEther(balanceBefore)} < ${formatEther(estimatedGasCost)})`
            )
        }
    }

    const contracts: Partial<StreamrTokenomicsContracts> = {}
    await deployTokenomicsContracts(deployer, contracts).catch((e) => {
        log("Error deploying tokenomics contracts: %o", e)
    })

    const balanceAfter = await provider.getBalance(deployer.address)
    const gasSpent = balanceBefore.sub(balanceAfter)
    log("Spent %s ETH for gas", formatEther(gasSpent))

    const addresses = {
        "StreamrConfig": contracts.streamrConfig?.address,
        "SponsorshipOperatorContractOnlyJoinPolicy": contracts.sponsorshipOperatorContractOnlyJoinPolicy?.address,
        "SponsorshipMaxOperatorsJoinPolicy": contracts.sponsorshipMaxOperatorsJoinPolicy?.address,
        "SponsorshipStakeWeightedAllocationPolicy": contracts.sponsorshipStakeWeightedAllocationPolicy?.address,
        "SponsorshipDefaultLeavePolicy": contracts.sponsorshipDefaultLeavePolicy?.address,
        "SponsorshipVoteKickPolicy": contracts.sponsorshipVoteKickPolicy?.address,
        "SponsorshipFactory": contracts.sponsorshipFactory?.address,
        "OperatorDefaultDelegationPolicy": contracts.operatorDefaultDelegationPolicy?.address,
        "OperatorDefaultExchangeRatePolicy": contracts.operatorDefaultExchangeRatePolicy?.address,
        "OperatorDefaultUndelegationPolicy": contracts.operatorDefaultUndelegationPolicy?.address,
        "OperatorFactory": contracts.operatorFactory?.address,
    }
    log("Streamr tokenomics contract addresses:\n%s", JSON.stringify(addresses, null, 4))
}

export default async function deployTokenomicsContracts(
    signer: Wallet,
    contracts: Partial<StreamrTokenomicsContracts> = {}
): Promise<StreamrTokenomicsContracts> {
    const { provider } = signer

    if (DATA_TOKEN_ADDRESS && await provider.getCode(DATA_TOKEN_ADDRESS) !== "0x") {
        const token = new Contract(DATA_TOKEN_ADDRESS, ERC20ABI, provider) as IERC20Metadata
        const tokenSymbol = await token.symbol()
            .catch(() => { throw "[call failed]" })
            .then((sym) => { if (!IGNORE_TOKEN_SYMBOL && sym !== "DATA") { throw sym } return sym })
            .catch((badSymbol: string) => { throw new Error(
                `Doesn't seem to be Streamr DATAv2 token: symbol="${badSymbol}" DATA=${DATA_TOKEN_ADDRESS}.
                If this is ok, bypass this check with IGNORE_TOKEN_SYMBOL=1.`
            ) })
        log("Found %s token at %s", tokenSymbol, DATA_TOKEN_ADDRESS)
    }

    if (STREAM_REGISTRY_ADDRESS && await provider.getCode(STREAM_REGISTRY_ADDRESS) !== "0x") {
        const registry = new Contract(STREAM_REGISTRY_ADDRESS, streamRegistryABI, provider) as StreamRegistry
        await registry.TRUSTED_ROLE().catch(() => { throw new Error(`Doesn't seem to be StreamRegistry: StreamRegistry=${STREAM_REGISTRY_ADDRESS}`) })
        log("Found StreamRegistry at %s", STREAM_REGISTRY_ADDRESS)
    } else {
        throw new Error(`StreamRegistry must be set in the config! Not found in chain "${CHAIN}".
            Check CHAIN environment variable, or deploy StreamRegistry first.`)
    }

    if (STREAMR_CONFIG_ADDRESS && await provider.getCode(STREAMR_CONFIG_ADDRESS) !== "0x") {
        contracts.streamrConfig = new Contract(STREAMR_CONFIG_ADDRESS, streamrConfigABI, signer) as StreamrConfig
        await contracts.streamrConfig.streamRegistryAddress()
            .catch(() => { throw "[call failed]" })
            .then((regAddr) => { if (getAddress(regAddr) !== getAddress(STREAM_REGISTRY_ADDRESS)) { throw regAddr } return 0 })
            .catch((badRegistry: string) => { throw new Error(
                `StreamrConfig.streamRegistryAddress="${badRegistry}" doesn't match StreamRegistryAddress="${STREAM_REGISTRY_ADDRESS}"`
            )})
        log("Found StreamrConfig at %s", contracts.streamrConfig.address)
    } else {
        const streamrConfigCF = await getContractFactory("StreamrConfig", { signer })
        // contracts.streamrConfig = await streamrConfigCF.deploy() as StreamrConfig
        contracts.streamrConfig = await upgrades.deployProxy(streamrConfigCF, [], {
            kind: "uups", unsafeAllow: ["delegatecall"], timeout: 600000,
        }) as StreamrConfig
        await contracts.streamrConfig.deployed()
        log("Deployed StreamrConfig to %s", contracts.streamrConfig.address)

        await (await contracts.streamrConfig.setStreamRegistryAddress(STREAM_REGISTRY_ADDRESS)).wait()
        log("Done setting StreamrConfig.streamRegistryAddress")
    }

    if (OPERATOR_FACTORY_ADDRESS && await provider.getCode(OPERATOR_FACTORY_ADDRESS) !== "0x") {
        contracts.operatorFactory = new Contract(OPERATOR_FACTORY_ADDRESS, operatorFactoryABI, signer) as OperatorFactory
        await contracts.operatorFactory.stakeModuleTemplate().catch(() => {
            throw new Error(`Doesn't seem to be an OperatorFactory: ${OPERATOR_FACTORY_ADDRESS}`)
        })
        log("Found OperatorFactory at %s", contracts.operatorFactory.address)
    } else {
        contracts.operatorDefaultDelegationPolicy = await (await getContractFactory("DefaultDelegationPolicy", { signer })).deploy()
        contracts.operatorDefaultExchangeRatePolicy = await (await getContractFactory("DefaultExchangeRatePolicy", { signer })).deploy()
        contracts.operatorDefaultUndelegationPolicy = await (await getContractFactory("DefaultUndelegationPolicy", { signer })).deploy()

        const nodeModule = await (await getContractFactory("NodeModule", { signer })).deploy() as NodeModule
        const queueModule = await (await getContractFactory("QueueModule", { signer })).deploy() as QueueModule
        const stakeModule = await (await getContractFactory("StakeModule", { signer })).deploy() as StakeModule

        const operatorTemplate = await (await getContractFactory("Operator", { signer })).deploy() as Operator
        const operatorFactoryCF = await getContractFactory("OperatorFactory", signer)
        contracts.operatorFactory = await(await upgrades.deployProxy(operatorFactoryCF, [
            operatorTemplate.address,
            DATA_TOKEN_ADDRESS,
            contracts.streamrConfig.address,
            nodeModule.address,
            queueModule.address,
            stakeModule.address,
        ], { kind: "uups", unsafeAllow: ["delegatecall"] })).deployed() as OperatorFactory
        log("Deployed OperatorFactory to %s", contracts.operatorFactory.address)

        await (await contracts.operatorFactory.addTrustedPolicies([
            contracts.operatorDefaultDelegationPolicy!.address,
            contracts.operatorDefaultExchangeRatePolicy!.address,
            contracts.operatorDefaultUndelegationPolicy!.address,
        ])).wait()
        log("Done adding trusted policies")

        await (await contracts.streamrConfig.setOperatorFactory(contracts.operatorFactory.address)).wait()
        log("Done setting StreamrConfig.operatorFactory")
    }

    if (SPONSORSHIP_FACTORY_ADDRESS && await provider.getCode(SPONSORSHIP_FACTORY_ADDRESS) !== "0x") {
        contracts.sponsorshipFactory = new Contract(SPONSORSHIP_FACTORY_ADDRESS, sponsorshipFactoryABI, signer) as SponsorshipFactory
        await contracts.sponsorshipFactory.sponsorshipContractTemplate().catch(() => {
            throw new Error(`Doesn't seem to be a SponsorshipFactory: ${SPONSORSHIP_FACTORY_ADDRESS}`)
        })
        log("Found SponsorshipFactory at %s", contracts.sponsorshipFactory.address)
    } else {
        contracts.sponsorshipMaxOperatorsJoinPolicy = await (await getContractFactory("MaxOperatorsJoinPolicy", { signer })).deploy()
        contracts.sponsorshipOperatorContractOnlyJoinPolicy = await (await getContractFactory("OperatorContractOnlyJoinPolicy", { signer })).deploy()
        contracts.sponsorshipStakeWeightedAllocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", { signer })).deploy()
        contracts.sponsorshipDefaultLeavePolicy = await (await getContractFactory("DefaultLeavePolicy", { signer })).deploy()
        contracts.sponsorshipVoteKickPolicy = await (await getContractFactory("VoteKickPolicy", { signer })).deploy()
        const sponsorshipTemplate = await (await getContractFactory("Sponsorship", { signer })).deploy()
        await sponsorshipTemplate.deployed()

        const sponsorshipFactoryCF = await getContractFactory("SponsorshipFactory", signer)
        contracts.sponsorshipFactory = await(await upgrades.deployProxy(sponsorshipFactoryCF, [
            sponsorshipTemplate.address,
            DATA_TOKEN_ADDRESS,
            contracts.streamrConfig.address
        ], { kind: "uups", unsafeAllow: ["delegatecall"] })).deployed() as SponsorshipFactory
        log("Deployed SponsorshipFactory to %s", contracts.sponsorshipFactory.address)

        await (await contracts.sponsorshipFactory.addTrustedPolicies([
            contracts.sponsorshipStakeWeightedAllocationPolicy!.address,
            contracts.sponsorshipDefaultLeavePolicy!.address,
            contracts.sponsorshipVoteKickPolicy!.address,
            contracts.sponsorshipMaxOperatorsJoinPolicy!.address,
            contracts.sponsorshipOperatorContractOnlyJoinPolicy!.address,
        ])).wait()
        log("Done adding trusted policies")

        await (await contracts.streamrConfig.setOperatorContractOnlyJoinPolicy(contracts.sponsorshipOperatorContractOnlyJoinPolicy!.address)).wait()
        await (await contracts.streamrConfig.setSponsorshipFactory(contracts.sponsorshipFactory.address)).wait()
        log("Done setting StreamrConfig.sponsorshipFactory")
    }

    return contracts as StreamrTokenomicsContracts
}

if (require.main === module) {
    main().catch(console.error)
}
