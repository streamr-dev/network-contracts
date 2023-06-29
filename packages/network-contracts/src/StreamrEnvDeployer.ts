import { Contract, ContractFactory, Wallet, ethers, providers } from "ethers"
import { ENSCache, IAllocationPolicy, IDelegationPolicy, IJoinPolicy,
    IKickPolicy, ILeavePolicy, IPoolYieldPolicy, IUndelegationPolicy, NodeRegistry,
    Operator,
    OperatorFactory, Sponsorship, SponsorshipFactory, StreamRegistryV4,
    StreamStorageRegistry, StreamrConfig, TestToken } from "../typechain"
import debug from "debug"
import { defaultDelegationPolicyABI, defaultDelegationPolicyBytecode, defaultLeavePolicyABI,
    defaultLeavePolicyBytecode, defaultPoolYieldPolicyABI, defaultPoolYieldPolicyBytecode,
    defaultUndelegationPolicyABI, defaultUndelegationPolicyBytecode, ensRegistryAbi, ensRegistryBytecode,
    fifsRegistrarAbi, fifsRegistrarBytecode, maxOperatorsJoinPolicyABI,
    maxOperatorsJoinPolicyBytecode, operatorABI, operatorBytecode, operatorFactoryABI,
    operatorFactoryBytecode, publicResolverAbi, publicResolverBytecode, sponsorshipABI, sponsorshipBytecode, sponsorshipFactoryABI,
    sponsorshipFactoryBytecode, stakeWeightedAllocationPolicyABI, stakeWeightedAllocationPolicyBytecode,
    streamRegistryABI, streamRegistryBytecode, streamrConfigABI, streamrConfigBytecode,
    tokenABI, tokenBytecode, voteKickPolicyABI, voteKickPolicyBytecode } from "./exports"

export type EnvContracAddresses = {
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
    // Projects related
    "MarketplaceV4": string,
    "ProjectRegistryV1": string,
    "ProjectStakingV1": string,
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

    // Data Unions:
    "DataUnionFactory": string,
    "DataUnionTemplate": string,
    "DefaultFeeOracle": string,
}

export type EnvContracts = {
    "DATA": TestToken,
    "ENS": Contract,
    "FIFSRegistrar": Contract,
    "publicResolver": Contract,
    "trackerRegistry": NodeRegistry,
    "storageNodeRegistry": NodeRegistry,
    "streamRegistry": StreamRegistryV4,
    "eNSCacheV2": ENSCache,
    "streamStorageRegistry": StreamStorageRegistry,
    "marketplaceV4": Contract,
    "projectRegistryV1": Contract,
    "projectStakingV1": Contract,
    "streamrConfig": StreamrConfig,
    "sponsorshipFactory": SponsorshipFactory,
    "sponsorshipDefaultLeavePolicy": ILeavePolicy,
    "sponsorshipMaxOperatorsJoinPolicy": IJoinPolicy,
    "sponsorshipOperatorContractOnlyJoinPolicy": IJoinPolicy,
    "sponsorshipStakeWeightedAllocationPolicy": IAllocationPolicy,
    "sponsorshipVoteKickPolicy": IKickPolicy,
    "operatorFactory": OperatorFactory,
    "operatorDefaultDelegationPolicy": IDelegationPolicy,
    "operatorDefaultUndelegationPolicy": IUndelegationPolicy,
    "operatorDefaultPoolYieldPolicy": IAllocationPolicy,
    "dataUnionFactory": Contract,
    "dataUnionTemplate": Contract,
    "defaultFeeOracle": Contract
}

const log = debug.log

export class StreamrEnvDeployer {

    readonly adminWallet: Wallet
    readonly addresses: EnvContracAddresses
    readonly contracts: EnvContracts
    streamId: string
    sponsorshipAddress: any
    sponsorship?: Sponsorship
    operatorAddress: any
    operator?: Operator

    constructor(key: string, chainEndpointUrl: string) {
        this.adminWallet = new Wallet(key, new providers.JsonRpcProvider(chainEndpointUrl))
        this.addresses = {} as EnvContracAddresses
        this.contracts = {} as EnvContracts
        this.streamId = ""
    }

    async deployEvironment(): Promise<void>{
        await this.deployStreamRegistry()
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
        const ensDeploy = new ContractFactory(ensRegistryAbi, ensRegistryBytecode, this.adminWallet)
        const ensDeployTx = await ensDeploy.deploy()
        this.contracts.ENS = await ensDeployTx.deployed()
        this.addresses.ENS = this.contracts.ENS.address
        log(`ENS registry deployed at ${this.contracts.ENS.address}`)

        const rootDomain = "eth"
        const domainNameHash = ethers.utils.namehash("eth")
        const rootDomainSha3 = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(rootDomain)) 
        const fifsDeploy = new ContractFactory(fifsRegistrarAbi, fifsRegistrarBytecode, this.adminWallet)
        const fifsDeployTx = await fifsDeploy.deploy(this.contracts.ENS.address, domainNameHash)
        this.contracts.FIFSRegistrar = await fifsDeployTx.deployed()
        this.addresses.FIFSRegistrar = this.contracts.FIFSRegistrar.address
        log(`FIFSRegistrar deployed at ${this.contracts.FIFSRegistrar.address}`)

