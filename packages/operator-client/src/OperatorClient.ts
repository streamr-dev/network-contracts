import { Contract } from "@ethersproject/contracts"
import { Provider } from "@ethersproject/providers"
import { abi as OperatorAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/Operator.sol/Operator.json"
import { abi as SponsorshipAbi } from "../../network-contracts/artifacts/contracts/OperatorTokenomics/Sponsorship.sol/Sponsorship.json"
import type { Operator, Sponsorship } from "../../network-contracts/typechain"
import { StakedEvent, UnstakedEvent } from "../../network-contracts/typechain/contracts/OperatorTokenomics/Operator.sol/Operator"
import { EventEmitter } from "eventemitter3"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const log = require("debug")("streamr:deploy-tatum")

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

    constructor(operatorContractAddress: string, provider: Provider) {
        // if (!options.provider) { throw new Error("must give options.provider!") }
        super()
        this.address = operatorContractAddress
        this.provider = provider
        this.contract = new Contract(operatorContractAddress, OperatorAbi, this.provider) as unknown as Operator
        log(`OperatorClient created for ${operatorContractAddress}`)
        // this.provider.on(this.contract.filters.Staked(), async (event: StakedEvent) => {
        this.contract.on("Staked", async (sponsorship: string) => {
            log(`got Staked event ${sponsorship}`)
            const sponsorshipAddress = sponsorship
            const streamId = await this.getStreamId(sponsorshipAddress)
            if (this.streamIdOfSponsorship.has(sponsorshipAddress)) {
                console.error("Sponsorship already staked into, in my bookkeeping!")
                return
            }
            this.streamIdOfSponsorship.set(sponsorshipAddress, streamId)

            const sponsorshipCount = (this.sponsorshipCountOfStream.get(streamId) || 0) + 1
            this.sponsorshipCountOfStream.set(streamId, sponsorshipCount)
            if (sponsorshipCount === 1) {
                this.emit("addStakedStream", streamId, await this.contract.provider.getBlockNumber())
            }
        })
        // provider.on(this.contract.filters.Unstaked(), async (_, event: UnstakedEvent) => {
        this.contract.on("Unstaked", async (sponsorship: string) => {
            log(`got Unstaked event ${sponsorship}`)
            const sponsorshipAddress = sponsorship
            const streamId = this.streamIdOfSponsorship.get(sponsorshipAddress)
            if (!streamId) {
                console.error("Sponsorship not found!")
                return
            }
            this.streamIdOfSponsorship.delete(sponsorshipAddress)

            const sponsorshipCount = (this.sponsorshipCountOfStream.get(streamId) || 1) - 1
            this.sponsorshipCountOfStream.set(streamId, sponsorshipCount)
            if (sponsorshipCount === 0) {
                this.sponsorshipCountOfStream.delete(streamId)
                this.emit("removeStakedStream", streamId, await this.contract.provider.getBlockNumber())
            }
        })
    }

    async getStreamId(sponsorshipAddress: string): Promise<string> {
        const bounty = new Contract(sponsorshipAddress, SponsorshipAbi, this.contract.provider as Provider) as unknown as Sponsorship
        return bounty.streamId()
    }

    getStakedStreams(): Promise<{ streamIds: Set<StreamID>, blockNumber: number }> {
        return Promise.resolve({
            streamIds: new Set(this.initialState),
            blockNumber: this.initialBlockNumber
        })
    }

    async close(): Promise<void> {
        this.provider.removeAllListeners(this.contract.filters.Staked())
        this.provider.removeAllListeners(this.contract.filters.Unstaked())
    }
}
