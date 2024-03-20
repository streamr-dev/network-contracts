#!/usr/bin/env npx ts-node

import fetch from "node-fetch"
import { writeFileSync, readFileSync } from "fs"

import { sleepQueue } from "./sleep"

const {
    ETHERSCAN_KEY,
    CACHE_FILE_NAME = "polygonDateToBlockNumberCache.json",
} = process.env

const dateToBlockNumberCache = new Map<number, number>()

function addToCache(date: number, blockNumber: number) {
    if (dateToBlockNumberCache.has(date)) {
        throw new Error("Date already in cache")
    }
    dateToBlockNumberCache.set(date, blockNumber)
    storeCache()
}

export function storeCache(): void {
    writeFileSync(CACHE_FILE_NAME, JSON.stringify(Array.from(dateToBlockNumberCache.entries())))
}

export function loadCache(): void {
    try {
        const rawCache = readFileSync(CACHE_FILE_NAME, "utf-8")
        const entries: [number, number][] = JSON.parse(rawCache)
        entries.forEach(([date, blockNumber]: [number, number]) => {
            dateToBlockNumberCache.set(date, blockNumber)
        })
    } catch (e) {
        console.warn("Failed to load cache", e)
    }
}

export async function dateToBlockNumber(date: number): Promise<number> {
    if (dateToBlockNumberCache.has(date)) {
        return dateToBlockNumberCache.get(date)!
    }

    await sleepQueue(1000) // documented limit: 5 requests per second
    const response = await fetch(
        "https://api.polygonscan.com/api?module=block&action=getblocknobytime&timestamp=" + date.toString() +
        "&closest=before&apikey=" + ETHERSCAN_KEY
    )
    if (!response.ok) {
        throw new Error(`Failed to fetch block number for date ${date}: ${response.status} ${response.statusText}`)
    }

    const json = await response.json()
    if (json.status !== "1") {
        throw new Error(`Failed to fetch block number for date ${date}: ${json.message} / ${json.result}`)
    }

    const blockNumber = parseInt(json.result)
    if (isNaN(blockNumber)) {
        throw new Error(`No block found for date ${date}`)
    }
    addToCache(date, blockNumber)
    return blockNumber
}

if (require.main === module) {
    const { log } = console

    log("Testing dateToBlockNumber 1709766706")
    log("Expecting: 54350644")
    dateToBlockNumber(1709766706)
        .then((blockNumber) => log("Got:       %d", blockNumber))
        .catch(console.error)
}
