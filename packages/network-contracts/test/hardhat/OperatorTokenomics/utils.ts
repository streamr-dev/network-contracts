import { ethers as hardhatEthers } from "hardhat"
const { provider: hardhatProvider } = hardhatEthers
import Debug from "debug"

// export const log = (..._: unknown[]): void => { /* skip logging */ }
export const log = Debug("Streamr::test")
// export const { log } = console // TODO: use pino for logging?

/** Block timestamp, rounded up to nearest million for test log readability */
export async function getBlockTimestamp(): Promise<number> {
    return Math.floor(((await hardhatProvider.getBlock("latest")).timestamp / 1000000) + 1) * 1000000
}

export async function advanceToTimestamp(timestamp: number, message?: string): Promise<void> {
    log("\nt = %s ", timestamp, message ?? "")
    await hardhatProvider.send("evm_setNextBlockTimestamp", [timestamp])
    await hardhatProvider.send("evm_mine", [0])
}

export const VOTE_KICK    = "0x0000000000000000000000000000000000000000000000000000000000000001"
export const VOTE_NO_KICK = "0x0000000000000000000000000000000000000000000000000000000000000000"
export const VOTE_START = 60 * 60 + 10 // 1 hour
export const VOTE_END = VOTE_START + 15 * 60 // +15 minutes
export const END_PROTECTION = VOTE_END + 60 * 60 // +1 hour
