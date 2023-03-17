import { ethers } from "hardhat"
import { expect } from "chai"
import { utils, Wallet, BigNumberish } from "ethers"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"
import { deployBountyContract } from "../deployBounty"

const { parseEther } = utils

// this disables the "Duplicate definition of Transfer" error message from ethers
// @ts-expect-error should use LogLevel.ERROR
utils.Logger.setLogLevel("ERROR")

describe("DefaultLeavePolicy", (): void => {
    let admin: Wallet
    let broker: Wallet
    let broker2: Wallet

    let contracts: TestContracts
    before(async (): Promise<void> => {
        [admin, broker, broker2] = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
    })

    // burn the balance and (re-)mint
    async function setTokenBalance(contracts: any, wallet: Wallet, amountWei: BigNumberish): Promise<void> {
        const { token } = contracts
        await (await token.connect(wallet).transfer("0x0000000000000000000000000000000000000001", await token.balanceOf(wallet.address))).wait()
        await (await token.mint(wallet.address, amountWei)).wait()
    }

    it("FAILS to deploy if penaltyPeriodSeconds is higher than the global max", async function(): Promise<void> {
        await expect(deployBountyContract(contracts, { minBrokerCount: 2, penaltyPeriodSeconds: 2678000 }))
            .to.be.revertedWith("error_penaltyPeriodTooLong")
    })

    it("deducts penalty from a broker that leaves too early", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts, {
            minHorizonSeconds: 1000,
            penaltyPeriodSeconds: 1000,
            allocationWeiPerSecond: parseEther("0")
        })
        await setTokenBalance(contracts, broker, parseEther("10"))

        // sponsor 1 token to make bounty "running" (don't distribute tokens though, since allocationWeiPerSecond = 0)
        await token.approve(bounty.address, parseEther("1"))
        await bounty.sponsor(parseEther("1"))

        // stake 10 token
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("10"), broker.address)).wait()
        const tokensAfterStaking = await token.balanceOf(broker.address)

        // safety: won't unstake if losing stake
        expect(bounty.connect(broker).unstake())
            .to.be.revertedWith("error_leavePenalty")

        // lose 10% = 1 token because leaving a "running" bounty too early
        await (await bounty.connect(broker).forceUnstake()).wait()
        const tokensAfterLeaving = await token.balanceOf(broker.address)

        expect(tokensAfterStaking).to.equal(parseEther("0"))
        expect(tokensAfterLeaving).to.equal(parseEther("9"))
    })

    it("penalizes only the broker that leaves early while bounty is running", async function(): Promise<void> {
        // time:        0 ... 100 ... 300 ... 400
        // join/leave: +b1    +b2     -b1     -b2
        // earnings b1: 0       0     100
        // earnings b2:         0     100       0
        const { token } = contracts
        const bounty = await deployBountyContract(contracts, {
            minBrokerCount: 2,
            penaltyPeriodSeconds: 1000
        })
        await setTokenBalance(contracts, broker, parseEther("1000"))
        await setTokenBalance(contracts, broker2, parseEther("1000"))
        const timeAtStart = await getBlockTimestamp()

        expect(!await bounty.isRunning())
        expect(!await bounty.isFunded())
        await bounty.sponsor(parseEther("10000"))
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart, "broker 1 joins, bounty still not started")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 100, "broker 2 joins, bounty starts")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()
        expect(await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 200, "broker 1 tries to unstake too early, fails")
        expect(bounty.connect(broker).unstake())
            .to.be.revertedWith("error_leavePenalty")

        // TODO: for some reason advanceToTimestamp goes to 300 when I set 299?! So next tx is at 301, which would be correct
        await advanceToTimestamp(timeAtStart + 299, "broker 1 forceUnstakes while bounty is running, loses 10% of 1000 = 100")
        await (await bounty.connect(broker).forceUnstake()).wait()
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 400, "broker 2 leaves when bounty is stopped, keeps stake")
        await (await bounty.connect(broker2).unstake()).wait()
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        // broker loses 10% of 1000 = 100, gets 900 back + 100 earnings = 1000 same as staked
        expect(await token.balanceOf(broker.address)).to.equal(parseEther("1000"))
        // broker2 keeps stake, gets 1000 back + 100 earnings = 1100
        expect(await token.balanceOf(broker2.address)).to.equal(parseEther("1100"))
    })

    it("doesn't penalize a broker that leaves after the leave period (even when contract is running)", async function(): Promise<void> {
        // time:        0 ... 400 ... 1000 ... 1700
        // join/leave: +b1    +b2      -b1      -b2
        // broker1:       400  +  300               =  700
        // broker2:               300  +  700       = 1000
        const { token } = contracts
        const bounty = await deployBountyContract(contracts, { penaltyPeriodSeconds: 1000 })
        await setTokenBalance(contracts, broker, parseEther("1000"))
        await setTokenBalance(contracts, broker2, parseEther("1000"))
        const timeAtStart = await getBlockTimestamp()

        expect(!await bounty.isRunning())
        expect(!await bounty.isFunded())
        await bounty.sponsor(parseEther("10000"))
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart)
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        expect(await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 400)
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()
        expect(await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 1000)
        await (await bounty.connect(broker).unstake()).wait()
        expect(await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 1700)
        await (await bounty.connect(broker2).unstake()).wait()
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        // both get 1000 back + earnings
        expect(await token.balanceOf(broker.address)).to.equal(parseEther("1700"))
        expect(await token.balanceOf(broker2.address)).to.equal(parseEther("2000"))
    })
})
