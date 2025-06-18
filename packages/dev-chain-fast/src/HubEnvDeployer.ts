import {
    MarketplaceV4, marketplaceV4ABI, marketplaceV4Bytecode,
    ProjectRegistryV1, projectRegistryV1ABI, projectRegistryV1Bytecode,
    ProjectStakingV1, projectStakingV1ABI, projectStakingV1Bytecode,
    RemoteMarketplaceV1, remoteMarketplaceV1ABI, remoteMarketplaceV1Bytecode,
    Uniswap2AdapterV4, uniswap2AdapterV4ABI, uniswap2AdapterV4Bytecode,
} from "@streamr/network-contracts"
import debug from "debug"
import { ContractFactory, providers, Wallet } from "ethers"

const log = debug.log

export type HubEnvContractAddresses = {
    "MarketplaceV4": string,
    "ProjectRegistryV1": string,
    "RemoteMarketplaceV1": string,
    "Uniswap2AdapterV4": string,
    "ProjectStakingV1": string,
}

export type HubEnvContracts = {
    "marketplaceV4": MarketplaceV4,
    "projectRegistryV1": ProjectRegistryV1,
    "remoteMarketplaceV1": RemoteMarketplaceV1,
    "uniswap2AdapterV4": Uniswap2AdapterV4,
    "projectStakingV1": ProjectStakingV1,
}

export class HubEnvDeployer {
    readonly streamRegistryAddress: string
    readonly destinationDomainId: number
    readonly addresses: HubEnvContractAddresses
    readonly contracts: HubEnvContracts
    readonly provider: providers.JsonRpcProvider
    readonly adminWallet: Wallet

    constructor(
        key: string,
        chainEndpointUrl: string,
        streamRegistryAddress: string,
        destinationDomainId: number,
    ) {
        this.streamRegistryAddress = streamRegistryAddress
        this.destinationDomainId = destinationDomainId
        this.addresses = {} as HubEnvContractAddresses
        this.contracts = {} as HubEnvContracts
        this.provider = new providers.JsonRpcProvider(chainEndpointUrl)
        this.adminWallet = new Wallet(key, this.provider)
    }

    async deployCoreContracts(tokenAddress: string): Promise<void> {
        await this.deployProjectRegistryV1(this.streamRegistryAddress)
        await this.deployMarketplaceV4(this.addresses.ProjectRegistryV1, this.destinationDomainId)
        await this.deployProjectStaking(this.addresses.ProjectRegistryV1, tokenAddress)
    }

    async deployProjectRegistryV1(streamRegistryAddress: string): Promise<ProjectRegistryV1> {
        log("Deploying ProjectRegistryV1")
        const projectRegistryV1Factory = new ContractFactory(projectRegistryV1ABI, projectRegistryV1Bytecode, this.adminWallet)
        const projectRegistryV1 = await projectRegistryV1Factory.deploy() as ProjectRegistryV1
        await projectRegistryV1.deployed()
        await (await projectRegistryV1.initialize(streamRegistryAddress)).wait()
        log("Deployed ProjectRegistryV1 contract " + projectRegistryV1.address)
        this.contracts.projectRegistryV1 = projectRegistryV1
        this.addresses.ProjectRegistryV1 = projectRegistryV1.address
        return projectRegistryV1
    }

    async deployMarketplaceV4(projectRegistryAddress: string, destinationDomainId: number): Promise<MarketplaceV4> {
        log("Deploying MarketplaceV4")
        const marketplaceV4Factory = new ContractFactory(marketplaceV4ABI, marketplaceV4Bytecode, this.adminWallet)
        const marketplaceV4 = await marketplaceV4Factory.deploy() as MarketplaceV4
        await marketplaceV4.deployed()
        await (await marketplaceV4.initialize(projectRegistryAddress, destinationDomainId)).wait()
        this.contracts.marketplaceV4 = marketplaceV4
        this.addresses.MarketplaceV4 = marketplaceV4.address
        log("Deployed MarketplaceV4 contract " + marketplaceV4.address)
        return marketplaceV4
    }

    async deployUniswap2AdapterV4(uniswapV2RouterAddress: string): Promise<Uniswap2AdapterV4> {
        log("Deploying Uniswap2AdapterV4")
        const uniswap2AdapterV4Factory = new ContractFactory(uniswap2AdapterV4ABI, uniswap2AdapterV4Bytecode, this.adminWallet)
        const uniswap2AdapterV4 = await uniswap2AdapterV4Factory.deploy(
            this.addresses.MarketplaceV4,
            this.addresses.ProjectRegistryV1,
            uniswapV2RouterAddress,
            this.destinationDomainId
        ) as Uniswap2AdapterV4
        await uniswap2AdapterV4.deployed()
        log("Deployed Uniswap2AdapterV4 contract " + uniswap2AdapterV4.address)
        this.contracts.uniswap2AdapterV4 = uniswap2AdapterV4
        this.addresses.Uniswap2AdapterV4 = uniswap2AdapterV4.address
        return uniswap2AdapterV4
    }

    async deployRemoteMarketplaceV1(
        originDomainId: number,
        interchainQueryRouterAddress: string,
        mailboxAddress: string,
        interchainGasPaymasterAddress: string
    ): Promise<RemoteMarketplaceV1> {
        log("Deploying remoteMarketplaceV1")
        const remoteMarketplaceV1Factory = new ContractFactory(remoteMarketplaceV1ABI, remoteMarketplaceV1Bytecode, this.adminWallet)
        const remoteMarketplaceV1 = await remoteMarketplaceV1Factory.deploy() as RemoteMarketplaceV1
        await remoteMarketplaceV1.deployed()
        await (await remoteMarketplaceV1.initialize(
            originDomainId,
            interchainQueryRouterAddress,
            mailboxAddress,
            interchainGasPaymasterAddress
        )).wait()
        log("Deployed RemoteMarketplaceV1 contract " + remoteMarketplaceV1.address)
        this.contracts.remoteMarketplaceV1 = remoteMarketplaceV1
        this.addresses.RemoteMarketplaceV1 = remoteMarketplaceV1.address
        await (await remoteMarketplaceV1.addRecipient(this.destinationDomainId, this.addresses.MarketplaceV4)).wait()
        log("Added MarketplaceV4 as recipient for RemoteMarketplaceV1")
        return remoteMarketplaceV1
    }

    async deployProjectStaking(
        projectRegistryAddress: string,
        tokenAddress: string,
    ): Promise<ProjectStakingV1> {
        const projectStakingV1Factory = new ContractFactory(projectStakingV1ABI, projectStakingV1Bytecode, this.adminWallet)
        const projectStakingV1 = await projectStakingV1Factory.deploy() as ProjectStakingV1
        await projectStakingV1.deployed()
        await (await projectStakingV1.initialize(projectRegistryAddress, tokenAddress)).wait()
        this.contracts.projectStakingV1 = projectStakingV1
        this.addresses.ProjectStakingV1 = projectStakingV1.address
        return projectStakingV1
    }
}
