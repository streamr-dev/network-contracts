import { Contract, Wallet, providers } from "ethers"
import { ethers, upgrades } from "hardhat"
import { ENSCache, IAllocationPolicy, IDelegationPolicy, IJoinPolicy,
    IKickPolicy, ILeavePolicy, IExchangeRatePolicy, IUndelegationPolicy, NodeRegistry,
    Operator,
    OperatorFactory, Sponsorship, SponsorshipFactory, StreamRegistryV4,
    StreamStorageRegistry, StreamrConfig, TestToken } from "../../typechain"
import debug from "debug"

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
    "SponsorshipDefaultDelegationPolicy": string,
    // "SponsorshipDefaultExchangeRatePolicy": string,
    "SponsorshipDefaultUndelegationPolicy": string,
    "SponsorshipMaxOperatorsJoinPolicy": string,
    "SponsorshipStakeWeightedAllocationPolicy": string,
    "SponsorshipDefaultLeavePolicy": string,
    "SponsorshipVoteKickPolicy": string,
    "SponsorshipOperatorContractOnlyJoinPolicy": string,
    "OperatorFactory": string,
    "OperatorDefaultDelegationPolicy": string,
    "OperatorDefaultUndelegationPolicy": string,
    "OperatorDefaultExchangeRatePolicy": string,
    "OperatorContractOnlyJoinPolicy": string,

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
    "sponsorshipDefaultDelegationPolicy": IDelegationPolicy,
    "sponsorshipDefaultUndelegationPolicy": IUndelegationPolicy,
    "sponsorshipMaxOperatorsJoinPolicy": IJoinPolicy,
    "sponsorshipStakeWeightedAllocationPolicy": IAllocationPolicy,
    "sponsorshipDefaultLeavePolicy": ILeavePolicy,
    "sponsorshipVoteKickPolicy": IKickPolicy,
    "operatorFactory": OperatorFactory,
    "operatorDefaultDelegationPolicy": IDelegationPolicy,
    "operatorDefaultUndelegationPolicy": IUndelegationPolicy,
    "operatorDefaultExchangeRatePolicy": IAllocationPolicy,
    "operatorContractOnlyJoinPolicy": IJoinPolicy,
    "dataUnionFactory": Contract,
    "dataUnionTemplate": Contract,
    "defaultFeeOracle": Contract
}

const log = debug.log

export class StreamrEnvDeployerHardhat {

    private readonly adminWallet: Wallet
    private readonly addresses: EnvContracAddresses
    private readonly contracts: EnvContracts
    private streamId: string
    private sponsorshipAddress: string
    private sponsorship?: Sponsorship
    private operatorAddress: string
    private operator?: Operator

    constructor(key: string, chainEndpointUrl: string) {
        this.adminWallet = new Wallet(key, new providers.JsonRpcProvider(chainEndpointUrl))
        this.addresses = {} as EnvContracAddresses
        this.contracts = {} as EnvContracts
        this.streamId = ""
        this.sponsorshipAddress = ""
        this.operatorAddress = ""
    }

    async deployEverything(): Promise<void>{
        await this.deployStreamRegistry()
        await this.deploySponsorshipFactory()
        await this.deployNewSponsorship()
        await this.sponsorNewSponsorship()
        await this.stakeOnSponsorship()
        await this.deployOperatorFactory()
        await this.deployOperatorContract()
        await this.investToPool()
        await this.stakeIntoSponsorship()
    }

    async deployStreamRegistry(): Promise<void> {
        log("deploying StreamRegistry")
        const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV4", { signer: this.adminWallet })
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [
            Wallet.createRandom().address,
            Wallet.createRandom().address
        ], { kind: "uups" })
        const streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV4
        this.addresses.StreamRegistry = streamRegistry.address
        this.contracts.streamRegistry = streamRegistry

