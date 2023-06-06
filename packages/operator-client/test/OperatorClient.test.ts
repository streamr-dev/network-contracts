import { JsonRpcProvider, Provider } from "@ethersproject/providers"
import { OperatorClient, OperatorClientConfig } from "../src/OperatorClient"
import { Chains } from "@streamr/config"
import { Wallet } from "@ethersproject/wallet"
import { parseEther } from "@ethersproject/units"
import { expect } from "chai"
import { Logger, waitForCondition } from '@streamr/utils'
import fetch from "node-fetch"

import Debug from "debug"

import type { IERC677, Operator } from "@streamr/network-contracts"
import type { StreamRegistry } from "@streamr/network-contracts"

import { tokenABI } from "@streamr/network-contracts"
import { streamRegistryABI } from "@streamr/network-contracts"
import { Contract } from "@ethersproject/contracts"

import { deployOperatorContract } from "./deployOperatorContract"
import { deploySponsorship } from "./deploySponsorshipContract"

const log = Debug("streamr:operator-client-test")
const config = Chains.load()["dev1"]
const adminPrivKey = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"
const theGraphUrl = "http://localhost:8000/subgraphs/name/streamr-dev/network-subgraphs"

const logger = new Logger(module)

describe("OperatorClient", () => {
    const chainURL = config.rpcEndpoints[0].url

    let provider: Provider
    // let operatorWallet: Wallet
    // let operatorContract: Operator
    let token: IERC677
    let adminWallet: Wallet
    let streamId1: string
    let streamId2: string

    // let opertatorConfig: OperatorClientConfig

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
        const operatorConfig = {
            operatorContractAddress: operatorContract.address,
            provider,
            theGraphUrl,
            fetch,
            signer: operatorWallet
        }
        return {operatorWallet, operatorContract, operatorConfig}
    }

    before(async () => {
        provider = new JsonRpcProvider(chainURL)
        log("Connected to: ", await provider.getNetwork())

        adminWallet = new Wallet(adminPrivKey, provider)

        token = new Contract(config.contracts.LINK, tokenABI, adminWallet) as unknown as IERC677
        const timeString = (new Date()).getTime().toString()
        const streamPath1 = "/operatorclienttest-1-" + timeString
        const streamPath2 = "/operatorclienttest-2-" + timeString
        streamId1 = adminWallet.address.toLowerCase() + streamPath1
        streamId2 = adminWallet.address.toLowerCase() + streamPath2
        const streamRegistry = new Contract(config.contracts.StreamRegistry, streamRegistryABI, adminWallet) as unknown as StreamRegistry
        log(`creating stream with streamId1 ${streamId1}`)
        await (await streamRegistry.createStream(streamPath1, "metadata")).wait()
        log(`creating stream with streamId2 ${streamId2}`)
        await (await streamRegistry.createStream(streamPath2, "metadata")).wait()

        // const operatorWalletBalance = await token.balanceOf(adminWallet.address)
        // log(`operatorWalletBalance ${operatorWalletBalance}`)

        // await (await token.mint(operatorWallet.address, parseEther("1000000"))).wait()
        // log(`minted 1000000 tokens to ${operatorWallet.address}`)

        // })
    
        // beforeEach(async () => {
        // ({ operatorWallet, operatorContract } = await deployNewOperator())
    })

    describe("maintain topology service normal wolkflow", () => {
        let operatorWallet: Wallet
        let operatorContract: Operator
        let operatorConfig: OperatorClientConfig
        beforeEach(async () => {
            ({ operatorWallet, operatorContract, operatorConfig } = await deployNewOperator())
        })
        afterEach(async () => {
            // TODO: call operatorClient.close() instead
            await operatorContract.provider.removeAllListeners()
        })

        it("client catches onchain events and emits join event only once...", async () => {
            // ... when staking to two different sponsorships that sponsor the same stream

            const operatorClient = new OperatorClient(operatorConfig, logger)
            await operatorClient.start()
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

            operatorClient.stop()
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
            await new Promise((resolve) => setTimeout(resolve, 5000))
            const operatorClient = new OperatorClient(operatorConfig, logger)

            await operatorClient.start()
            const streams = await operatorClient.getStakedStreams()
            log(`streams: ${JSON.stringify(streams)}`)
            expect(streams.length).to.equal(2)
            expect(streams).to.contain(streamId1)
            expect(streams).to.contain(streamId2)

            operatorClient.stop()
        })

        it("client emits events when sponsorships are unstaked completely", async () => {
            const operatorClient = new OperatorClient(operatorConfig, logger)
            await operatorClient.start()
            let eventcount = 0
            operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
                log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
            })
            operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
                log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
                eventcount += 1
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

            log("Unstaking from sponsorships...")
            await (await operatorContract.unstake(sponsorship.address)).wait()
            log(`unstaked from sponsorship ${sponsorship.address}`)
            await (await operatorContract.unstake(sponsorship2.address)).wait()
            log(`unstaked from sponsorship ${sponsorship2.address}`)
            // await setTimeout(() => {}, 20000) // wait for events to be processed

            await waitForCondition(() => eventcount === 2, 10000, 1000)

            operatorClient.stop()
        })
    })

    describe("maintain topology workflow edge cases", () => {
        let operatorWallet: Wallet
        let operatorContract: Operator
        let operatorConfig: OperatorClientConfig

        beforeEach(async () => {
            ({ operatorWallet, operatorContract, operatorConfig } = await deployNewOperator())
        })
        afterEach(async () => {
            // TODO: call operatorClient.close() instead
            await operatorContract.provider.removeAllListeners()
        })

        it("edge cases, 2 sponsorships for the same stream", async () => {

            let operatorClient = new OperatorClient(operatorConfig, logger)
            await operatorClient.start()
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

            operatorClient.stop()
            await new Promise((resolve) => setTimeout(resolve, 10000)) // wait for events to be processed

            operatorClient = new OperatorClient(operatorConfig, logger)
            operatorClient.on("addStakedStream", (streamid: string, blockNumber: number) => {
                log(`got addStakedStream event for stream ${streamid} at block ${blockNumber}`)
                receivedAddStreams += 1
            })
            operatorClient.on("removeStakedStream", (streamid: string, blockNumber: number) => {
                log(`got removeStakedStream event for stream ${streamid} at block ${blockNumber}`)
                receivedRemoveStreams += 1
            })

            await operatorClient.start()

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
            operatorClient.stop()

        })

        it("only returns the stream from getAllStreams when staked on 2 sponsorships for the stream", async () => {
            const operatorClient = new OperatorClient(operatorConfig, logger)
            await operatorClient.start()
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

            await operatorClient.start()
            const streams = await operatorClient.getStakedStreams()
            log(`streams: ${JSON.stringify(streams)}`)
            expect(streams.length).to.equal(1)
            expect(streams).to.contain(streamId1)
            operatorClient.stop()
        })
    })

    it.only("allows to flag an operator as malicious", async () => {
        const flagger = await deployNewOperator()
        log("deployed flagger contract" + flagger.operatorConfig.operatorContractAddress)
        const target = await deployNewOperator()
        log("deployed target contract" + target.operatorConfig.operatorContractAddress)
        const voter = await deployNewOperator()
        log("deployed voter contract" + voter.operatorConfig.operatorContractAddress)

        await new Promise((resolve) => setTimeout(resolve, 10000)) // wait for events to be processed
        const flaggerOperatorClient = new OperatorClient(flagger.operatorConfig, logger)
        await flaggerOperatorClient.start()

        const targetOperatorClient = new OperatorClient(target.operatorConfig, logger)
        await targetOperatorClient.start()

        const voterOperatorClient = new OperatorClient(voter.operatorConfig, logger)
        await voterOperatorClient.start()
        let receivedReviewRequested = false
        voterOperatorClient.on("onReviewRequest", (targetOperator: string, sponsorship: string) => {
            log(`got onRviewRequested event for targetOperator ${targetOperator} with sponsorship ${sponsorship}`)
            receivedReviewRequested = true
        })
        log("deploying sponsorship contract")
        const sponsorship = await deploySponsorship(config, flagger.operatorWallet , {
            streamId: streamId1 })
        log("sponsoring sponsorship contract")
        await (await token.connect(flagger.operatorWallet).approve(sponsorship.address, parseEther("500"))).wait()
        await (await sponsorship.sponsor(parseEther("500"))).wait()

        log("each operator delegates to its operactor contract")
        await (await token.connect(flagger.operatorWallet).transferAndCall(flagger.operatorContract.address,
            parseEther("200"), flagger.operatorWallet.address)).wait()
        await (await token.connect(target.operatorWallet).transferAndCall(target.operatorContract.address,
            parseEther("200"), target.operatorWallet.address)).wait()
        await (await token.connect(voter.operatorWallet).transferAndCall(voter.operatorContract.address,
            parseEther("200"), voter.operatorWallet.address)).wait()
        
        await new Promise((resolve) => setTimeout(resolve, 3000))

        log("staking to sponsorship contract from flagger and target and voter")
        log("staking from flagger: ", flagger.operatorContract.address)
        await (await flagger.operatorContract.stake(sponsorship.address, parseEther("200"))).wait()
        log("staking from target: ", target.operatorContract.address)
        await (await target.operatorContract.stake(sponsorship.address, parseEther("200"))).wait()
        log("staking from voter: ", voter.operatorContract.address)
        await (await voter.operatorContract.stake(sponsorship.address, parseEther("200"))).wait()
        
        log("registering node addresses")
        // await (await flagger.operatorContract.setNodeAddresses([await flagger.operatorContract.owner()])).wait()
        await (await flagger.operatorContract.setNodeAddresses([flagger.operatorWallet.address])).wait()

        log("flagging target operator")
        const tr = await (await flagger.operatorContract.flag(sponsorship.address, target.operatorContract.address)).wait()
        await waitForCondition(() => receivedReviewRequested, 100000, 1000)
        
        flaggerOperatorClient.stop()
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
