import { Contract, ContractFactory, Wallet, ethers, providers } from "ethers"

import debug from "debug"
import { DefaultDelegationPolicy, DefaultLeavePolicy, DefaultPoolYieldPolicy, DefaultUndelegationPolicy,
    ENSCacheV2, ENSCacheV2ABI, ENSCacheV2Bytecode, MaxOperatorsJoinPolicy, NodeRegistry, Operator, OperatorContractOnlyJoinPolicy,
    OperatorFactory, Sponsorship, SponsorshipFactory, StakeWeightedAllocationPolicy, StreamRegistry,
    StreamStorageRegistry, StreamrConfig, TestToken, VoteKickPolicy, defaultDelegationPolicyABI,
    defaultDelegationPolicyBytecode, defaultLeavePolicyABI,
    defaultLeavePolicyBytecode, defaultPoolYieldPolicyABI, defaultPoolYieldPolicyBytecode,
    defaultUndelegationPolicyABI, defaultUndelegationPolicyBytecode, ensRegistryABI, ensRegistryBytecode,
    fifsRegistrarABI, fifsRegistrarBytecode, maxOperatorsJoinPolicyABI,
    maxOperatorsJoinPolicyBytecode, nodeRegistryABI, nodeRegistryBytecode, operatorABI, operatorBytecode, operatorFactoryABI,
    operatorFactoryBytecode, publicResolverABI, publicResolverBytecode, sponsorshipABI, sponsorshipBytecode, sponsorshipFactoryABI,
    sponsorshipFactoryBytecode, stakeWeightedAllocationPolicyABI, stakeWeightedAllocationPolicyBytecode,
    streamRegistryABI, streamRegistryBytecode, streamStorageRegistryABI, streamStorageRegistryBytecode, streamrConfigABI, streamrConfigBytecode,
    tokenABI, tokenBytecode, voteKickPolicyABI, voteKickPolicyBytecode } from "./exports"

export type StreamrContractAddresses = {
    // DATA token
    "DATA": string,
    // ENS
    "ENS": string,
    "FIFSRegistrar": string,
    "PublicResolver": string,
    // Network
    "TrackerRegistry": string,
    "StorageNodeRegistry": string,
    "StreamRegistry": string,
    "ENSCacheV2": string,
    "StreamStorageRegistry": string,
    // Projects related   TODO: remove, these are deployed by hub-contracts
    // "MarketplaceV4": string,
    // "ProjectRegistryV1": string,
    // "ProjectStakingV1": string,
    // Incentive mechanism
    "StreamrConfig": string,
    "SponsorshipFactory": string,
    "SponsorshipDefaultLeavePolicy": string,
    "SponsorshipMaxOperatorsJoinPolicy": string,
    "SponsorshipOperatorContractOnlyJoinPolicy": string,
    "SponsorshipStakeWeightedAllocationPolicy": string,
    "SponsorshipVoteKickPolicy": string,

    "OperatorFactory": string,
    "OperatorDefaultDelegationPolicy": string,
    "OperatorDefaultUndelegationPolicy": string,
    "OperatorDefaultPoolYieldPolicy": string,

    // Data Unions: // TODO: remove, these are deployed elsewhere
    // "DataUnionFactory": string,
    // "DataUnionTemplate": string,
    // "DefaultFeeOracle": string,
}
export type EnvContracAddresses = StreamrContractAddresses // TODO: remove

export type StreamrContracts = {
    "DATA": TestToken,
    "ENS": Contract,
    "FIFSRegistrar": Contract,
    "publicResolver": Contract,
    "trackerRegistry": NodeRegistry,
    "storageNodeRegistry": NodeRegistry,
    "streamRegistry": StreamRegistry,
    "eNSCacheV2": ENSCacheV2,
    "streamStorageRegistry": StreamStorageRegistry,
    // "marketplaceV4": Contract,
    // "projectRegistryV1": Contract,
    // "projectStakingV1": Contract,
    "streamrConfig": StreamrConfig,
    "sponsorshipFactory": SponsorshipFactory,
    "sponsorshipDefaultLeavePolicy": DefaultLeavePolicy,
    "sponsorshipMaxOperatorsJoinPolicy": MaxOperatorsJoinPolicy,
    "sponsorshipOperatorContractOnlyJoinPolicy": OperatorContractOnlyJoinPolicy,
    "sponsorshipStakeWeightedAllocationPolicy": StakeWeightedAllocationPolicy,
    "sponsorshipVoteKickPolicy": VoteKickPolicy,
    "operatorFactory": OperatorFactory,
    "operatorDefaultDelegationPolicy": DefaultDelegationPolicy,
    "operatorDefaultUndelegationPolicy": DefaultUndelegationPolicy,
    "operatorDefaultPoolYieldPolicy": DefaultPoolYieldPolicy,
    // "dataUnionFactory": Contract,
    // "dataUnionTemplate": Contract,
    // "defaultFeeOracle": Contract
}
export type EnvContracts = StreamrContracts // TODO: remove

