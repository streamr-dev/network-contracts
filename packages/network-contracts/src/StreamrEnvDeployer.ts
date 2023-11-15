import { Contract, ContractFactory, Wallet, ethers, providers } from "ethers"

import debug from "debug"
import { DefaultDelegationPolicy, DefaultLeavePolicy, DefaultExchangeRatePolicy, DefaultUndelegationPolicy,
    ENSCacheV2, ENSCacheV2ABI, ENSCacheV2Bytecode, MaxOperatorsJoinPolicy, NodeRegistry, Operator, OperatorContractOnlyJoinPolicy,
    OperatorFactory, Sponsorship, SponsorshipFactory, StakeWeightedAllocationPolicy, StreamRegistry,
    StreamStorageRegistry, StreamrConfig, TestToken, VoteKickPolicy, defaultDelegationPolicyABI,
    defaultDelegationPolicyBytecode, defaultLeavePolicyABI,
    defaultLeavePolicyBytecode, defaultExchangeRatePolicyABI, defaultExchangeRatePolicyBytecode,
    defaultUndelegationPolicyABI, defaultUndelegationPolicyBytecode, ensRegistryABI, ensRegistryBytecode,
    fifsRegistrarABI, fifsRegistrarBytecode, maxOperatorsJoinPolicyABI,
    maxOperatorsJoinPolicyBytecode, nodeRegistryABI, nodeRegistryBytecode,
    nodeModuleABI, nodeModuleBytecode, operatorABI, operatorBytecode, operatorFactoryABI,
    operatorFactoryBytecode, publicResolverABI, publicResolverBytecode, queueModuleABI, queueModuleBytecode,
    sponsorshipABI, sponsorshipBytecode, sponsorshipFactoryABI,
    sponsorshipFactoryBytecode, stakeModuleABI, stakeModuleBytecode, stakeWeightedAllocationPolicyABI, stakeWeightedAllocationPolicyBytecode,
    streamRegistryABI, streamRegistryBytecode, streamStorageRegistryABI, streamStorageRegistryBytecode, streamrConfigABI, streamrConfigBytecode,
    tokenABI, tokenBytecode, voteKickPolicyABI, voteKickPolicyBytecode, operatorContractOnlyJoinPolicyABI, operatorContractOnlyJoinPolicyBytecode } from "./exports"
import { parseEther } from "ethers/lib/utils"

