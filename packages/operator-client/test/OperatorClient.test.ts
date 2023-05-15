import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { AddressZero } from "@ethersproject/constants"
import { OperatorClient } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther, formatEther } from "@ethersproject/units"
import Debug from "debug"

import type { Operator, Sponsorship, SponsorshipFactory, TestToken, StreamrConfig } from "../../network-contracts/typechain"
import { Contract } from "@ethersproject/contracts"
import { abi as tokenAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/testcontracts/TestToken.sol/TestToken.json"
import { abi as sponsorshipFactoryAbi }
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/SponsorshipFactory.sol/SponsorshipFactory.json"
import { abi as configAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/StreamrConfig.sol/StreamrConfig.json"

import { abi as sponsorshipAbi }
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/Sponsorship.sol/Sponsorship.json"

import { deployOperatorContract } from "./deployOperatorContract"
import { deploySponsorship } from "./deploySponsorshipContract"

const log = Debug("streamr:deploy-tatum")
const config = Chains.load()["dev1"]
const adminPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"
// const adminPrivKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"

describe("OperatorClient", async () => {
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    // let operator: Operator
    // let sponsorshipFactory: SponsorshipFactory
    let token: TestToken
    let adminWallet: Wallet

    before(async () => {
        provider = new JsonRpcProvider(chainURL)
        log("Connected to: ", await provider.getNetwork())

        adminWallet = new Wallet(adminPrivKey, provider)

        token = new Contract(config.contracts.LINK, tokenAbi, adminWallet) as unknown as TestToken

        // const operatorWalletBalance = await token.balanceOf(adminWallet.address)
        // log(`operatorWalletBalance ${operatorWalletBalance}`)

        // await (await token.mint(operatorWallet.address, parseEther("1000000"))).wait()
        // log(`minted 1000000 tokens to ${operatorWallet.address}`)

    })

    it("deploy new operator, client watches it while staking to sponsorship", async () => {

        const operatorWallet = Wallet.createRandom().connect(provider)
        log("Funding address %s...", operatorWallet.address)
        await (await token.transfer(operatorWallet.address, parseEther("1000"))).wait()
        await (await adminWallet.sendTransaction({
            to: operatorWallet.address,
            value: parseEther("1")
        })).wait()

        log("Deploying operator contract, config: %o", config)
        const operatorContract = await deployOperatorContract(config, operatorWallet)
        const operatorClient = new OperatorClient(operatorContract.address, provider)
        let wasCalled = false
        operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
            log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            wasCalled = true
        })
        operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
            log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
        })

        log("Added OperatorClient listeners, deploying Sponsorship contract...")
        const sponsorshipFactory = new Contract(config.contracts.SponsorshipFactory,
            sponsorshipFactoryAbi, operatorWallet) as unknown as SponsorshipFactory
        const sponsorship = await deploySponsorship(config, operatorWallet)

        log(`Sponsorship deployed at ${sponsorship.address}, delegating...`)
        await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, parseEther("200"), operatorWallet.address)).wait()
        // const operatorPooltokenBalance = await operatorContract.balanceOf(adminWallet.address)
        // log(`operatorPooltokenBalance ${operatorPooltokenBalance}`)
        // await (await token.transferAndCall(operatorContract.address, parseEther("1"), adminWallet.address)).wait()

        const streamrConfigAddress = await operatorContract.streamrConfig()
        const streamrConfig = new Contract(streamrConfigAddress, configAbi, operatorWallet) as unknown as StreamrConfig
        const sponsorshipFactoryAddress = await streamrConfig.sponsorshipFactory()
        log("Factory address from JSON config: %s, from config contract: %s", config.contracts.SponsorshipFactory, sponsorshipFactoryAddress)
        const deploymentTimestamp = await sponsorshipFactory.deploymentTimestamp(sponsorship.address)
        log("Deployment timestamp: %s (%s)", deploymentTimestamp.toString(), new Date(deploymentTimestamp.toNumber() * 1000).toISOString())
        log("Queue is empty: %s", await operatorContract.queueIsEmpty())
        log("Token address from JSON config: %s, from operator contract: %s", token.address, await operatorContract.token())
        log("Token balance: %s", formatEther(await token.balanceOf(operatorContract.address)))

        log("Minimum stake: %s", formatEther(await sponsorship.minimumStakeWei()))
        log("Join policy 0: %s, from config contract: %s", await sponsorship.joinPolicies(0), await streamrConfig.operatorContractOnlyJoinPolicy())
        log("Allocation policy: %s", await sponsorship.allocationPolicy())

        log("Staking to sponsorship...")
        const tr = await (await operatorContract.stake(sponsorship.address, parseEther("150"))).wait()
        log(`stake tx hash ${tr.transactionHash}`)
        while (!wasCalled) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            log("waiting for event")
        }

        operatorClient.close()
    })

    // it("instantiate operatorclient with preexisting operator", () => {
    //     const oclient = new OperatorClient(operator.address, provider)
    //     oclient.on("addStakedStream", (streamid: string, blockNumber: number) => {
    //         log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
    //     })
    //     oclient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
    //         log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
    //     })
    // })

    it("emits addStakedStream/removeStakedStream only when the first/last Sponsorship for a stream is un/staked to/from", () => {
        // create 2 Sponsorship contracts for the same stream
        // stake, expect addStakedStream
        // stake, expect nothing
        // unstake, expect nothing
        // unstake, expect removeStakedStream
    })
})
