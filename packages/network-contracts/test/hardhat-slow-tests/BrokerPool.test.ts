import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, Wallet } from "ethers"

import {
    deployTestContracts,
    TestContracts,
} from "../hardhat/BrokerEconomics/deployTestContracts"
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

    before(async (): Promise<void> => {
        [admin, broker, delegator, sponsor] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(admin)
    })

    it("edge case many queue entries, one bounty, batched", async function(): Promise<void> {
        const { token } = sharedContracts
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(delegator.address, parseEther("1000"))).wait()
        await (await token.mint(admin.address, parseEther("100000"))).wait()
        await (await token.mint(sponsor.address, parseEther("100000"))).wait()

        const bounty = await deployBounty(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
        const pool = await deployBrokerPool(sharedContracts, broker)
        const balanceBefore = await token.balanceOf(delegator.address)
        await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        // await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        // queue payout
        const numberOfQueueSlots = 1000
        for (let i = 0; i < numberOfQueueSlots; i++) {
            await pool.connect(delegator).queueDataPayout(parseEther("1"))
        }
        const queuedPayout = await pool.connect(delegator).getMyQueuedPayoutPoolTokens()
        expect(queuedPayout).to.equal(parseEther(numberOfQueueSlots.toString()))

        // await advanceToTimestamp(timeAtStart + 1000, "withdraw winnings from bounty")
        // doing it in one go with 1000 slots in the queue will fail, so do it in pieces
        const gasLimit = 0xF42400 // "reasonable gas limit"
        await expect(pool.connect(broker).unstake(bounty.address, 1000, { gasLimit })).to.be.reverted
        await (await pool.connect(broker).unstake(bounty.address, 10, { gasLimit })).wait()
        for (let i = 10; i < numberOfQueueSlots; i += 10) {
            await (await pool.connect(broker).payOutQueueWithFreeFunds(10, { gasLimit })).wait()
        }

        const expectedBalance = balanceBefore.sub(parseEther("1000")).add(parseEther(numberOfQueueSlots.toString()))
        const balanceAfter = await token.balanceOf(delegator.address)
        expect(balanceAfter).to.equal(expectedBalance)
    })

    it("edge case ony queue entry, many bounties", async function(): Promise<void> {
        const { token } = sharedContracts
        const pool = await deployBrokerPool(sharedContracts, broker)
        await (await token.connect(delegator).transfer(admin.address, await token.balanceOf(delegator.address))).wait() // burn all tokens
        await (await token.mint(sponsor.address, parseEther("1000"))).wait()
        await (await token.mint(delegator.address, parseEther("1000"))).wait()

        const numberOfBounties = 1000
        for (let i = 0; i < numberOfBounties; i++) {
            const bounty = await deployBounty(sharedContracts,  { allocationWeiPerSecond: BigNumber.from("0") })
            // const receipt =
            await (await token.connect(delegator).transferAndCall(pool.address, parseEther("1"), "0x")).wait()
            await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1"), "0x")).wait()
            await (await pool.stake(bounty.address, parseEther("1"))).wait()
            // console.log(`Staked ${i} bounties, gas used: ${receipt.gasUsed}`)
        }
        expect(await pool.balanceOf(delegator.address)).to.equal(parseEther(numberOfBounties.toString()))

        // TODO: unstake
    })
})
