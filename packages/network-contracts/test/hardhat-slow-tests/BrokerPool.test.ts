import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import { advanceToTimestamp, getBlockTimestamp } from "../hardhat/BrokerEconomics/utils"
import { deployTestContracts, TestContracts } from "../hardhat/BrokerEconomics/deployTestContracts"
import { deployBrokerPool } from "../hardhat/BrokerEconomics/deployBrokerPool"

import { deployBounty } from "../hardhat/BrokerEconomics/deployBounty"

const { parseEther } = utils
const { getSigners } = hardhatEthers

describe("BrokerPool", (): void => {
    let admin: Wallet
    let broker: Wallet     // creates pool
    let delegator: Wallet   // delegates money to pool
    let sponsor: Wallet     // sponsors stream bounty

    let sharedContracts: TestContracts

    // burn all tokens then mint the corrent amount of new ones
    async function setTokens(account: Wallet, amount: string) {
        const { token } = sharedContracts
        const oldBalance = await token.balanceOf(account.address)
        await (await token.connect(account).transfer("0x1234000000000000000000000000000000000000", oldBalance)).wait()
        if (amount !== "0") {
            await (await token.mint(account.address, parseEther(amount))).wait()
        }
    }

    before(async (): Promise<void> => {
        [admin, broker, delegator, sponsor] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(admin)
    })

    it("edge case many queue entries, one bounty, batched", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "1000")
        await setTokens(sponsor, "1000")
        const timeAtStart = await getBlockTimestamp()

        const bounty = await deployBounty(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        await advanceToTimestamp(timeAtStart, "Stake to bounty and queue payouts")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        for (let i = 0; i < 1000; i++) {
            await pool.connect(delegator).undelegate(parseEther("1"))
        }
        expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(parseEther("1000"))

        // doing it in one go with 1000 slots in the queue will fail...
        await advanceToTimestamp(timeAtStart + 100000, "Start paying out the queue by unstaking from bounty")
        const gasLimit = 0xF42400 // "reasonable gas limit"
        await expect(pool.connect(broker).unstake(bounty.address, { gasLimit })).to.be.reverted

        // ...so do it in pieces
        await (await pool.connect(broker).unstakeWithoutQueue(bounty.address, { gasLimit })).wait()
        for (let i = 0; i < 1000; i += 10) {
            await (await pool.connect(broker).payOutQueueWithFreeFunds(10, { gasLimit })).wait()
        }

        // got everything back
        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("1000"))
    })

    it("edge case one queue entry, many bounties", async function(): Promise<void> {
        const { token } = sharedContracts
        await setTokens(delegator, "100000")
        await setTokens(sponsor, "100000")
        const pool = await deployBrokerPool(sharedContracts, broker)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounties and queue the payout")
        const numberOfBounties = 1000
        const totalStaked = parseEther("100").mul(numberOfBounties)
        const bounties = []
        for (let i = 0; i < numberOfBounties; i++) {
            const bounty = await deployBounty(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("100"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("100"), "0x")).wait()
            await (await pool.stake(bounty.address, parseEther("100"))).wait()
            bounties.push(bounty)
        }
        await pool.connect(delegator).undelegate(totalStaked)
        expect(await pool.totalQueuedPerDelegatorWei(delegator.address)).to.equal(totalStaked)
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther((numberOfBounties * 100).toString()))

        await advanceToTimestamp(timeAtStart + 100000, "Start paying out the queue by unstaking from bounty")
        for (const bounty of bounties) {
            await (await pool.connect(broker).unstake(bounty.address)).wait()
        }

        // got everything back
        expect(await token.balanceOf(delegator.address)).to.equal(parseEther("100000"))
    })
})
