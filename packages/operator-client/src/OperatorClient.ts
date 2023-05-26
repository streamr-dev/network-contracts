import { Contract } from "@ethersproject/contracts"
import { Provider } from "@ethersproject/providers"
import { operatorABI, sponsorshipABI } from "@streamr/network-contracts"
import type { Operator, Sponsorship } from "@streamr/network-contracts"
import { EventEmitter } from "eventemitter3"
import { GraphQLClient } from "./TheGraphClient"
import Debug from "debug"
import { Logger } from "@streamr/utils"

const log = Debug("streamr:operator-client")

/**
 * Events emitted by {@link OperatorClient}.
*/
export interface OperatorClientEvents {
    /**
     * Emitted if an error occurred in the subscription.
     */
    error: (err: Error) => void

    /**
     * Emitted when staking into a Sponsorship on a stream that we haven't staked on before (in another Sponsorship)
     */
    addStakedStream: (streamId: string, blockNumber: number) => void

    /**
     * Emitted when a unstaked from ALL Sponsorships for the given stream
     */
    removeStakedStream: (streamId: string, blockNumber: number) => void
}

// interface OperatorClientOptions {
//     provider?: Provider
//     chain?: string
// }

export class OperatorClient extends EventEmitter {
    provider: Provider
    address: string
    contract: Operator
    streamIdOfSponsorship: Map<string, string> = new Map()
    sponsorshipCountOfStream: Map<string, number> = new Map()
    theGraphClient: GraphQLClient
    private readonly logger: Logger

    constructor(operatorContractAddress: string, provider: Provider, logger: Logger) {
        super()

        this.logger = logger
        this.logger.trace('OperatorClient created')
        this.theGraphClient = new GraphQLClient(logger)
        this.address = operatorContractAddress
        this.provider = provider
        this.contract = new Contract(operatorContractAddress, operatorABI, this.provider) as unknown as Operator
        log(`OperatorClient created for ${operatorContractAddress}`)
        log("getting all streams from TheGraph")
        // this.getStakedStreams()
        log("Subscribing to Staked and Unstaked events")
        this.contract.on("Staked", async (sponsorship: string) => {
            log(`got Staked event ${sponsorship}`)
            const sponsorshipAddress = sponsorship
            const streamId = await this.getStreamId(sponsorshipAddress)
            if (this.streamIdOfSponsorship.has(sponsorshipAddress)) {
                console.info(`Sponsorship ${sponsorship} already staked into, ignoring`)
                return
            }
            this.streamIdOfSponsorship.set(sponsorshipAddress, streamId)

            const sponsorshipCount = (this.sponsorshipCountOfStream.get(streamId) || 0) + 1
            this.sponsorshipCountOfStream.set(streamId, sponsorshipCount)
            if (sponsorshipCount === 1) {
                this.emit("addStakedStream", streamId, await this.contract.provider.getBlockNumber())
            }
        })
        this.contract.on("Unstaked", async (sponsorship: string) => {
            log(`got Unstaked event ${sponsorship}`)
            const sponsorshipAddress = sponsorship.toLowerCase()
            const streamId = this.streamIdOfSponsorship.get(sponsorshipAddress)
            if (!streamId) {
                logger.error("Sponsorship not found!")
                return
            }
            this.streamIdOfSponsorship.delete(sponsorshipAddress)

            const sponsorshipCount = (this.sponsorshipCountOfStream.get(streamId) || 1) - 1
            log(`sponsorshipCount for ${streamId} is now ${sponsorshipCount}`)
            this.sponsorshipCountOfStream.set(streamId, sponsorshipCount)
            if (sponsorshipCount === 0) {
                this.sponsorshipCountOfStream.delete(streamId)
                log(`emitting removeStakedStream for ${streamId}`)
                this.emit("removeStakedStream", streamId, await this.contract.provider.getBlockNumber())
            }
        })
    }

    async getStreamId(sponsorshipAddress: string): Promise<string> {
        const bounty = new Contract(sponsorshipAddress, sponsorshipABI, this.contract.provider as Provider) as unknown as Sponsorship
        return bounty.streamId()
    }

    async getStakedStreams(): Promise<{ streamIds: string[], blockNumber: number }> {
        log(`getStakedStreams for ${this.address.toLowerCase()}`)
        const queryResult = await this.theGraphClient.sendQuery({
            // query: `
            //     {
            //         operator(id: "${this.address.toLowerCase()}") {
            //             sponsorships {
            //                 id
            //                 streamId
            //             }
            //         }
            //     }
            // `
            query: `
            {
                operator(id: "${this.address.toLowerCase()}") {
                  stakes {
                    sponsorship {
                      id
                      stream {
                        id
                      }
                    }
                 }
                }
                _meta {
                    block {
                    number
                    }
                }
              }
            `
        })
        if (!queryResult.operator) {
            this.logger.error(`Operator ${this.address.toLowerCase()} not found in TheGraph`)
            return {
                streamIds: [],
                // eslint-disable-next-line no-underscore-dangle
                blockNumber: queryResult._meta.block.number
            }
        }
        for (const stake of queryResult.operator.stakes) {
            if (stake.sponsorship.stream && stake.sponsorship.stream.id) {
                const streamId = stake.sponsorship.stream.id
                this.streamIdOfSponsorship.set(stake.sponsorship.id, stake.sponsorship.stream.id)
                const sponsorshipCount = (this.sponsorshipCountOfStream.get(streamId) || 0) + 1
                this.sponsorshipCountOfStream.set(streamId, sponsorshipCount)
                log(`added ${stake.sponsorship.id} to stream ${streamId} with sponsorshipCount ${sponsorshipCount}`)
            }
        }
        return {
            streamIds: Array.from(this.sponsorshipCountOfStream.keys()),
            // eslint-disable-next-line no-underscore-dangle
            blockNumber: queryResult._meta.block.number
        }
    }

    close(): void {
        this.provider.removeAllListeners(this.contract.filters.Staked())
        this.provider.removeAllListeners(this.contract.filters.Unstaked())
    }
}