        await(await this.contracts.ENS.setSubnodeOwner("0x0000000000000000000000000000000000000000000000000000000000000000",
            rootDomainSha3, this.contracts.FIFSRegistrar.address)).wait()
        const resDeploy = new ContractFactory(publicResolverAbi, publicResolverBytecode, this.adminWallet)
        const resDeployTx = await resDeploy.deploy(this.contracts.ENS.address)
        this.contracts.publicResolver = await resDeployTx.deployed()
        this.addresses.PublicResolver = this.contracts.publicResolver.address
        log(`PublicResolver deployed at ${this.contracts.publicResolver.address}`)
    }

    async registerEnsName(domain: string, ownerAddress: string): Promise<void> {
        const ensName = domain + ".eth"
        const hashedDomain = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(domain))
        const nameHashedENSName = ethers.utils.namehash(ensName)
        let tx = await this.contracts.FIFSRegistrar.register(hashedDomain, ownerAddress)
        await tx.wait()

        log("setting owner (" + ownerAddress + "), resolver and ttl for ens")
        tx = await this.contracts.ENS.setRecord(nameHashedENSName, ownerAddress, this.addresses.PublicResolver, 1000000)
        await tx.wait()
    }

    async deployStreamRegistry(): Promise<void> {
        const streamRegistryFactory = new ContractFactory(streamRegistryABI, streamRegistryBytecode, this.adminWallet)
        const streamRegistry = await streamRegistryFactory.deploy() as StreamRegistryV4
        await streamRegistry.deployed()
        await (await streamRegistry.initialize(
            Wallet.createRandom().address,
            Wallet.createRandom().address
        )).wait()
        this.addresses.StreamRegistry = streamRegistry.address
        this.contracts.streamRegistry = streamRegistry
        log(`streamRegistry address ${this.addresses.StreamRegistry}`)
    }

    async createStream(): Promise<void> {
        const streampath = "/test" + Date.now()
        log(`deployed StreamRegistry at ${this.contracts.streamRegistry.address}`)
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
            this.adminWallet)).deploy() as IJoinPolicy
        await maxOperatorsJoinPolicy.deployed()
        this.addresses.SponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy.address
        this.contracts.sponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy
        log(`maxOperatorsJoinPolicy address ${maxOperatorsJoinPolicy.address}`)

        const allocationPolicy = await (new ContractFactory(stakeWeightedAllocationPolicyABI, stakeWeightedAllocationPolicyBytecode,
            this.adminWallet)).deploy() as IAllocationPolicy
        await allocationPolicy.deployed()
        this.addresses.SponsorshipStakeWeightedAllocationPolicy = allocationPolicy.address
        this.contracts.sponsorshipStakeWeightedAllocationPolicy = allocationPolicy
        log(`allocationPolicy address ${allocationPolicy.address}`)

        const leavePolicy = await (new ContractFactory(defaultLeavePolicyABI, defaultLeavePolicyBytecode,
            this.adminWallet)).deploy() as ILeavePolicy
        await leavePolicy.deployed()
        this.addresses.SponsorshipDefaultLeavePolicy = leavePolicy.address
        this.contracts.sponsorshipDefaultLeavePolicy = leavePolicy
        log(`leavePolicy address ${leavePolicy.address}`)

        const voteKickPolicy = await (new ContractFactory(voteKickPolicyABI, voteKickPolicyBytecode,
            this.adminWallet)).deploy() as IKickPolicy
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
            this.adminWallet)).deploy() as IDelegationPolicy
        await defaultDelegationPolicy.deployed()
        this.addresses.OperatorDefaultDelegationPolicy = defaultDelegationPolicy.address
        log("Deployed default Operator contract delegation policy " + defaultDelegationPolicy.address)
        const defaultPoolYieldPolicy = await (new ContractFactory(defaultPoolYieldPolicyABI, defaultPoolYieldPolicyBytecode,
            this.adminWallet)).deploy() as IPoolYieldPolicy
        await defaultPoolYieldPolicy.deployed()
        this.addresses.OperatorDefaultPoolYieldPolicy = defaultPoolYieldPolicy.address
        log("Deployed default Operator contract yield policy " + defaultPoolYieldPolicy.address)
        const defaultUndelegationPolicy = await (new ContractFactory(defaultUndelegationPolicyABI, defaultUndelegationPolicyBytecode,
            this.adminWallet)).deploy() as IUndelegationPolicy
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
        log("Set Operator contract factory in StreamrConfig")
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