const VOTE_KICK    = "0x0000000000000000000000000000000000000000000000000000000000000001"

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
    "OperatorDefaultExchangeRatePolicy": string,

    // Data Unions: // TODO: remove, these are deployed elsewhere
    // "DataUnionFactory": string,
    // "DataUnionTemplate": string,
    // "DefaultFeeOracle": string,
}

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
    "operatorDefaultExchangeRatePolicy": DefaultExchangeRatePolicy,
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
    readonly preloadedDATAWallets: Wallet[] = []
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

    async deployEnvironment({ deployToken = true } = {}): Promise<void> {
        if (deployToken) {
            await this.deployToken()
        }
        await this.deployEns()
        await this.deployRegistries()
        await this.deploySponsorshipFactory()
        await this.deployOperatorFactory()
        await this.preloadDATAToken()
    }

    async createFundStakeSponsorshipAndOperator(): Promise<void> {
        await this.createStream("/testStream")
        await this.deployNewSponsorship()
        await this.sponsorNewSponsorship()
        await this.deployOperatorContract()
        await this.delegate()
        await this.stakeIntoSponsorship()

        const operator2 = await this.deployOperatorContract(this.preloadedDATAWallets[2]) // flagger
        const operator3 = await this.deployOperatorContract(this.preloadedDATAWallets[3]) // target

        await this.flagVoteWithdraw(operator2, operator3, this.operator!)

    }

    async deployToken(): Promise<void> {
        const tokenFactory = new ContractFactory(tokenABI, tokenBytecode, this.adminWallet)
        const token = await tokenFactory.deploy("Test token", "TEST") as TestToken
        await token.deployed()
        this.addresses.DATA = token.address
        this.contracts.DATA = token
        log(`token address ${token.address}`)
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

        log("Deploying NodeRegistry contract 1 (tracker registry)")
        const initialTrackerNodes = []
        const initialTrackerMetadata = []
        initialTrackerNodes.push("0xb9e7cEBF7b03AE26458E32a059488386b05798e8")
        initialTrackerMetadata.push("{\"ws\": \"ws://10.200.10.1:30301\", \"http\": \"http://10.200.10.1:30301\"}")
        initialTrackerNodes.push("0x0540A3e144cdD81F402e7772C76a5808B71d2d30")
        initialTrackerMetadata.push("{\"ws\": \"ws://10.200.10.1:30302\", \"http\": \"http://10.200.10.1:30302\"}")
        initialTrackerNodes.push("0xf2C195bE194a2C91e93Eacb1d6d55a00552a85E2")
        initialTrackerMetadata.push("{\"ws\": \"ws://10.200.10.1:30303\", \"http\": \"http://10.200.10.1:30303\"}")

        const nodeRegistryFactory = new ContractFactory(nodeRegistryABI, nodeRegistryBytecode, this.adminWallet)
        const trackerRegDeployTx = await nodeRegistryFactory.deploy()
        const trackerRegistry = await trackerRegDeployTx.deployed() as NodeRegistry
        await (await trackerRegistry.initialize(this.adminWallet.address, false, initialTrackerNodes, initialTrackerMetadata)).wait()
        this.addresses.TrackerRegistry = trackerRegistry.address
        this.contracts.trackerRegistry = trackerRegistry
        log(`TrackerNodeRegistry deployed at ${trackerRegistry.address}`)
        const nodes = await trackerRegistry.getNodes()
        log(`TrackerNodeRegistry nodes : ${JSON.stringify(nodes)}`)

        log("Deploying NodeRegistry contract 2 (storage node registry)")
        const initialStorageNodes = []
        const initialStorageMetadata = []
        initialStorageNodes.push("0xde1112f631486CfC759A50196853011528bC5FA0")
        initialStorageMetadata.push("{\"http\": \"http://10.200.10.1:8891\"}")
        const nodeRegistry = await nodeRegistryFactory.deploy() as NodeRegistry
        await nodeRegistry.deployed()
        await (await nodeRegistry.initialize(this.adminWallet.address, false, initialStorageNodes, initialStorageMetadata)).wait()
        this.addresses.StorageNodeRegistry = nodeRegistry.address
        this.contracts.storageNodeRegistry = nodeRegistry
        log(`StorageNodeRegistry deployed at ${this.addresses.StorageNodeRegistry}`)

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

        const storageNodePk = "0xaa7a3b3bb9b4a662e756e978ad8c6464412e7eef1b871f19e5120d4747bce966"
        const storageNodeWallet = new ethers.Wallet(storageNodePk, this.provider)
        const streamRegistry2 = streamRegistry.connect(storageNodeWallet)

        log("Create storage node assignment stream")
        const storageNodeAssignmentPath = "/assignments"
        const storageNodeAssignmentsStreamId = "0xde1112f631486cfc759a50196853011528bc5fa0/assignments"
        await (await streamRegistry2.createStream(storageNodeAssignmentPath, JSON.stringify({ partitions: 1}))).wait()
        await (await streamRegistry2.setPublicPermission(storageNodeAssignmentsStreamId,
            ethers.constants.MaxUint256, ethers.constants.MaxUint256)).wait()
        log("Storage node assignment stream created: " + storageNodeAssignmentsStreamId)

        const scriptKeyAddress = "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1"
        const ensCacheV2Factory = new ContractFactory(ENSCacheV2ABI, ENSCacheV2Bytecode, this.adminWallet)
        const ensCacheV2 = await ensCacheV2Factory.deploy() as ENSCacheV2
        await ensCacheV2.deployed()
        await (await ensCacheV2.initialize(
            scriptKeyAddress,
            streamRegistry.address,
            ethers.constants.AddressZero, // # ENSCacheV1, do we need this in dev env?
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

    async createStream(streampath: string): Promise<void> {
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

        const operatorsOnlyJoinPolicy = await (new ContractFactory(operatorContractOnlyJoinPolicyABI, operatorContractOnlyJoinPolicyBytecode,
            this.adminWallet)).deploy() as OperatorContractOnlyJoinPolicy
        await operatorsOnlyJoinPolicy.deployed()
        this.addresses.SponsorshipOperatorContractOnlyJoinPolicy = operatorsOnlyJoinPolicy.address
        this.contracts.sponsorshipOperatorContractOnlyJoinPolicy = operatorsOnlyJoinPolicy
        log(`operatorsOnlyJoinPolicy address ${operatorsOnlyJoinPolicy.address}`)

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

        const sponsorshipFactoryFactory = new ContractFactory(sponsorshipFactoryABI, sponsorshipFactoryBytecode, this.adminWallet)
        const sponsorshipFactory = await sponsorshipFactoryFactory.deploy() as SponsorshipFactory
        await sponsorshipFactory.deployed()
        await (await sponsorshipFactory.initialize(
            sponsorshipTemplate.address,
            this.addresses.DATA,
            streamrConfig.address
        )).wait()

        await (await sponsorshipFactory.addTrustedPolicies([maxOperatorsJoinPolicy.address,
            allocationPolicy.address, leavePolicy.address, voteKickPolicy.address])).wait()

        await (await streamrConfig.setOperatorContractOnlyJoinPolicy(operatorsOnlyJoinPolicy.address)).wait()
        await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
        this.addresses.SponsorshipFactory = sponsorshipFactory.address
        this.contracts.sponsorshipFactory = sponsorshipFactory
        log(`sponsorshipFactory address ${sponsorshipFactory.address}`)

        await (await this.contracts.DATA.mint(this.adminWallet.address, ethers.utils.parseEther("1000000000"))).wait()
        log(`minted 1000000 tokens to ${this.adminWallet.address}`)
    }

    async deployNewSponsorship(): Promise<Sponsorship> {
        const sponsorshiptx = await this.contracts.sponsorshipFactory.deploySponsorship(
            1, this.streamId, "metadata",
            [
                this.addresses.SponsorshipStakeWeightedAllocationPolicy,
                ethers.constants.AddressZero,
                this.addresses.SponsorshipVoteKickPolicy,
                this.addresses.SponsorshipMaxOperatorsJoinPolicy
            ], [
                ethers.utils.parseEther("0.01"),
                "0",
                "0",
                "3"
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

    async deployOperatorFactory(): Promise<void> {
        const operatorTemplate = await (new ContractFactory(operatorABI, operatorBytecode, this.adminWallet)).deploy() as Operator
        await operatorTemplate.deployed()
        log("Deployed Operator contract template " + operatorTemplate.address)
        const defaultDelegationPolicy = await (new ContractFactory(defaultDelegationPolicyABI, defaultDelegationPolicyBytecode,
            this.adminWallet)).deploy() as DefaultDelegationPolicy
        await defaultDelegationPolicy.deployed()
        this.addresses.OperatorDefaultDelegationPolicy = defaultDelegationPolicy.address
        this.contracts.operatorDefaultDelegationPolicy = defaultDelegationPolicy
        log("Deployed default Operator contract delegation policy " + defaultDelegationPolicy.address)
        const defaultExchangeRatePolicy = await (new ContractFactory(defaultExchangeRatePolicyABI, defaultExchangeRatePolicyBytecode,
            this.adminWallet)).deploy() as DefaultExchangeRatePolicy
        await defaultExchangeRatePolicy.deployed()
        this.addresses.OperatorDefaultExchangeRatePolicy = defaultExchangeRatePolicy.address
        this.contracts.operatorDefaultExchangeRatePolicy = defaultExchangeRatePolicy
        log("Deployed defaultExchangeRatePolicy " + defaultExchangeRatePolicy.address)
        const defaultUndelegationPolicy = await (new ContractFactory(defaultUndelegationPolicyABI, defaultUndelegationPolicyBytecode,
            this.adminWallet)).deploy() as DefaultUndelegationPolicy
        await defaultUndelegationPolicy.deployed()
        this.addresses.OperatorDefaultUndelegationPolicy = defaultUndelegationPolicy.address
        this.contracts.operatorDefaultUndelegationPolicy = defaultUndelegationPolicy
        log("Deployed default Operator contract undelegation policy " + defaultUndelegationPolicy.address)

        log("Deploying operator node module")
        const operatorNodeModuleFactory = new ContractFactory(nodeModuleABI, nodeModuleBytecode,
            this.adminWallet)
        const operatorNodeModule = await operatorNodeModuleFactory.deploy() as Contract
        await operatorNodeModule.deployed()
        log("Deployed operator node module " + operatorNodeModule.address)
        log("Deploying operator queue module")
        const operatorQueueModuleFactory = new ContractFactory(queueModuleABI, queueModuleBytecode,
            this.adminWallet)
        const operatorQueueModule = await operatorQueueModuleFactory.deploy() as Contract
        await operatorQueueModule.deployed()
        log("Deployed operator queue module " + operatorQueueModule.address)
        log("Deploying operator stake module")
        const operatorStakeModuleFactory = new ContractFactory(stakeModuleABI, stakeModuleBytecode,
            this.adminWallet)
        const operatorStakeModule = await operatorStakeModuleFactory.deploy() as Contract
        await operatorStakeModule.deployed()
        log("Deployed operator stake module " + operatorStakeModule.address)

        log("Deploying Operator contract factory")
        const operatorFactoryFactory = new ContractFactory(operatorFactoryABI, operatorFactoryBytecode, this.adminWallet)
        const operatorFactory = await operatorFactoryFactory.deploy() as OperatorFactory
        await operatorFactory.deployed()
        await (await operatorFactory.initialize(
            operatorTemplate.address,
            this.addresses.DATA,
            this.addresses.StreamrConfig,
            operatorNodeModule.address,
            operatorQueueModule.address,
            operatorStakeModule.address
        )).wait()
        log("Deployed Operator contract factory " + operatorFactory.address)
        this.addresses.OperatorFactory = operatorFactory.address
        this.contracts.operatorFactory = operatorFactory
        await (await operatorFactory.addTrustedPolicies([
            defaultDelegationPolicy.address,
            defaultExchangeRatePolicy.address,
            defaultUndelegationPolicy.address,
        ])).wait()
        log("Added trusted policies")

        await (await this.contracts.streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
        log("Operator contract factory is now set in StreamrConfig")
    }

    async deployOperatorContract(deployer = this.adminWallet): Promise<Operator> {
        log("Deploying Operator contract for " + deployer.address)
        const pooltx = await this.contracts.operatorFactory.connect(deployer).deployOperator(
            parseEther("0.1"),
            "TestPool1",
            "{}",
            [
                this.addresses.OperatorDefaultDelegationPolicy,
                this.addresses.OperatorDefaultExchangeRatePolicy,
                this.addresses.OperatorDefaultUndelegationPolicy
            ],
            [0, 0, 0]
        )
        const poolReceipt = await pooltx.wait()
        const operatorAddress = poolReceipt.events?.find((e: any) => e.event === "NewOperator")?.args?.operatorContractAddress
        log("    Operator deployed at: ", operatorAddress)
        const operator = new Contract(operatorAddress, operatorABI, deployer) as Operator
        if (deployer.address == this.adminWallet.address) {
            this.operatorAddress = operatorAddress
            this.operator = operator
        } else {
            // add self-delegation
            log("    Adding self-delegation")
            await (await this.contracts.DATA.connect(deployer).transferAndCall(operator.address, parseEther("5003"), deployer.address)).wait()

            // stake to the sponsorship
            log("    Staking into sponsorship")
            await (await operator.stake(this.sponsorshipAddress, parseEther("5003"))).wait()
        }

        // add self as node
        log("    Adding self as node")
        await (await operator.setNodeAddresses([deployer.address])).wait()

        return operator
    }

    async delegate(): Promise<void> {
        log("Sending delegation to %s", this.operatorAddress)
        const tx = await this.contracts.DATA.connect(this.adminWallet).transferAndCall(this.operatorAddress, ethers.utils.parseEther("5003"),
            this.adminWallet.address)
        await tx.wait()
        log("    Delegation sent")
    }

    async stakeIntoSponsorship(): Promise<void> {
        // stake prime number to have decimal APY
        const tx = await this.operator!.connect(this.adminWallet).stake(this.sponsorshipAddress, ethers.utils.parseEther("5003"))
        await tx.wait()
        log("Staked into sponsorship from pool ", this.operatorAddress)
    }

    async flagVoteWithdraw(flagger: Operator, target: Operator, voter: Operator): Promise<void> {
        const { streamrConfig } = this.contracts
        log(`Flagging and kicking ${target.address} from ${this.sponsorship!.address}...`)

        const oldReviewPeriod = await streamrConfig.reviewPeriodSeconds()
        await (await streamrConfig.setReviewPeriodSeconds("0")).wait()

        await (await flagger.flag(this.sponsorship!.address, target.address, "{\"metadata\":\"asdf\"}")).wait()
        log(`    ${flagger.address} flagged ${target.address} in ${this.sponsorship!.address}`)

        await (await voter.voteOnFlag(this.sponsorship!.address, target.address, VOTE_KICK)).wait()
        log(`    ${voter.address} voted to kick ${target.address} in ${this.sponsorship!.address}`)

        await (await streamrConfig.setReviewPeriodSeconds(oldReviewPeriod)).wait()

        await (await voter.withdrawEarningsFromSponsorships([this.sponsorship!.address])).wait()
    }

    async preloadDATAToken(): Promise<void> {
        const preloadAmount = ethers.utils.parseEther("1000000")
        const preloadPrivkeys = [
            "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
            "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb",
            "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae",
            "0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9",
            "0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297",
            "0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728",
            "0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14",
            "0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7",
            "0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285"
        ]
        for (const preloadPrivkey of preloadPrivkeys) {
            const preloadWallet = new Wallet(preloadPrivkey, this.provider)
            this.preloadedDATAWallets.push(preloadWallet)
            const preloadAddress = preloadWallet.address
            log(`preloading ${preloadAmount} DATA to ${preloadAddress}`)
            await (await this.contracts.DATA.mint(preloadAddress, preloadAmount)).wait()
        }
    }
}
