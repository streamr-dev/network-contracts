import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { AddressZero } from "@ethersproject/constants"
import { OperatorClient } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther } from "@ethersproject/units"
import Debug from "debug"

import type { Operator, Sponsorship, SponsorshipFactory, TestToken } from "../../network-contracts/typechain"
import { Contract } from "@ethersproject/contracts"
import { abi as tokenAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/testcontracts/TestToken.sol/TestToken.json"
import { abi as sponsorshipFactoryAbi }
    from "../../network-contracts/artifacts/contracts/OperatorTokenomics/SponsorshipFactory.sol/SponsorshipFactory.json"

import { deployOperatorContract } from "./deployOperatorContract"
import { deploySponsorship } from "./deploySponsorshipContract"

const log = Debug("streamr:deploy-tatum")
const config = Chains.load()["dev1"]
const adminPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"
// const adminPrivKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"

describe("OperatorClient", async () => {
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    let operator: Operator
    let sponsorshipFactory: SponsorshipFactory
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
        await (await token.transfer(operatorWallet.address, parseEther("1000"))).wait()
        await (await adminWallet.sendTransaction({
            to: operatorWallet.address,
            value: parseEther("1")
        })).wait()

        const operatorContract = await deployOperatorContract(config, operatorWallet, {}, "TestPool")
        const operatorClient = new OperatorClient(operatorContract.address, provider)
        let wasCalled = false
        operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
            log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            wasCalled = true
        })
        operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
            log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
        })

        const sponsorshipFactory = new Contract(config.contracts.SponsorshipFactory, 
            sponsorshipFactoryAbi, operatorWallet) as unknown as SponsorshipFactory
        // const sponsorship = await deploySponsorship(config, operatorWallet)
        const sponsorshiptx = await sponsorshipFactory.deploySponsorship(parseEther("60"), 0, 1, "Sponsorship-" + Date.now(), "metadata",
            [
                "0x699B4bE95614f017Bb622e427d3232837Cc814E6", // allocation policy
                AddressZero, // leavepolicy?
                "0x611900fD07BB133016Ed85553aF9586771da5ff9",  // vote kick policy
            ], [
                parseEther("0.01"),
                "0",
                "0"
            ]
        )
        const sponsorshipReceipt = await sponsorshiptx.wait()
        const sponsorshipAddress = sponsorshipReceipt.events?.find((e) => e.event === "NewSponsorship")?.args?.sponsorshipContract
        // const sponsorship = new Contract(sponsorshipAddress, tokenAbi, operatorWallet) as unknown as Sponsorship
        log(`sponsorship deployed at ${sponsorshipAddress}`)
        await (await token.connect(operatorWallet).transferAndCall(sponsorshipAddress, parseEther("60"), operatorWallet.address)).wait()
        log(`transferred 1 token to ${sponsorshipAddress}`)
        // const operatorPooltokenBalance = await operatorContract.balanceOf(adminWallet.address)
        // log(`operatorPooltokenBalance ${operatorPooltokenBalance}`)
        // await (await token.transferAndCall(operatorContract.address, parseEther("1"), adminWallet.address)).wait()
        const tr = await (await operatorContract.stake(sponsorshipAddress, parseEther("60"))).wait()
        log(`stake tx hash ${tr.transactionHash}`)
        while (!wasCalled) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            log("waiting for event")
        }
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