const log = debug.log

export class StreamrEnvDeployer {

    readonly adminWallet: Wallet
    readonly addresses: StreamrContractAddresses
    readonly contracts: StreamrContracts
    streamId: string
    sponsorshipAddress: any
    sponsorship?: Sponsorship
    operatorAddress: any
    operator?: Operator
    provider: providers.JsonRpcProvider

    constructor(key: string, chainEndpointUrl: string) {
        this.provider = new providers.JsonRpcProvider(chainEndpointUrl)
        this.adminWallet = new Wallet(key, this.provider)
        this.addresses = {} as StreamrContractAddresses
        this.contracts = {} as StreamrContracts
        this.streamId = ""
    }

    async deployEnvironment(): Promise<void> {
        await this.deployEns()
        await this.deployRegistries()
        await this.deploySponsorshipFactory()
        await this.deployOperatorFactory()
    }

    async createFundStakeSponsorshipAndOperator(): Promise<void> {
        await this.createStream()
        await this.deployNewSponsorship()
        await this.sponsorNewSponsorship()
        await this.stakeOnSponsorship()
        await this.deployOperatorContract()
        await this.investToPool()
        await this.stakeIntoSponsorship()
    }

    async deployEns(): Promise<void> {
        log("Deploying ENS")
        const ensDeploy = new ContractFactory(ensRegistryABI, ensRegistryBytecode, this.adminWallet)
        const ensDeployTx = await ensDeploy.deploy()
        this.contracts.ENS = await ensDeployTx.deployed()
        this.addresses.ENS = this.contracts.ENS.address
        log(`ENS registry deployed at ${this.contracts.ENS.address}`)

        const rootNode = "eth"
        const rootNodeNamehash = ethers.utils.namehash(rootNode)
        const rootNodeSha3 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(rootNode))
        const fifsDeploy = new ContractFactory(fifsRegistrarABI, fifsRegistrarBytecode, this.adminWallet)
        const fifsDeployTx = await fifsDeploy.deploy(this.contracts.ENS.address, rootNodeNamehash)
        this.contracts.FIFSRegistrar = await fifsDeployTx.deployed()
        this.addresses.FIFSRegistrar = this.contracts.FIFSRegistrar.address
        log(`FIFSRegistrar deployed at ${this.contracts.FIFSRegistrar.address}`)

