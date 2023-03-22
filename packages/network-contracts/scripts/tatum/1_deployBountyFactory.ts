import { JsonRpcProvider } from "@ethersproject/providers"
import { Wallet } from "ethers"
import { Chains } from "@streamr/config"
import hhat from "hardhat"
import { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, IKickPolicy, ILeavePolicy, StreamrConstants, TestToken } from "../../typechain"
import * as fs from "fs"
// import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

// import { BountyFactory } from '../../typechain/BountyFactory'
const config = Chains.load()["dev1"]

const { ethers, upgrades } = hhat

const chainURL = config.rpcEndpoints[0].url
const privKeyStreamRegistry = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

let adminWallet: Wallet
let brokerWallet: Wallet

const localConfig: any = {}

async function deployBountyFactory() {
    log((await ethers.getSigners())[0].address)
    const streamrConstantsFactory = await ethers.getContractFactory("StreamrConstants", { signer: adminWallet })
    const streamrConstantsFactoryTx = await upgrades.deployProxy(streamrConstantsFactory, [], { kind: "uups" })
    const streamrConstants = await streamrConstantsFactoryTx.deployed() as StreamrConstants
    const hasroleEthSigner = await streamrConstants.hasRole(await streamrConstants.DEFAULT_ADMIN_ROLE(), adminWallet.address)
    log(`hasrole ${hasroleEthSigner}`)
    localConfig.streamrConstants = streamrConstants.address
    log(`streamrConstants address ${streamrConstants.address}`)

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

    const bountyTemplate = await (await ethers.getContractFactory("Bounty")).deploy() as Bounty
    await bountyTemplate.deployed()
    localConfig.bountyTemplate = bountyTemplate.address
    log(`bountyTemplate address ${bountyTemplate.address}`)

    const bountyFactoryFactory = await ethers.getContractFactory("BountyFactory", { signer: adminWallet })
    const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
        [ bountyTemplate.address, token.address, streamrConstants.address ], { kind: "uups" })
    const bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
    await (await bountyFactory.addTrustedPolicies([maxBrokersJoinPolicy.address,
        allocationPolicy.address, leavePolicy.address, voteKickPolicy.address])).wait()

    await (await streamrConstants.setBountyFactory(bountyFactory.address)).wait()
    localConfig.bountyFactory = bountyFactory.address
    log(`bountyFactory address ${bountyFactory.address}`)

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

    await deployBountyFactory()

    localConfig.adminKey = privKeyStreamRegistry
    const configString = JSON.stringify(localConfig, null, 4)
    fs.writeFileSync("localConfig.json", configString)
    log("wrote localConfig.json")
}

main()
