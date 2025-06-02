#!/usr/bin/env npx tsx

import { providers } from "ethers"
import { config } from "@streamr/config"

const {
    CHAIN = "dev2",
} = process.env

const {
    rpcEndpoints: [{ url: rpcUrlFromConfig }],
} = (config as any)[CHAIN]

const { log } = console

export async function logTimestamp(): Promise<void> {
    const provider = new providers.JsonRpcProvider(rpcUrlFromConfig)
    log("Connected to %o", await provider.getNetwork())
    const blockNumber = await provider.getBlockNumber()
    const block = await provider.getBlock(blockNumber)
    log("Timestamp from provider: %s (%s)", block.timestamp, new Date(block.timestamp * 1000).toISOString())
    log("System time: %s (%s)", (Date.now() / 1000).toFixed(0), new Date().toISOString())
    log("Difference: %s seconds", block.timestamp - (Date.now() / 1000))
}
logTimestamp().catch(console.error)
