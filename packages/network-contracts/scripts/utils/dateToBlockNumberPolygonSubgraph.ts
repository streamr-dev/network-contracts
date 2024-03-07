#!/usr/bin/env npx ts-node

import fetch from "node-fetch"

import { Logger, TheGraphClient } from "@streamr/utils"

const dateToBlockNumberCache = new Map<number, number>()

function addToCache(date: number, blockNumber: number) {
    if (dateToBlockNumberCache.has(date)) {
        throw new Error("Date already in cache")
    }
    dateToBlockNumberCache.set(date, blockNumber)
}

export async function dateToBlockNumber(date: number): Promise<number> {
    if (dateToBlockNumberCache.has(date)) {
        return dateToBlockNumberCache.get(date)!
    }
    const client = new TheGraphClient({
        serverUrl: "https://api.thegraph.com/subgraphs/name/matthewlilley/polygon-blocks",
        fetch,
        logger: new Logger(module)
    })

    const { blocks } = await client.queryEntity<any>({ query: `{
        blocks(where: {timestamp: "${date}"}) {
          number
        }
      }`
    })
    if (blocks.length === 0) {
        throw new Error(`No block found for date ${date}`)
    }
    addToCache(date, blocks[0].number)
    return parseInt(blocks[0].number)
}

if (require.main === module) {
    const { log } = console

    log("Testing dateToBlockNumber 1709813612")
    log("Expecting: 54372204")
    dateToBlockNumber(1709813612)
        .then((blockNumber) => log("Got:       %d", blockNumber))
        .catch(console.error)
}