        const streampath = "/test" + Date.now()
        log(`deployed StreamRegistry at ${streamRegistry.address}`)
        log(`creating stream ${streampath}`)
        await ((await streamRegistry.createStream(streampath, "{}")).wait())
        this.streamId = this.adminWallet.address.toLowerCase() + streampath
        log(`streamId ${this.streamId}`)
    }

    async deploySponsorshipFactory(): Promise<void> {
        const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", { signer: this.adminWallet })
        const streamrConfigFactoryTx = await upgrades.deployProxy(streamrConfigFactory, [], { kind: "uups" })
        const streamrConfig = await streamrConfigFactoryTx.deployed() as StreamrConfig
        const hasroleEthSigner = await streamrConfig.hasRole(await streamrConfig.DEFAULT_ADMIN_ROLE(), this.adminWallet.address)
        log(`hasrole ${hasroleEthSigner}`)
        this.addresses.StreamrConfig = streamrConfig.address
        this.contracts.streamrConfig = streamrConfig
        log(`streamrConfig address ${streamrConfig.address}`)
        await (await streamrConfig.setStreamRegistryAddress(this.addresses.StreamRegistry)).wait()

        const token = await (await ethers.getContractFactory("TestToken", { signer: this.adminWallet })).deploy("Test token", "TEST") as TestToken
        await token.deployed()
        this.addresses.DATA = token.address
        this.contracts.DATA = token
        log(`token address ${token.address}`)

        const maxOperatorsJoinPolicy = await (await ethers.getContractFactory("MaxOperatorsJoinPolicy",
            { signer: this.adminWallet })).deploy() as IJoinPolicy
        await maxOperatorsJoinPolicy.deployed()
        this.addresses.SponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy.address
        this.contracts.sponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy
        log(`maxOperatorsJoinPolicy address ${maxOperatorsJoinPolicy.address}`)

        const allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy",
            { signer: this.adminWallet })).deploy() as IAllocationPolicy
        await allocationPolicy.deployed()
        this.addresses.SponsorshipStakeWeightedAllocationPolicy = allocationPolicy.address
        this.contracts.sponsorshipStakeWeightedAllocationPolicy = allocationPolicy
        log(`allocationPolicy address ${allocationPolicy.address}`)

        const leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy",
            { signer: this.adminWallet })).deploy() as ILeavePolicy
        await leavePolicy.deployed()
        this.addresses.SponsorshipDefaultLeavePolicy = leavePolicy.address
        this.contracts.sponsorshipDefaultLeavePolicy = leavePolicy
        log(`leavePolicy address ${leavePolicy.address}`)

        const voteKickPolicy = await (await ethers.getContractFactory("VoteKickPolicy",
            { signer: this.adminWallet })).deploy() as IKickPolicy
        await voteKickPolicy.deployed()
        this.addresses.SponsorshipVoteKickPolicy = voteKickPolicy.address
        this.contracts.sponsorshipVoteKickPolicy = voteKickPolicy
        log(`voteKickPolicy address ${voteKickPolicy.address}`)

        const sponsorshipTemplate = await (await ethers.getContractFactory("Sponsorship")).deploy() as Sponsorship
        await sponsorshipTemplate.deployed()
        log(`sponsorshipTemplate address ${sponsorshipTemplate.address}`)

        const sponsorshipFactoryFactory = await ethers.getContractFactory("SponsorshipFactory", { signer: this.adminWallet })
        const sponsorshipFactoryFactoryTx = await upgrades.deployProxy(sponsorshipFactoryFactory,
            [ sponsorshipTemplate.address, token.address, streamrConfig.address ], { kind: "uups", unsafeAllow: ["delegatecall"]})
        const sponsorshipFactory = await sponsorshipFactoryFactoryTx.deployed() as SponsorshipFactory
        await (await sponsorshipFactory.addTrustedPolicies([maxOperatorsJoinPolicy.address,
            allocationPolicy.address, leavePolicy.address, voteKickPolicy.address])).wait()

        await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
        this.addresses.SponsorshipFactory = sponsorshipFactory.address
        this.contracts.sponsorshipFactory = sponsorshipFactory
        log(`sponsorshipFactory address ${sponsorshipFactory.address}`)

        await (await token.mint(this.adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
        log(`minted 1000000 tokens to ${this.adminWallet.address}`)
    }

    async deployNewSponsorship(): Promise<void> {
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
        this.sponsorship = await ethers.getContractAt("Sponsorship", this.sponsorshipAddress, this.adminWallet) as Sponsorship

        log("new sponsorship address: " + this.sponsorshipAddress)
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
        const operatorTemplate = await (await ethers.getContractFactory("Operator")).deploy() as Operator
        await operatorTemplate.deployed()
        log("Deployed Operator contract template " + operatorTemplate.address)
        const defaultDelegationPolicy = await (await ethers.getContractFactory("DefaultDelegationPolicy",
            { signer: this.adminWallet })).deploy() as IDelegationPolicy
        await defaultDelegationPolicy.deployed()
        this.addresses.OperatorDefaultDelegationPolicy = defaultDelegationPolicy.address
        log("Deployed default Operator contract delegation policy " + defaultDelegationPolicy.address)
        const defaultExchangeRatePolicy = await (await ethers.getContractFactory("DefaultExchangeRatePolicy",
            { signer: this.adminWallet })).deploy() as IExchangeRatePolicy
        await defaultExchangeRatePolicy.deployed()
        this.addresses.OperatorDefaultExchangeRatePolicy = defaultExchangeRatePolicy.address
        log("Deployed defaultExchangeRatePolicy " + defaultExchangeRatePolicy.address)
        const defaultUndelegationPolicy = await (await ethers.getContractFactory("DefaultUndelegationPolicy",
            { signer: this.adminWallet })).deploy() as IUndelegationPolicy
        await defaultUndelegationPolicy.deployed()
        this.addresses.OperatorDefaultUndelegationPolicy = defaultUndelegationPolicy.address
        log("Deployed default Operator contract undelegation policy " + defaultUndelegationPolicy.address)

        const operatorFactoryFactory = await ethers.getContractFactory("OperatorFactory",
            { signer: this.adminWallet })
        const operatorFactory = await upgrades.deployProxy(operatorFactoryFactory, [
            operatorTemplate.address,
            this.addresses.DATA,
            this.addresses.StreamrConfig
        ], {kind: "uups", unsafeAllow: ["delegatecall"]}) as unknown as OperatorFactory
        await operatorFactory.deployed()
        log("Deployed Operator contract factory " + operatorFactory.address)
        this.addresses.OperatorFactory = operatorFactory.address
        this.contracts.operatorFactory = operatorFactory
        await (await operatorFactory.addTrustedPolicies([
            defaultDelegationPolicy.address,
            defaultExchangeRatePolicy.address,
            defaultUndelegationPolicy.address,
        ])).wait()
        log("Added trusted policies")

        const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", { signer: this.adminWallet })
        const streamrConfig = await streamrConfigFactory.attach(this.addresses.StreamrConfig) as StreamrConfig
        await (await streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
        log("Set Operator contract factory in StreamrConfig")
    }

    async deployOperatorContract(): Promise<void> {
        log("Deploying pool")
        const pooltx = await this.contracts.operatorFactory.connect(this.adminWallet).deployOperator(
            ethers.utils.parseEther("0.1"),
            `Pool-${Date.now()}`,
            "{}",
            [this.addresses.OperatorDefaultDelegationPolicy, this.addresses.OperatorDefaultExchangeRatePolicy,
                this.addresses.OperatorDefaultUndelegationPolicy],
            [0, 0, 0]
        )
        const poolReceipt = await pooltx.wait()
        const operatorAddress = poolReceipt.events?.find((e: any) => e.event === "NewOperator")?.args?.operatorContractAddress
        log("Operator deployed at: ", operatorAddress)
        this.operatorAddress = operatorAddress
        this.operator = await ethers.getContractAt("Operator", operatorAddress, this.adminWallet) as Operator
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
