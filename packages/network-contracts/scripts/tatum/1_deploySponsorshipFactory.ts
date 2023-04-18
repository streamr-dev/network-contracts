import { JsonRpcProvider } from "@ethersproject/providers"
import { Wallet } from "ethers"
import { Chains } from "@streamr/config"
import hhat from "hardhat"
import { Sponsorship, SponsorshipFactory, IAllocationPolicy, IJoinPolicy, IKickPolicy, ILeavePolicy, StreamrConfig, TestToken } from "../../typechain"
import * as fs from "fs"
// import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

// import { SponsorshipFactory } from '../../typechain/SponsorshipFactory'
const config = Chains.load()["dev1"]

const { ethers, upgrades } = hhat

const chainURL = config.rpcEndpoints[0].url
const privKeyStreamRegistry = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

let adminWallet: Wallet
let brokerWallet: Wallet

const localConfig: any = {}

async function deploySponsorshipFactory() {
    log((await ethers.getSigners())[0].address)
    const streamrConfigFactory = await ethers.getContractFactory("StreamrConfig", { signer: adminWallet })
    const streamrConfigFactoryTx = await upgrades.deployProxy(streamrConfigFactory, [], { kind: "uups" })
    const streamrConfig = await streamrConfigFactoryTx.deployed() as StreamrConfig
    const hasroleEthSigner = await streamrConfig.hasRole(await streamrConfig.DEFAULT_ADMIN_ROLE(), adminWallet.address)
    log(`hasrole ${hasroleEthSigner}`)
    localConfig.streamrConfig = streamrConfig.address
    log(`streamrConfig address ${streamrConfig.address}`)

    const token = await (await ethers.getContractFactory("TestToken", { signer: adminWallet })).deploy("Test token", "TEST") as TestToken
    await token.deployed()
    localConfig.token = token.address
    log(`token address ${token.address}`)

    const maxBrokersJoinPolicy = await (await ethers.getContractFactory("MaxAmountBrokersJoinPolicy",
        { signer: adminWallet })).deploy() as IJoinPolicy
    await maxBrokersJoinPolicy.deployed()
    localConfig.maxBrokersJoinPolicy = maxBrokersJoinPolicy.address
    log(`maxBrokersJoinPolicy address ${maxBrokersJoinPolicy.address}`)

    const allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy",
        { signer: adminWallet })).deploy() as IAllocationPolicy
    await allocationPolicy.deployed()
    localConfig.allocationPolicy = allocationPolicy.address
    log(`allocationPolicy address ${allocationPolicy.address}`)

    const leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy",
        { signer: adminWallet })).deploy() as ILeavePolicy
    await leavePolicy.deployed()
    localConfig.leavePolicy = leavePolicy.address
    log(`leavePolicy address ${leavePolicy.address}`)

    const voteKickPolicy = await (await ethers.getContractFactory("VoteKickPolicy",
        { signer: adminWallet })).deploy() as IKickPolicy
    await voteKickPolicy.deployed()
    localConfig.voteKickPolicy = voteKickPolicy.address
    log(`voteKickPolicy address ${voteKickPolicy.address}`)

    const sponsorshipTemplate = await (await ethers.getContractFactory("Sponsorship")).deploy() as Sponsorship
    await sponsorshipTemplate.deployed()
    localConfig.sponsorshipTemplate = sponsorshipTemplate.address
    log(`sponsorshipTemplate address ${sponsorshipTemplate.address}`)

    const sponsorshipFactoryFactory = await ethers.getContractFactory("SponsorshipFactory", { signer: adminWallet })
    const sponsorshipFactoryFactoryTx = await upgrades.deployProxy(sponsorshipFactoryFactory,
        [ sponsorshipTemplate.address, token.address, streamrConfig.address ], { kind: "uups", unsafeAllow: ["delegatecall"]})
    const sponsorshipFactory = await sponsorshipFactoryFactoryTx.deployed() as SponsorshipFactory
    await (await sponsorshipFactory.addTrustedPolicies([maxBrokersJoinPolicy.address,
        allocationPolicy.address, leavePolicy.address, voteKickPolicy.address])).wait()

    await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
    localConfig.sponsorshipFactory = sponsorshipFactory.address
    log(`sponsorshipFactory address ${sponsorshipFactory.address}`)

    await (await token.mint(adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
    log(`minted 1000000 tokens to ${adminWallet.address}`)
    await (await token.mint(brokerWallet.address, ethers.utils.parseEther("100000"))).wait()
    log(`transferred 100000 tokens to ${brokerWallet.address}`)
    await (await adminWallet.sendTransaction({ to: brokerWallet.address, value: ethers.utils.parseEther("1") })).wait()
    log(`transferred 1 ETH to ${brokerWallet.address}`)
}

async function main() {
    adminWallet = new Wallet(privKeyStreamRegistry, new JsonRpcProvider(chainURL))

    brokerWallet = ethers.Wallet.createRandom().connect(new JsonRpcProvider(chainURL))
    log(`wallet address ${adminWallet.address}`)

    await deploySponsorshipFactory()

    localConfig.adminKey = privKeyStreamRegistry
    const configString = JSON.stringify(localConfig, null, 4)
    fs.writeFileSync("localConfig.json", configString)
    log("wrote localConfig.json")
}

main()
