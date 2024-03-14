#!/usr/bin/env npx ts-node

// import { Provider } from "@ethersproject/providers"

/** [date, blockNumber] pairs */
type DateToBlockNumber = [number, number]
const dateToBlockNumberCache: DateToBlockNumber[] = []
function findClosestCacheItems(date: number): { index: number, before: DateToBlockNumber, after: DateToBlockNumber } {
    let low = 0
    let high = dateToBlockNumberCache.length - 1
    while (low < high) {
        const mid = Math.floor((low + high) / 2)
        if (dateToBlockNumberCache[mid][0] < date) {
            low = mid + 1
        } else {
            high = mid
        }
    }
    return {
        index: low,
        before: dateToBlockNumberCache[low - 1],
        after: dateToBlockNumberCache[low],
    }
}

function addToCache(date: number, blockNumber: number) {
    const { index, before, after } = findClosestCacheItems(date)
    if (before?.[0] === date || after?.[0] === date) {
        throw new Error("Date already in cache")
    }
    dateToBlockNumberCache.splice(index, 0, [date, blockNumber])
}

/*
export async function dateToBlockNumber(date: number, provider?: Provider): Promise<number> {
    const { before, after } = findClosestCacheItems(date)
    if (before[0] === date) {
        return before[1]
    }
    if (after[0] === date) {
        return after[1]
    }

    // TODO
    // const block = await provider.getBlock(mid)
    return 0
}
*/

if (require.main === module) {
    const { log } = console

    log("Testing dateToBlockNumber")

    const now = Math.floor(Date.now() / 1000)
    log("Empty cache: %o", findClosestCacheItems(now))

    addToCache(now - 1000, 1000)
    log("1 item cache: %o", findClosestCacheItems(now))
    log("1 item cache: %o", findClosestCacheItems(now - 10000))

    addToCache(now - 100, 2000)
    log("2 item cache: %o", findClosestCacheItems(now))
    log("2 item cache: %o", findClosestCacheItems(now - 500))
    log("2 item cache: %o", findClosestCacheItems(now - 1000))
    log("2 item cache: %o", findClosestCacheItems(now - 10000))
}
