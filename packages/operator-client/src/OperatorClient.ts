import { Contract } from "@ethersproject/contracts"
import { Provider } from "@ethersproject/providers"
import EventEmitter from "eventemitter3"

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

import { abi as BrokerPoolAbi } from "../../network-contracts/artifacts/contracts/BrokerEconomics/BrokerPool.sol/BrokerPool.json"
import { abi as BountyAbi } from "../../network-contracts/artifacts/contracts/BrokerEconomics/Bounty.sol/Bounty.json"
import type { BrokerPool, Bounty } from "../../network-contracts/typechain"
import type { StakedEvent, UnstakedEvent } from "../../network-contracts/typechain/contracts/BrokerEconomics/BrokerPool"

interface OperatorClientOptions {
    provider?: Provider
    chain?: string
}

export class OperatorClient extends EventEmitter {
    provider: Provider
    address: string
    contract: BrokerPool
    streamIdOfSponsorship: Map<string, string> = new Map()
    sponsorshipCountOfStream: Map<string, number> = new Map()

    constructor(operatorContractAddress: string, options: OperatorClientOptions) {
        if (!options.provider) { throw new Error("must give options.provider!") }
        super()
        this.address = operatorContractAddress
        this.provider = options.provider
        this.contract = new Contract(operatorContractAddress, BrokerPoolAbi, this.provider) as unknown as BrokerPool
        this.provider.on(this.contract.filters.Staked(), async (_, event: StakedEvent) => {
            const sponsorshipAddress = event.args.bounty
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
        options.provider.on(this.contract.filters.Unstaked(), async (_, event: UnstakedEvent) => {
            const sponsorshipAddress = event.args.bounty
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
            }
        })
    }

    async getStreamId(sponsorshipAddress: string): Promise<string> {
        const bounty = new Contract(sponsorshipAddress, BountyAbi, this.contract.provider) as unknown as Bounty
        return bounty.streamId()
    }

    async getStakedStreams(): Promise<string[]> {
        return ["lol"]
    }

    async close(): Promise<void> {
        this.provider.removeAllListeners(this.contract.filters.Staked())
        this.provider.removeAllListeners(this.contract.filters.Unstaked())
    }
}
