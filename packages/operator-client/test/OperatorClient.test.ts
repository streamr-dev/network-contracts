import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { AddressZero } from "@ethersproject/constants"
import { OperatorClient } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther } from "@ethersproject/units"
import Debug from "debug"

import type { Operator, SponsorshipFactory, TestToken } from "../../network-contracts/typechain"
import { Contract } from "@ethersproject/contracts"
import { abi as tokenAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/testcontracts/TestToken.sol/TestToken.json"

import { deployOperatorContract } from "./deployOperatorContract"

const log = Debug("streamr:deploy-tatum")
const config = Chains.load()["dev1"]
const operatorPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

describe("OperatorClient", async () => {
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    let operator: Operator
    let sponsorshipFactory: SponsorshipFactory
    let token: TestToken
    let operatorWallet: Wallet

    before(async () => {
        provider = new JsonRpcProvider(chainURL)
        log("Connected to: ", await provider.getNetwork())

        operatorWallet = new Wallet(operatorPrivKey, provider)

        token = new Contract(config.contracts.LINK, tokenAbi, operatorWallet) as unknown as TestToken

        operator = await deployOperatorContract(config, operatorWallet, {}, "TestPool")

        const operatorWalletBalance = await token.balanceOf(operatorWallet.address)
        log(`operatorWalletBalance ${operatorWalletBalance}`)

        // await (await token.mint(operatorWallet.address, parseEther("1000000"))).wait()
        // log(`minted 1000000 tokens to ${operatorWallet.address}`)

    })

    it.skip("deploy new operator, client watches it while staking to sponsorship", async () => {
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
        const newSponsorshipAddress = sponsorshipReceipt.events![0].address
        new OperatorClient(operatorAddress, provider)
        // await (await operator.approve(newSponsorshipAddress, parseEther("1"))).wait()
        const operatorPooltokenBalance = await operator.balanceOf(operatorWallet.address)
        log(`operatorPooltokenBalance ${operatorPooltokenBalance}`)
        await (await token.transferAndCall(operatorAddress, parseEther("1"), operatorWallet.address)).wait()
        const tr = await (await operator.stake(newSponsorshipAddress, parseEther("1"))).wait()
        log(tr)
    })

    it("instantiate operatorclient with preexisting operator", () => {
        const oclient = new OperatorClient(operator.address, provider)
        oclient.on("addStakedStream", (streamid: string, blockNumber: number) => {
            log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
        })
        oclient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
            log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
        })
    })

    it("emits addStakedStream/removeStakedStream only when the first/last Sponsorship for a stream is un/staked to/from", () => {
        // create 2 Sponsorship contracts for the same stream
        // stake, expect addStakedStream
        // stake, expect nothing
        // unstake, expect nothing
        // unstake, expect removeStakedStream
    })
})
