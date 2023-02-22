import { ethers as hardhatEthers } from "hardhat"
const { provider: hardhatProvider } = hardhatEthers

export const log = (..._: unknown[]): void => { /* skip logging */ }

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
