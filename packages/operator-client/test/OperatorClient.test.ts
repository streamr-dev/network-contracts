import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { OperatorClient } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther } from "@ethersproject/units"
import { expect } from "chai"
import { Logger, waitForCondition } from '@streamr/utils'

import Debug from "debug"

import type { Operator, StreamRegistryV4, TestToken } from "../../network-contracts/typechain"
import { Contract } from "@ethersproject/contracts"
import { abi as tokenAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/testcontracts/TestToken.sol/TestToken.json"
import { abi as streamregAbi } from "../../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV4.sol/StreamRegistryV4.json"

import { deployOperatorContract } from "./deployOperatorContract"
import { deploySponsorship } from "./deploySponsorshipContract"
import { Sponsorship } from "@streamr/network-contracts"
import { assert } from "console"
import { operatorTokenomics } from "@streamr/network-contracts/typechain/contracts"

const log = Debug("streamr:operator-client-test")
const config = Chains.load()["dev1"]
const adminPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

const logger = new Logger(module)
// const adminPrivKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"

describe("OperatorClient", () => {
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    // let operator: Operator
    // let sponsorshipFactory: SponsorshipFactory
    let token: TestToken
    let adminWallet: Wallet
    let streamId1: string
    let streamId2: string

    beforeAll(async () => {
        provider = new JsonRpcProvider(chainURL)
        log("Connected to: ", await provider.getNetwork())

        adminWallet = new Wallet(adminPrivKey, provider)

        token = new Contract(config.contracts.LINK, tokenAbi, adminWallet) as unknown as TestToken
        const timeString = (new Date()).getTime().toString()
        const streamPath1 = "/operatorclienttest-1-" + timeString
        const streamPath2 = "/operatorclienttest-2-" + timeString
        streamId1 = adminWallet.address.toLowerCase() + streamPath1
        streamId2 = adminWallet.address.toLowerCase() + streamPath2
        const streamRegistry = new Contract(config.contracts.StreamRegistry, streamregAbi, adminWallet) as unknown as StreamRegistryV4
        log(`creating stream with streamId1 ${streamId1}`)
        await (await streamRegistry.createStream(streamPath1, "metadata")).wait()
        log(`creating stream with streamId2 ${streamId2}`)
        await (await streamRegistry.createStream(streamPath2, "metadata")).wait()
        // const operatorWalletBalance = await token.balanceOf(adminWallet.address)
        // log(`operatorWalletBalance ${operatorWalletBalance}`)

        // await (await token.mint(operatorWallet.address, parseEther("1000000"))).wait()
        // log(`minted 1000000 tokens to ${operatorWallet.address}`)

    })

    const deployNewOperator = async () => {
        const operatorWallet = Wallet.createRandom().connect(provider)
        log("Funding address %s...", operatorWallet.address)
        await (await token.transfer(operatorWallet.address, parseEther("1000"))).wait()
        await (await adminWallet.sendTransaction({
            to: operatorWallet.address,
            value: parseEther("1")
        })).wait()

        log("Deploying operator contract")
        const operatorContract = await deployOperatorContract(config, operatorWallet)
        log(`Operator deployed at ${operatorContract.address}`)
        return {operatorWallet, operatorContract}
    }

    describe("normal usecase", () => {
        let operatorWallet: Wallet
        let operatorContract: Operator
        let sponsorship: Sponsorship
        let sponsorship2: Sponsorship

        beforeAll(async () => {
            ({ operatorWallet, operatorContract } = await deployNewOperator())
        })

        it("client catches onchain events and emits join and leave events", async () => {

            const operatorClient = new OperatorClient(operatorContract.address, provider, logger)
            let eventcount = 0
            operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
                log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
                eventcount += 1
            })
            operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
                log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
            })

            log("Added OperatorClient listeners, deploying Sponsorship contract...")
            sponsorship = await deploySponsorship(config, operatorWallet , {
                streamId: streamId1 })
            sponsorship2 = await deploySponsorship(config, operatorWallet, {
                streamId: streamId2
            })

            log(`Sponsorship deployed at ${sponsorship.address}, delegating...`)
            await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, parseEther("200"), operatorWallet.address)).wait()

            log("Staking to sponsorship...")
            await (await operatorContract.stake(sponsorship.address, parseEther("100"))).wait()
            log(`staked on sponsorship ${sponsorship.address}`)
            await (await operatorContract.stake(sponsorship2.address, parseEther("100"))).wait()
            log(`staked on sponsorship ${sponsorship2.address}`)
            // await setTimeout(() => {}, 20000) // wait for events to be processed

            while (eventcount < 2) {
                await new Promise((resolve) => setTimeout(resolve, 1000))
                log("waiting for event")
            }

            operatorClient.close()
        })

        it("client returns all streams from theGraph", async () => {
            // sleep 5 seconds to make sure theGraph has processed the events
            await new Promise((resolve) => setTimeout(resolve, 5000))
            const operatorClient = new OperatorClient(operatorContract.address, provider, logger)

            const streams = await operatorClient.getStakedStreams()
            log(`streams: ${JSON.stringify(streams)}`)
            expect(streams.streamIds.length).to.equal(2)
            expect(streams.streamIds).to.contain(streamId1)
            expect(streams.streamIds).to.contain(streamId2)

            operatorClient.close()
        })

        it("client emits events when sponsorships are unstaked completely", async () => {
            const operatorClient = new OperatorClient(operatorContract.address, provider, logger)
            await operatorClient.getStakedStreams()
            let eventcount = 0
            operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
                log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            })
            operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
                log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
                eventcount += 1
            })

            log("Unstaking from sponsorships...")
            await (await operatorContract.unstake(sponsorship.address)).wait()
            log(`unstaked from sponsorship ${sponsorship.address}`)
            await (await operatorContract.unstake(sponsorship2.address)).wait()
            log(`unstaked from sponsorship ${sponsorship2.address}`)
            // await setTimeout(() => {}, 20000) // wait for events to be processed

            waitForCondition(() => eventcount === 2, 10000, 1000)
            operatorClient.close()
        })
    })

    describe.only("edge cases, 2 sponsorships for the same stream", () => {
        let operatorWallet: Wallet
        let operatorContract: Operator
        let sponsorship: Sponsorship
        let sponsorship2: Sponsorship

        beforeAll(async () => {
            ({ operatorWallet, operatorContract } = await deployNewOperator())
        })

        it("client same stream, that is used in 2 diff sponsorshipts only once", async () => {

            const operatorClient = new OperatorClient(operatorContract.address, provider, logger)
            let numberOfCalls = 0
            operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
                log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
                numberOfCalls += 1
            })
            operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
                log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
            })

            log("Added OperatorClient listeners, deploying Sponsorship contract...")
            sponsorship = await deploySponsorship(config, operatorWallet , {
                streamId: streamId1 })
            sponsorship2 = await deploySponsorship(config, operatorWallet, {
                streamId: streamId1
            })

            log(`Sponsorship deployed at ${sponsorship.address}, delegating...`)
            await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, parseEther("200"), operatorWallet.address)).wait()

            log("Staking to sponsorship...")
            await (await operatorContract.stake(sponsorship.address, parseEther("100"))).wait()
            log(`staked on sponsorship ${sponsorship.address}`)
            await (await operatorContract.stake(sponsorship2.address, parseEther("100"))).wait()
            log(`staked on sponsorship ${sponsorship2.address}`)
            await new Promise((resolve) => setTimeout(resolve, 5000)) // wait for events to be processed
            expect(numberOfCalls).to.equal(1)
        })

        it("also only returns one stream from the getAllStreams call", async () => {

            const operatorClient = new OperatorClient(operatorContract.address, provider, logger)

            const streams = await operatorClient.getStakedStreams()
            log(`streams: ${JSON.stringify(streams)}`)
            expect(streams.streamIds.length).to.equal(1)
            expect(streams.streamIds).to.contain(streamId1)

            operatorClient.close()
        })

        it("client does NOT emit unstake when staked on other sponsorship witht the same stream", async () => {
            const operatorClient = new OperatorClient(operatorContract.address, provider, logger)
            await operatorClient.getStakedStreams()
            let eventcount = 0
            operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
                log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            })
            operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
                log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
                eventcount += 1
            })

            log("Unstaking from sponsorship1...")
            const tr = await (await operatorContract.unstake(sponsorship.address)).wait()
            log(`unstaked from sponsorship1 ${sponsorship.address}`)

            await new Promise((resolve) => setTimeout(resolve, 5000))
            assert(eventcount === 0)
            
            log("Unstaking from sponsorship2...")
            await (await operatorContract.unstake(sponsorship2.address)).wait()
            log(`unstaked from sponsorship2 ${sponsorship2.address}`)
            await waitForCondition(() => eventcount === 1, 10000, 1000)
            assert(eventcount === 1)

            operatorClient.close()
        })

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

    // it("emits addStakedStream/removeStakedStream only when the first/last Sponsorship for a stream is un/staked to/from", () => {
    // create 2 Sponsorship contracts for the same stream
    // stake, expect addStakedStream
    // stake, expect nothing
    // unstake, expect nothing
    // unstake, expect removeStakedStream
    // })
})
