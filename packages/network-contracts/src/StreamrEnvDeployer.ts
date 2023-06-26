import { Contract, ContractFactory, Wallet, ethers, providers } from "ethers"
// import { Logger } from "@streamr/utils"
import { ENSCache, IAllocationPolicy, IDelegationPolicy, IJoinPolicy,
    IKickPolicy, ILeavePolicy, IPoolYieldPolicy, IUndelegationPolicy, NodeRegistry,
    Operator,
    OperatorFactory, Sponsorship, SponsorshipFactory, StreamRegistryV4,
    StreamStorageRegistry, StreamrConfig, TestToken } from "../typechain"
import debug from "debug"
import { defaultDelegationPolicyABI, defaultDelegationPolicyBytecode, defaultLeavePolicyABI,
    defaultLeavePolicyBytecode, defaultPoolYieldPolicyABI, defaultPoolYieldPolicyBytecode,
    defaultUndelegationPolicyABI, defaultUndelegationPolicyBytecode, maxOperatorsJoinPolicyABI,
    maxOperatorsJoinPolicyBytecode, operatorABI, operatorBytecode, operatorFactoryABI,
    operatorFactoryBytecode, sponsorshipABI, sponsorshipBytecode, sponsorshipFactoryABI,
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
        // this.config.sponsorshipTemplate = sponsorshipTemplate.address
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
        // await (await token.mint(operatorWallet.address, ethers.utils.parseEther("100000"))).wait()
        // log(`transferred 100000 tokens to ${operatorWallet.address}`)
        // await (await this.adminWallet.sendTransaction({ to: operatorWallet.address, value: ethers.utils.parseEther("1") })).wait()
        // log(`transferred 1 ETH to ${operatorWallet.address}`)
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
        // eslint-disable-next-line require-atomic-updates
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
        // eslint-disable-next-line require-atomic-updates
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

    // async function main() {
    //     this.adminWallet = (await ethers.getSigners())[0] as unknown as Wallet

    //     operatorWallet = ethers.Wallet.createRandom()
    //     log(`wallet address ${adminWallet.address}`)

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
    //     log("wrote this.config.json")
    // }

}
