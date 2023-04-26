import { ethers as hardhatEthers } from "hardhat"
import { utils, Wallet } from "ethers"
import { TestToken } from "../../../typechain"

const { provider: hardhatProvider } = hardhatEthers
const { parseEther } = utils

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

export const VOTE_KICK    = "0x0000000000000000000000000000000000000000000000000000000000000001"
export const VOTE_NO_KICK = "0x0000000000000000000000000000000000000000000000000000000000000000"
export const VOTE_START = 24 * 60 * 60 + 10 // 1 day
export const VOTE_END = VOTE_START + 60 * 60 // +1 hour

/** operatorWallet creates Operator contract */
export async function randomOperatorWallet(admin: Wallet, gasFees = "0.1"): Promise<Wallet> {
    const wallet =  hardhatEthers.Wallet.createRandom().connect(hardhatEthers.provider)        
    await admin.sendTransaction({ to: wallet.address, value: parseEther(gasFees) })
    return wallet
}

/** burn all tokens then mint the corrent amount of new ones */
export async function setTokens(account: Wallet, amount: string, token: TestToken): Promise<void> {
    const oldBalance = await token.balanceOf(account.address)
    await (await token.connect(account).transfer("0x1234000000000000000000000000000000000000", oldBalance)).wait()
    if (amount !== "0") {
        await (await token.mint(account.address, parseEther(amount))).wait()
    }
}