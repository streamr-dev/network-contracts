import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { OperatorClient, OperatorClientConfig } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther } from "@ethersproject/units"
import { expect } from "chai"
import { Logger, waitForCondition } from '@streamr/utils'

import Debug from "debug"

import type { Operator, StreamRegistryV4 } from "../../network-contracts/typechain"
import type { IERC677 } from "@streamr/network-contracts"

import { Contract } from "@ethersproject/contracts"
import { abi as tokenAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/testcontracts/TestToken.sol/TestToken.json"
import { abi as streamregAbi } from "../../network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV4.sol/StreamRegistryV4.json"

import { deployOperatorContract } from "./deployOperatorContract"
import { deploySponsorship } from "./deploySponsorshipContract"
// import { Sponsorship } from "@streamr/network-contracts"
// import { operatorTokenomics } from "@streamr/network-contracts/typechain/contracts"

const log = Debug("streamr:operator-client-test")
const config = Chains.load()["dev1"]
const adminPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"
const theGraphUrl = "http://localhost:8000/subgraphs/name/streamr-dev/network-subgraphs"

const logger = new Logger(module)

describe("OperatorClient", () => {
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    let operatorWallet: Wallet
    let operatorContract: Operator
    let token: IERC677
    let adminWallet: Wallet
    let streamId1: string
    let streamId2: string

    let opertatorConfig: OperatorClientConfig

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
        opertatorConfig = {
            operatorContractAddress: operatorContract.address,
            provider,
            theGraphUrl
        }
        return {operatorWallet, operatorContract}
    }

    beforeEach(async () => {
        provider = new JsonRpcProvider(chainURL)
        log("Connected to: ", await provider.getNetwork())

        adminWallet = new Wallet(adminPrivKey, provider)

        token = new Contract(config.contracts.LINK, tokenAbi, adminWallet) as unknown as IERC677
        const timeString = (new Date()).getTime().toString()
        const streamPath1 = "/operatorclienttest-1-" + timeString
        const streamPath2 = "/operatorclienttest-2-" + timeString
        streamId1 = adminWallet.address.toLowerCase() + streamPath1
        streamId2 = adminWallet.address.toLowerCase() + streamPath2
        const streamRegistry = new Contract(config.contracts.StreamRegistry, streamregAbi, adminWallet) as unknown as StreamRegistryV4
        log(`creating stream with streamId1 ${streamId1}`)
        await (await streamRegistry.createStream(streamPath1, "metadata")).wait()
        log(`creating stream with streamId2 ${streamId2}`)
        await (await streamRegistry.createStream(streamPath2, "metadata")).wait();

        // const operatorWalletBalance = await token.balanceOf(adminWallet.address)
        // log(`operatorWalletBalance ${operatorWalletBalance}`)

        // await (await token.mint(operatorWallet.address, parseEther("1000000"))).wait()
        // log(`minted 1000000 tokens to ${operatorWallet.address}`)

        // })
    
        // beforeEach(async () => {
        ({ operatorWallet, operatorContract } = await deployNewOperator())
    })

    afterEach(async () => {
        await operatorContract.provider.removeAllListeners()
    })

    it("client catches onchain events and emits join and leave events", async () => {

        const operatorClient = new OperatorClient(opertatorConfig, logger)
        let eventcount = 0
        operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
            log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            eventcount += 1
        })
        operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
            log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
        })

        log("Added OperatorClient listeners, deploying Sponsorship contract...")
        const sponsorship = await deploySponsorship(config, operatorWallet , {
            streamId: streamId1 })
        const sponsorship2 = await deploySponsorship(config, operatorWallet, {
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
        log("Added OperatorClient listeners, deploying Sponsorship contract...")
        const sponsorship = await deploySponsorship(config, operatorWallet , {
            streamId: streamId1 })
        const sponsorship2 = await deploySponsorship(config, operatorWallet, {
            streamId: streamId2
        })
    
        log(`Sponsorship deployed at ${sponsorship.address}, delegating...`)
        await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, parseEther("200"), operatorWallet.address)).wait()
    
        log("Staking to sponsorship...")
        await (await operatorContract.stake(sponsorship.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship.address}`)
        await (await operatorContract.stake(sponsorship2.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship2.address}`)
        // sleep 5 seconds to make sure theGraph has processed the events
        const operatorClient = new OperatorClient(opertatorConfig, logger)

        const streams = await operatorClient.getStakedStreams()
        log(`streams: ${JSON.stringify(streams)}`)
        expect(streams.streamIds.length).to.equal(2)
        expect(streams.streamIds).to.contain(streamId1)
        expect(streams.streamIds).to.contain(streamId2)

        operatorClient.close()
    })

    it("client emits events when sponsorships are unstaked completely", async () => {
        log("Added OperatorClient listeners, deploying Sponsorship contract...")
        const sponsorship = await deploySponsorship(config, operatorWallet , {
            streamId: streamId1 })
        const sponsorship2 = await deploySponsorship(config, operatorWallet, {
            streamId: streamId2
        })
    
        log(`Sponsorship deployed at ${sponsorship.address}, delegating...`)
        await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, parseEther("200"), operatorWallet.address)).wait()
    
        log("Staking to sponsorship...")
        await (await operatorContract.stake(sponsorship.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship.address}`)
        await (await operatorContract.stake(sponsorship2.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship2.address}`)
        const operatorClient = new OperatorClient(opertatorConfig, logger)
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

        await waitForCondition(() => eventcount === 2, 10000, 1000)

        operatorClient.close()
    })

    it("edge cases, 2 sponsorships for the same stream", async () => {

        let operatorClient = new OperatorClient(opertatorConfig, logger)
        let receivedAddStreams = 0
        let receivedRemoveStreams = 0
        operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
            log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            receivedAddStreams += 1
        })
        operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
            log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
            receivedRemoveStreams += 1
        })

        log("Added OperatorClient listeners, deploying Sponsorship contract...")
        const sponsorship = await deploySponsorship(config, operatorWallet , {
            streamId: streamId1 })
        const sponsorship2 = await deploySponsorship(config, operatorWallet, {
            streamId: streamId1
        })

        log(`Sponsorship deployed at ${sponsorship.address}, delegating...`)
        await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, parseEther("200"), operatorWallet.address)).wait()

        log("Staking to sponsorship 1...")
        await (await operatorContract.stake(sponsorship.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship.address}`)
        await waitForCondition(() => receivedAddStreams === 1, 10000, 1000)
        log("Staking to sponsorship 2...")
        await (await operatorContract.stake(sponsorship2.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship2.address}`)
        // log(`staked on sponsorship ${sponsorship2.address}`)
        // await new Promise((resolve) => setTimeout(resolve, 10000)) // wait for events to be processed
        // expect(receivedAddStreams).to.equal(2)
        await waitForCondition(() => receivedAddStreams === 1, 10000, 1000)

        operatorClient.close()
        await new Promise((resolve) => setTimeout(resolve, 10000)) // wait for events to be processed

        operatorClient = new OperatorClient(opertatorConfig, logger)
        operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
            log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            receivedAddStreams += 1
        })
        operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
            log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
            receivedRemoveStreams += 1
        })

        await operatorClient.getStakedStreams()

        log("Unstaking from sponsorship1...")
        await (await operatorContract.unstake(sponsorship.address)).wait()
        log(`unstaked from sponsorship1 ${sponsorship.address}`)
        // await new Promise((resolve) => setTimeout(resolve, 10000))
        await waitForCondition(() => receivedRemoveStreams === 0, 10000, 1000)
        await (await operatorContract.unstake(sponsorship2.address)).wait()
        // await new Promise((resolve) => setTimeout(resolve, 10000))
        await waitForCondition(() => receivedRemoveStreams === 1, 10000, 1000)

        log("receivedRemoveStreams: ", receivedRemoveStreams)
        expect(receivedRemoveStreams).to.equal(1)
        log("Closing operatorclient...")
        operatorClient.close()

    })

    it("only returns the stream from getAllStreamsw when staked on 2 sponsorships for the stream", async () => {
        const { operatorWallet, operatorContract } = await deployNewOperator()

        const operatorClient = new OperatorClient(opertatorConfig, logger)
        let receivedAddStreams = 0
        operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
            log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            receivedAddStreams += 1
        })
        operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
            log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
        })

        log("Added OperatorClient listeners, deploying Sponsorship contract...")
        const sponsorship = await deploySponsorship(config, operatorWallet , {
            streamId: streamId1 })
        const sponsorship2 = await deploySponsorship(config, operatorWallet, {
            streamId: streamId1
        })

        log(`Sponsorship deployed at ${sponsorship.address}, delegating...`)
        await (await token.connect(operatorWallet).transferAndCall(operatorContract.address, parseEther("200"), operatorWallet.address)).wait()

        log("Staking to sponsorship 1...")
        await (await operatorContract.stake(sponsorship.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship.address}`)
        await waitForCondition(() => receivedAddStreams === 1, 10000, 1000)
        log("Staking to sponsorship 2...")
        await (await operatorContract.stake(sponsorship2.address, parseEther("100"))).wait()
        log(`staked on sponsorship ${sponsorship2.address}`)
        await waitForCondition(() => receivedAddStreams === 1, 10000, 1000)

        const streams = await operatorClient.getStakedStreams()
        log(`streams: ${JSON.stringify(streams)}`)
        expect(streams.streamIds.length).to.equal(1)
        expect(streams.streamIds).to.contain(streamId1)
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

    // it("emits addStakedStream/removeStakedStream only when the first/last Sponsorship for a stream is un/staked to/from", () => {
    // create 2 Sponsorship contracts for the same stream
    // stake, expect addStakedStream
    // stake, expect nothing
    // unstake, expect nothing
    // unstake, expect removeStakedStream
    // })
})
