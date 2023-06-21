import { Contract, Wallet, providers } from "ethers"
import { Logger } from "@streamr/utils"
import { ethers, upgrades } from "@nomicfoundation/hardhat-toolbox"
import { ENSCache, IAllocationPolicy, IDelegationPolicy, IJoinPolicy,
    IKickPolicy, ILeavePolicy, IPoolYieldPolicy, IUndelegationPolicy, NodeRegistry,
    Operator,
    OperatorFactory, Sponsorship, SponsorshipFactory, StreamRegistryV4,
    StreamStorageRegistry, StreamrConfig, TestToken } from "../typechain"

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
            // "SponsorshipDefaultPoolYieldPolicy": string,
            "SponsorshipDefaultUndelegationPolicy": string,
            "SponsorshipMaxOperatorsJoinPolicy": string,
            "SponsorshipStakeWeightedAllocationPolicy": string,
            "SponsorshipDefaultLeavePolicy": string,
            "SponsorshipVoteKickPolicy": string,
            "SponsorshipOperatorContractOnlyJoinPolicy": string,
            "OperatorFactory": string,
            "OperatorDefaultDelegationPolicy": string,
            "OperatorDefaultUndelegationPolicy": string,
            "OperatorDefaultPoolYieldPolicy": string,
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
    "operatorDefaultPoolYieldPolicy": IAllocationPolicy,
    "operatorContractOnlyJoinPolicy": IJoinPolicy,
    "dataUnionFactory": Contract,
    "dataUnionTemplate": Contract,
    "defaultFeeOracle": Contract
}

export class StreamrEnvDeployer {

    private readonly adminWallet: Wallet
    private readonly logger: Logger = new Logger(module)
    private readonly addresses: EnvContracAddresses
    private readonly contracts: EnvContracts
    private streamId: string
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

    async deployEverything(): Promise<void>{
    }

    async deployStreamRegistry(): Promise<void> {
        this.logger.debug("deploying StreamRegistry")
        const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV4", { signer: this.adminWallet })
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [
            Wallet.createRandom().address,
            Wallet.createRandom().address
        ], { kind: "uups" })
        const streamRegistry = await streamRegistryFactoryTx.deployed() as StreamRegistryV4
        this.addresses.StreamRegistry = streamRegistry.address
        this.contracts.streamRegistry = streamRegistry

