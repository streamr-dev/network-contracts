#!/usr/bin/env npx ts-node

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

let sleepQueueHead: Promise<void> = Promise.resolve()
/**
 * Rate-limited mutex: sleep given ms AFTER the latest queued sleep finishes
 * Useful for API call rate-limiting
 */
export function sleepQueue(ms: number): Promise<void> {
    sleepQueueHead = sleepQueueHead.then(() => new Promise((resolve) => {
        setTimeout(resolve, ms)
    }))
    return sleepQueueHead
}

if (require.main === module) {
    const { log } = console

    log("Testing sleepQueue 1/sec")
    const jobs = ["1", "2", "3", "4", "5"]
    void Promise.all(jobs.map(async (x) => {
        log("Job %s queued (t=%s)", x, Date.now())
        await sleepQueue(1000)
        log("Job %s done (t=%s)", x, Date.now())
    })).then(() => log("Done"))
}