        await(await this.contracts.ENS.setSubnodeOwner("0x0000000000000000000000000000000000000000000000000000000000000000",
            rootNodeSha3, this.contracts.FIFSRegistrar.address)).wait()
        const resDeploy = new ContractFactory(publicResolverABI, publicResolverBytecode, this.adminWallet)
        const resDeployTx = await resDeploy.deploy(this.contracts.ENS.address)
        this.contracts.publicResolver = await resDeployTx.deployed()
        this.addresses.PublicResolver = this.contracts.publicResolver.address
        log(`PublicResolver deployed at ${this.contracts.publicResolver.address}`)
    }

    async registerEnsName(domain: string, newOwner: Wallet): Promise<void> {
        newOwner = newOwner.connect(this.provider)
        await (await this.adminWallet.sendTransaction({to: newOwner.address, value: ethers.utils.parseEther("1")})).wait()

        const ensName = domain + ".eth"
        const hashedDomain = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(domain))
        const nameHashedENSName = ethers.utils.namehash(ensName)
        let tx = await this.contracts.FIFSRegistrar.register(hashedDomain, newOwner.address)
        await tx.wait()

        log("setting owner (" + newOwner.address + "), resolver and ttl for ens")
        tx = await this.contracts.ENS.connect(newOwner)
            .setRecord(nameHashedENSName, newOwner.address, this.addresses.PublicResolver, BigInt(100000000))
        await tx.wait()
    }

    async deployRegistries(): Promise<void> {
        log("Deploying Registries")

        // TODO do we still need a tracker registry?

        const initialNodes = []
        const initialMetadata = []
        initialNodes.push("0xde1112f631486CfC759A50196853011528bC5FA0")
        initialMetadata.push("{\"http\": \"http://10.200.10.1:8891\"}")
        const nodeRegistryFactory = new ContractFactory(nodeRegistryABI, nodeRegistryBytecode, this.adminWallet)
        const nodeRegistry = await nodeRegistryFactory.deploy() as NodeRegistry
        await nodeRegistry.deployed()
        await (await nodeRegistry.initialize(this.adminWallet.address, 
            false, initialNodes, initialMetadata)).wait()
        this.addresses.StorageNodeRegistry = nodeRegistry.address
        this.contracts.storageNodeRegistry = nodeRegistry
        log(`nodeRegistry address ${this.addresses.StorageNodeRegistry}`)

        const streamRegistryFactory = new ContractFactory(streamRegistryABI, streamRegistryBytecode, this.adminWallet)
        const streamRegistry = await streamRegistryFactory.deploy() as StreamRegistry
        await streamRegistry.deployed()
        await (await streamRegistry.initialize(
            Wallet.createRandom().address,
            Wallet.createRandom().address
        )).wait()
        this.addresses.StreamRegistry = streamRegistry.address
        this.contracts.streamRegistry = streamRegistry
        log(`streamRegistry address ${this.addresses.StreamRegistry}`)

        const scriptKeyAddress = "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1"
        const ensCacheV2Factory = new ContractFactory(ENSCacheV2ABI, ENSCacheV2Bytecode, this.adminWallet)
        const ensCacheV2 = await ensCacheV2Factory.deploy() as ENSCacheV2
        await ensCacheV2.deployed()
        await (await ensCacheV2.initialize(
            scriptKeyAddress,
            streamRegistry.address,
            Wallet.createRandom().address, // # ENSCacheV1, do we need this in dev env?
        )).wait()
        this.addresses.ENSCacheV2 = ensCacheV2.address
        this.contracts.eNSCacheV2 = ensCacheV2
        log(`ENSCacheV2 address ${this.addresses.ENSCacheV2}`)

        const role = await streamRegistry.TRUSTED_ROLE()
        log(`granting trusted role ${role} to self ${this.adminWallet.address}`)
        await (await streamRegistry.grantRole(role, this.adminWallet.address)).wait()

        log("setting ENSCache address in StreamRegistry")
        await (await streamRegistry.setEnsCache(ensCacheV2.address)).wait()

        log(`granting trusted role ${role} ensaddress ${ensCacheV2.address}`)
        await (await streamRegistry.grantRole(role, ensCacheV2.address)).wait()
        log("ensCacheScript address set as trusted role in streamregistry")

        const streamStorageRegistryFactory = new ContractFactory(streamStorageRegistryABI, streamStorageRegistryBytecode, this.adminWallet)
        const streamStorageRegistry = await streamStorageRegistryFactory.deploy() as StreamStorageRegistry
        await streamStorageRegistry.deployed()
        await (await streamStorageRegistry.initialize(
            streamRegistry.address,
            nodeRegistry.address,
            ethers.constants.AddressZero
        )).wait()
        this.addresses.StreamStorageRegistry = streamStorageRegistry.address
        this.contracts.streamStorageRegistry = streamStorageRegistry
        log(`streamStorageRegistry address ${this.addresses.StreamStorageRegistry}`)
    }

    async createStream(): Promise<void> {
        const streampath = "/test" + Date.now()
        log(`creating stream ${streampath}`)
        await ((await this.contracts.streamRegistry.createStream(streampath, "{}")).wait())
        this.streamId = this.adminWallet.address.toLowerCase() + streampath
        log(`streamId ${this.streamId}`)
    }

    async deploySponsorshipFactory(): Promise<void> {
        const streamrConfigFactory = new ContractFactory(streamrConfigABI, streamrConfigBytecode, this.adminWallet)
        const streamrConfig = await streamrConfigFactory.deploy() as StreamrConfig
        await streamrConfig.deployed()
        await (await streamrConfig.initialize()).wait()
        this.addresses.StreamrConfig = streamrConfig.address
        this.contracts.streamrConfig = streamrConfig
        log(`streamrConfig address ${streamrConfig.address}`)
        await (await streamrConfig.setStreamRegistryAddress(this.addresses.StreamRegistry)).wait()

        const tokenFactory = new ContractFactory(tokenABI, tokenBytecode, this.adminWallet)
        const token = await tokenFactory.deploy("Test token", "TEST") as TestToken
        await token.deployed()
        this.addresses.DATA = token.address
        this.contracts.DATA = token
        log(`token address ${token.address}`)

        const maxOperatorsJoinPolicy = await (new ContractFactory(maxOperatorsJoinPolicyABI, maxOperatorsJoinPolicyBytecode,
            this.adminWallet)).deploy() as MaxOperatorsJoinPolicy
        await maxOperatorsJoinPolicy.deployed()
        this.addresses.SponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy.address
        this.contracts.sponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy
        log(`maxOperatorsJoinPolicy address ${maxOperatorsJoinPolicy.address}`)

        const allocationPolicy = await (new ContractFactory(stakeWeightedAllocationPolicyABI, stakeWeightedAllocationPolicyBytecode,
            this.adminWallet)).deploy() as StakeWeightedAllocationPolicy
        await allocationPolicy.deployed()
        this.addresses.SponsorshipStakeWeightedAllocationPolicy = allocationPolicy.address
        this.contracts.sponsorshipStakeWeightedAllocationPolicy = allocationPolicy
        log(`allocationPolicy address ${allocationPolicy.address}`)

        const leavePolicy = await (new ContractFactory(defaultLeavePolicyABI, defaultLeavePolicyBytecode,
            this.adminWallet)).deploy() as DefaultLeavePolicy
        await leavePolicy.deployed()
        this.addresses.SponsorshipDefaultLeavePolicy = leavePolicy.address
        this.contracts.sponsorshipDefaultLeavePolicy = leavePolicy
        log(`leavePolicy address ${leavePolicy.address}`)

        const voteKickPolicy = await (new ContractFactory(voteKickPolicyABI, voteKickPolicyBytecode,
            this.adminWallet)).deploy() as VoteKickPolicy
        await voteKickPolicy.deployed()
        this.addresses.SponsorshipVoteKickPolicy = voteKickPolicy.address
        this.contracts.sponsorshipVoteKickPolicy = voteKickPolicy
        log(`voteKickPolicy address ${voteKickPolicy.address}`)

        const sponsorshipTemplate = await (new ContractFactory(sponsorshipABI, sponsorshipBytecode,
            this.adminWallet)).deploy() as Sponsorship
        await sponsorshipTemplate.deployed()
        log(`sponsorshipTemplate address ${sponsorshipTemplate.address}`)

        const sponsorshipFactoryFactory = await(new ContractFactory(sponsorshipFactoryABI, sponsorshipFactoryBytecode,
            this.adminWallet)).deploy() as SponsorshipFactory
        const sponsorshipFactory = await sponsorshipFactoryFactory.deployed()
        await ( await sponsorshipFactoryFactory.initialize(sponsorshipTemplate.address,
            token.address, streamrConfig.address)).wait()
        await (await sponsorshipFactory.addTrustedPolicies([maxOperatorsJoinPolicy.address,
            allocationPolicy.address, leavePolicy.address, voteKickPolicy.address])).wait()

        await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
        this.addresses.SponsorshipFactory = sponsorshipFactory.address
        this.contracts.sponsorshipFactory = sponsorshipFactory
        log(`sponsorshipFactory address ${sponsorshipFactory.address}`)

        await (await token.mint(this.adminWallet.address, ethers.utils.parseEther("1000000000"))).wait()
        log(`minted 1000000 tokens to ${this.adminWallet.address}`)
    }

    async deployNewSponsorship(): Promise<Sponsorship> {
        const sponsorshiptx = await this.contracts.sponsorshipFactory.deploySponsorship(
            ethers.utils.parseEther("60"), 0, 1, this.streamId, "metadata",
            [
                this.addresses.SponsorshipStakeWeightedAllocationPolicy,
                ethers.constants.AddressZero,
                this.addresses.SponsorshipVoteKickPolicy,
            ], [
                ethers.utils.parseEther("0.01"),
                "0",
                "0"
            ]
        )
        const sponsorshipReceipt = await sponsorshiptx.wait()
        this.sponsorshipAddress = sponsorshipReceipt.events?.filter((e) => e.event === "NewSponsorship")[0]?.args?.sponsorshipContract
        this.sponsorship = new Contract(this.sponsorshipAddress, sponsorshipABI, this.adminWallet) as Sponsorship
        log("new sponsorship address: " + this.sponsorshipAddress)
        return this.sponsorship
    }

    async sponsorNewSponsorship(): Promise<void> {
        await (await this.contracts.DATA.approve(this.sponsorshipAddress, ethers.utils.parseEther("7"))).wait()
        const sponsorTx = await this.sponsorship!.sponsor(ethers.utils.parseEther("7"))
        await sponsorTx.wait()
        log("sponsored through token approval")
    }

    async stakeOnSponsorship(): Promise<void> {
        const tx = await this.contracts.DATA.transferAndCall(this.sponsorship!.address, ethers.utils.parseEther("100"),
            this.adminWallet.address)
        await tx.wait()
        log("staked in sponsorship with transfer and call")
    }

    async deployOperatorFactory(): Promise<void> {
        const operatorTemplate = await (new ContractFactory(operatorABI, operatorBytecode, this.adminWallet)).deploy() as Operator
        await operatorTemplate.deployed()
        log("Deployed Operator contract template " + operatorTemplate.address)
        const defaultDelegationPolicy = await (new ContractFactory(defaultDelegationPolicyABI, defaultDelegationPolicyBytecode,
            this.adminWallet)).deploy() as DefaultDelegationPolicy
        await defaultDelegationPolicy.deployed()
        this.addresses.OperatorDefaultDelegationPolicy = defaultDelegationPolicy.address
        log("Deployed default Operator contract delegation policy " + defaultDelegationPolicy.address)
        const defaultPoolYieldPolicy = await (new ContractFactory(defaultPoolYieldPolicyABI, defaultPoolYieldPolicyBytecode,
            this.adminWallet)).deploy() as DefaultPoolYieldPolicy
        await defaultPoolYieldPolicy.deployed()
        this.addresses.OperatorDefaultPoolYieldPolicy = defaultPoolYieldPolicy.address
        log("Deployed default Operator contract yield policy " + defaultPoolYieldPolicy.address)
        const defaultUndelegationPolicy = await (new ContractFactory(defaultUndelegationPolicyABI, defaultUndelegationPolicyBytecode,
            this.adminWallet)).deploy() as DefaultUndelegationPolicy
        await defaultUndelegationPolicy.deployed()
        this.addresses.OperatorDefaultUndelegationPolicy = defaultUndelegationPolicy.address
        log("Deployed default Operator contract undelegation policy " + defaultUndelegationPolicy.address)

        const operatorFactoryFactory = new ContractFactory(operatorFactoryABI, operatorFactoryBytecode,
            this.adminWallet)
        const operatorFactory = await operatorFactoryFactory.deploy() as OperatorFactory
        await operatorFactory.deployed()
        await (await operatorFactory.initialize(
            operatorTemplate.address,
            this.addresses.DATA,
            this.addresses.StreamrConfig)).wait()
        log("Deployed Operator contract factory " + operatorFactory.address)
        this.addresses.OperatorFactory = operatorFactory.address
        this.contracts.operatorFactory = operatorFactory
        await (await operatorFactory.addTrustedPolicies([
            defaultDelegationPolicy.address,
            defaultPoolYieldPolicy.address,
            defaultUndelegationPolicy.address,
        ])).wait()
        log("Added trusted policies")

        await (await this.contracts.streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
        log("Operator contract factory is now set in StreamrConfig")
    }

    async deployOperatorContract(): Promise<Operator> {
        log("Deploying pool")
        const pooltx = await this.contracts.operatorFactory.connect(this.adminWallet).deployOperator(
            [`Pool-${Date.now()}`, "{}"],
            [this.addresses.OperatorDefaultDelegationPolicy, this.addresses.OperatorDefaultPoolYieldPolicy,
                this.addresses.OperatorDefaultUndelegationPolicy],
            [0, 0, 0, 0, 0, 10]
        )
        const poolReceipt = await pooltx.wait()
        const operatorAddress = poolReceipt.events?.find((e: any) => e.event === "NewOperator")?.args?.operatorContractAddress
        log("Operator deployed at: ", operatorAddress)
        this.operatorAddress = operatorAddress
        this.operator = new Contract(operatorAddress, operatorABI, this.adminWallet) as Operator
        return this.operator
    }

    async investToPool(): Promise<void> {
        const tx = await this.contracts.DATA.connect(this.adminWallet).transferAndCall(this.operatorAddress, ethers.utils.parseEther("1000"),
            this.adminWallet.address)
        await tx.wait()
        log("Invested to pool ", this.operatorAddress)
    }

    async stakeIntoSponsorship(): Promise<void> {
        const tx = await this.operator!.connect(this.adminWallet).stake(this.sponsorshipAddress, ethers.utils.parseEther("1000"))
        await tx.wait()
        log("Staked into sponsorship from pool ", this.operatorAddress)
    }
}