        const streampath = "/test" + Date.now()
        this.logger.debug(`deployed StreamRegistry at ${streamRegistry.address}`)
        this.logger.debug(`creating stream ${streampath}`)
        await ((await streamRegistry.createStream(streampath, "{}")).wait())
        this.streamId = this.adminWallet.address.toLowerCase() + streampath
        this.logger.debug(`streamId ${this.streamId}`)
    }

    async deploySponsorshipFactory(): Promise<void> {
        const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", { signer: this.adminWallet })
        const streamrConfigFactoryTx = await upgrades.deployProxy(streamrConfigFactory, [], { kind: "uups" })
        const streamrConfig = await streamrConfigFactoryTx.deployed() as StreamrConfig
        const hasroleEthSigner = await streamrConfig.hasRole(await streamrConfig.DEFAULT_ADMIN_ROLE(), this.adminWallet.address)
        this.logger.debug(`hasrole ${hasroleEthSigner}`)
        this.addresses.StreamrConfig = streamrConfig.address
        this.contracts.streamrConfig = streamrConfig
        this.logger.debug(`streamrConfig address ${streamrConfig.address}`)
        await (await streamrConfig.setStreamRegistryAddress(this.addresses.StreamRegistry)).wait()

        const token = await (await ethers.getContractFactory("TestToken", { signer: this.adminWallet })).deploy("Test token", "TEST") as TestToken
        await token.deployed()
        this.addresses.DATA = token.address
        this.contracts.DATA = token
        this.logger.debug(`token address ${token.address}`)

        const maxOperatorsJoinPolicy = await (await ethers.getContractFactory("MaxOperatorsJoinPolicy",
            { signer: this.adminWallet })).deploy() as IJoinPolicy
        await maxOperatorsJoinPolicy.deployed()
        this.addresses.SponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy.address
        this.contracts.sponsorshipMaxOperatorsJoinPolicy = maxOperatorsJoinPolicy
        this.logger.debug(`maxOperatorsJoinPolicy address ${maxOperatorsJoinPolicy.address}`)

        const allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy",
            { signer: this.adminWallet })).deploy() as IAllocationPolicy
        await allocationPolicy.deployed()
        this.addresses.SponsorshipStakeWeightedAllocationPolicy = allocationPolicy.address
        this.contracts.sponsorshipStakeWeightedAllocationPolicy = allocationPolicy
        this.logger.debug(`allocationPolicy address ${allocationPolicy.address}`)

        const leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy",
            { signer: this.adminWallet })).deploy() as ILeavePolicy
        await leavePolicy.deployed()
        this.addresses.SponsorshipDefaultLeavePolicy = leavePolicy.address
        this.contracts.sponsorshipDefaultLeavePolicy = leavePolicy
        this.logger.debug(`leavePolicy address ${leavePolicy.address}`)

        const voteKickPolicy = await (await ethers.getContractFactory("VoteKickPolicy",
            { signer: this.adminWallet })).deploy() as IKickPolicy
        await voteKickPolicy.deployed()
        this.addresses.SponsorshipVoteKickPolicy = voteKickPolicy.address
        this.contracts.sponsorshipVoteKickPolicy = voteKickPolicy
        this.logger.debug(`voteKickPolicy address ${voteKickPolicy.address}`)

        const sponsorshipTemplate = await (await ethers.getContractFactory("Sponsorship")).deploy() as Sponsorship
        await sponsorshipTemplate.deployed()
        // this.config.sponsorshipTemplate = sponsorshipTemplate.address
        this.logger.debug(`sponsorshipTemplate address ${sponsorshipTemplate.address}`)

        const sponsorshipFactoryFactory = await ethers.getContractFactory("SponsorshipFactory", { signer: this.adminWallet })
        const sponsorshipFactoryFactoryTx = await upgrades.deployProxy(sponsorshipFactoryFactory,
            [ sponsorshipTemplate.address, token.address, streamrConfig.address ], { kind: "uups", unsafeAllow: ["delegatecall"]})
        const sponsorshipFactory = await sponsorshipFactoryFactoryTx.deployed() as SponsorshipFactory
        await (await sponsorshipFactory.addTrustedPolicies([maxOperatorsJoinPolicy.address,
            allocationPolicy.address, leavePolicy.address, voteKickPolicy.address])).wait()

        await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
        this.addresses.SponsorshipFactory = sponsorshipFactory.address
        this.contracts.sponsorshipFactory = sponsorshipFactory
        this.logger.debug(`sponsorshipFactory address ${sponsorshipFactory.address}`)

        await (await token.mint(this.adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
        this.logger.debug(`minted 1000000 tokens to ${this.adminWallet.address}`)
        // await (await token.mint(operatorWallet.address, ethers.utils.parseEther("100000"))).wait()
        // this.logger.debug(`transferred 100000 tokens to ${operatorWallet.address}`)
        // await (await this.adminWallet.sendTransaction({ to: operatorWallet.address, value: ethers.utils.parseEther("1") })).wait()
        // this.logger.debug(`transferred 1 ETH to ${operatorWallet.address}`)
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

        this.logger.debug("new sponsorship address: " + this.sponsorshipAddress)
    }

    async sponsorNewSponsorship(): Promise<void> {
    // sponsor with token approval
    // const ownerbalance = await token.balanceOf(adminWallet.address)
        await (await this.contracts.DATA.approve(this.sponsorshipAddress, ethers.utils.parseEther("7"))).wait()
        // const allowance = await token.allowance(adminWallet.address, sponsorship.address)
        const sponsorTx = await this.sponsorship!.sponsor(ethers.utils.parseEther("7"))
        await sponsorTx.wait()
        this.logger.debug("sponsored through token approval")
    }

    async stakeOnSponsorship(): Promise<void> {
        const tx = await this.contracts.DATA.transferAndCall(this.sponsorship!.address, ethers.utils.parseEther("100"),
            this.adminWallet.address)
        await tx.wait()
        this.logger.debug("staked in sponsorship with transfer and call")
    }

    async deployOperatorFactory(): Promise<void> {
        const operatorTemplate = await (await ethers.getContractFactory("Operator")).deploy() as Operator
        await operatorTemplate.deployed()
        this.logger.debug("Deployed Operator contract template " + operatorTemplate.address)
        const defaultDelegationPolicy = await (await ethers.getContractFactory("DefaultDelegationPolicy",
            { signer: this.adminWallet })).deploy() as IDelegationPolicy
        await defaultDelegationPolicy.deployed()
        this.addresses.OperatorDefaultDelegationPolicy = defaultDelegationPolicy.address
        this.logger.debug("Deployed default Operator contract delegation policy " + defaultDelegationPolicy.address)
        const defaultPoolYieldPolicy = await (await ethers.getContractFactory("DefaultPoolYieldPolicy",
            { signer: this.adminWallet })).deploy() as IPoolYieldPolicy
        await defaultPoolYieldPolicy.deployed()
        this.addresses.OperatorDefaultPoolYieldPolicy = defaultPoolYieldPolicy.address
        this.logger.debug("Deployed default Operator contract yield policy " + defaultPoolYieldPolicy.address)
        const defaultUndelegationPolicy = await (await ethers.getContractFactory("DefaultUndelegationPolicy",
            { signer: this.adminWallet })).deploy() as IUndelegationPolicy
        await defaultUndelegationPolicy.deployed()
        this.addresses.OperatorDefaultUndelegationPolicy = defaultUndelegationPolicy.address
        this.logger.debug("Deployed default Operator contract undelegation policy " + defaultUndelegationPolicy.address)

        const operatorFactoryFactory = await ethers.getContractFactory("OperatorFactory",
            { signer: this.adminWallet })
        const operatorFactory = await upgrades.deployProxy(operatorFactoryFactory, [
            operatorTemplate.address,
            this.addresses.DATA,
            this.addresses.StreamrConfig
        ], {kind: "uups", unsafeAllow: ["delegatecall"]}) as unknown as OperatorFactory
        // eslint-disable-next-line require-atomic-updates
        // this.config.operatorFactory = operatorFactory.address
        await operatorFactory.deployed()
        this.logger.debug("Deployed Operator contract factory " + operatorFactory.address)
        // eslint-disable-next-line require-atomic-updates
        this.addresses.OperatorFactory = operatorFactory.address
        await (await operatorFactory.addTrustedPolicies([
            defaultDelegationPolicy.address,
            defaultPoolYieldPolicy.address,
            defaultUndelegationPolicy.address,
        ])).wait()
        this.logger.debug("Added trusted policies")

        const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", { signer: this.adminWallet })
        const streamrConfig = await streamrConfigFactory.attach(this.addresses.StreamrConfig) as StreamrConfig
        await (await streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
        this.logger.debug("Set Operator contract factory in StreamrConfig")
    }

    async deployOperatorContract(): Promise<void> {
        this.logger.debug("Deploying pool")
        const pooltx = await this.contracts.operatorFactory.connect(this.adminWallet).deployOperator(
            [`Pool-${Date.now()}`, "{}"],
            [this.addresses.OperatorDefaultDelegationPolicy, this.addresses.OperatorDefaultPoolYieldPolicy,
                this.addresses.OperatorDefaultUndelegationPolicy],
            [0, 0, 0, 0, 0, 10]
        )
        const poolReceipt = await pooltx.wait()
        const operatorAddress = poolReceipt.events?.find((e: any) => e.event === "NewOperator")?.args?.operatorContractAddress
        // eslint-disable-next-line require-atomic-updates
        this.logger.debug("Operator deployed at: ", operatorAddress)
        this.operatorAddress = operatorAddress
        this.operator = await ethers.getContractAt("Operator", operatorAddress, this.adminWallet) as Operator
    }

    async investToPool(): Promise<void> {
        const tx = await this.contracts.DATA.connect(this.adminWallet).transferAndCall(this.operatorAddress, ethers.utils.parseEther("1000"),
            this.adminWallet.address)
        await tx.wait()
        this.logger.debug("Invested to pool ", this.operatorAddress)
    }

    async stakeIntoSponsorship(): Promise<void> {
        const tx = await this.operator!.connect(this.adminWallet).stake(this.sponsorshipAddress, ethers.utils.parseEther("1000"))
        await tx.wait()
        this.logger.debug("Staked into sponsorship from pool ", this.operatorAddress)
    }

    // async function main() {
    //     this.adminWallet = (await ethers.getSigners())[0] as unknown as Wallet

    //     operatorWallet = ethers.Wallet.createRandom()
    //     this.logger.debug(`wallet address ${adminWallet.address}`)

    //     await deployStreamRegistry()
    //     await deploySponsorshipFactory()
    //     await deployNewSponsorship()
    //     await sponsorNewSponsorship()
    //     await stakeOnSponsorship()
    //     await deployOperatorFactory()
    //     await deployOperatorContracts(1)
    //     await investToPool()
    //     await stakeIntoSponsorship()

    //     this.config.adminKey = privKeyStreamRegistry
    //     const configString = JSON.stringify(this.config, null, 4)
    //     fs.writeFileSync("this.config.json", configString)
    //     this.logger.debug("wrote this.config.json")
    // }

}
