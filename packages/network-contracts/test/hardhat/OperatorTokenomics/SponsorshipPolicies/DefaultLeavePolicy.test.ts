import { ethers } from "hardhat"
import { expect } from "chai"
import { utils, Wallet, BigNumberish } from "ethers"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"
import { deploySponsorshipWithoutFactory } from "../deploySponsorshipContract"

const { parseEther, formatEther } = utils

// this disables the "Duplicate definition of Transfer" error message from ethers
// @ts-expect-error should use LogLevel.ERROR
utils.Logger.setLogLevel("ERROR")

describe("DefaultLeavePolicy", (): void => {
    let admin: Wallet
    let operator: Wallet
    let operator2: Wallet

    let contracts: TestContracts
    before(async (): Promise<void> => {
        [admin, operator, operator2] = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()

        // revert to initial test values (using the real values would break the majority of tests)
        const { streamrConfig } = contracts
        await( await streamrConfig.setFlagReviewerRewardWei(parseEther("1"))).wait()
        await( await streamrConfig.setFlaggerRewardWei(parseEther("1"))).wait()
    })

    // burn the balance and (re-)mint
    async function setTokenBalance(contracts: any, wallet: Wallet, amountWei: BigNumberish): Promise<void> {
        const { token } = contracts
        await (await token.connect(wallet).transfer("0x0000000000000000000000000000000000000001", await token.balanceOf(wallet.address))).wait()
        await (await token.mint(wallet.address, amountWei)).wait()
    }

    it("FAILS to deploy if penaltyPeriodSeconds is higher than the global max", async function(): Promise<void> {
        await expect(deploySponsorshipWithoutFactory(contracts, { minOperatorCount: 2, penaltyPeriodSeconds: 2678000 }))
            .to.be.revertedWith("error_penaltyPeriodTooLong")
    })

    it("deducts penalty from an operator that leaves too early", async function(): Promise<void> {
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {
            minHorizonSeconds: 1000,
            penaltyPeriodSeconds: 1000,
            allocationWeiPerSecond: parseEther("0")
        })
        await setTokenBalance(contracts, operator, parseEther("100"))

        // sponsor 1 DATA to make sponsorship "running" (don't distribute tokens though, since allocationWeiPerSecond = 0)
        await token.approve(sponsorship.address, parseEther("1"))
        await sponsorship.sponsor(parseEther("1"))

        // stake 100 DATA
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("100"), operator.address)).wait()
        const tokensAfterStaking = await token.balanceOf(operator.address)

        // safety: won't unstake if losing stake
        expect(sponsorship.connect(operator).unstake())
            .to.be.revertedWith("error_leavePenalty")

        // lose slashingFraction = 10 DATA because leaving a "running" sponsorship too early
        await (await sponsorship.connect(operator).forceUnstake()).wait()
        const tokensAfterLeaving = await token.balanceOf(operator.address)

        expect(tokensAfterStaking).to.equal(0)
        expect(formatEther(tokensAfterLeaving)).to.equal("90.0")
    })

    it("penalizes only the operator that leaves early while sponsorship is running", async function(): Promise<void> {
        // time:        0 ... 100 ... 300 ... 400
        // join/leave: +b1    +b2     -b1     -b2
        // earnings b1: 0       0     100
        // earnings b2:         0     100       0
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, {
            minOperatorCount: 2,
            penaltyPeriodSeconds: 1000
        })
        await setTokenBalance(contracts, operator, parseEther("1000"))
        await setTokenBalance(contracts, operator2, parseEther("1000"))
        const timeAtStart = await getBlockTimestamp()

        expect(!await sponsorship.isRunning())
        expect(!await sponsorship.isFunded())
        await sponsorship.sponsor(parseEther("10000"))
        expect(!await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart, "operator 1 joins, sponsorship still not started")
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()
        expect(!await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart + 100, "operator 2 joins, sponsorship starts")
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("1000"), operator2.address)).wait()
        expect(await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart + 200, "operator 1 tries to unstake too early, fails")
        expect(sponsorship.connect(operator).unstake())
            .to.be.revertedWith("error_leavePenalty")

        // TODO: for some reason advanceToTimestamp goes to 300 when I set 299?! So next tx is at 301, which would be correct
        await advanceToTimestamp(timeAtStart + 299, "operator 1 forceUnstakes while sponsorship is running, loses slashingFraction * 1000 = 100")
        await (await sponsorship.connect(operator).forceUnstake()).wait()
        expect(!await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart + 400, "operator 2 leaves when sponsorship is stopped, keeps stake")
        await (await sponsorship.connect(operator2).unstake()).wait()
        expect(!await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        // operator loses slashingFraction * 1000 = 100, gets 900 back + 100 earnings = 1000 same as staked
        expect(await token.balanceOf(operator.address)).to.equal(parseEther("1000"))
        // operator2 keeps stake, gets 1000 back + 100 earnings = 1100
        expect(await token.balanceOf(operator2.address)).to.equal(parseEther("1100"))
    })

    it("doesn't penalize an operator that leaves after the leave period (even when contract is running)", async function(): Promise<void> {
        // time:        0 ... 400 ... 1000 ... 1700
        // join/leave: +b1    +b2      -b1      -b2
        // operator1:       400  +  300               =  700
        // operator2:               300  +  700       = 1000
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, { penaltyPeriodSeconds: 1000 })
        await setTokenBalance(contracts, operator, parseEther("1000"))
        await setTokenBalance(contracts, operator2, parseEther("1000"))
        const timeAtStart = await getBlockTimestamp()

        expect(!await sponsorship.isRunning())
        expect(!await sponsorship.isFunded())
        await sponsorship.sponsor(parseEther("10000"))
        expect(!await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart)
        await (await token.connect(operator).transferAndCall(sponsorship.address, parseEther("1000"), operator.address)).wait()
        expect(await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart + 400)
        await (await token.connect(operator2).transferAndCall(sponsorship.address, parseEther("1000"), operator2.address)).wait()
        expect(await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart + 1000)
        await (await sponsorship.connect(operator).unstake()).wait()
        expect(await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        await advanceToTimestamp(timeAtStart + 1700)
        await (await sponsorship.connect(operator2).unstake()).wait()
        expect(!await sponsorship.isRunning())
        expect(await sponsorship.isFunded())

        // both get 1000 back + earnings
        expect(await token.balanceOf(operator.address)).to.equal(parseEther("1700"))
        expect(await token.balanceOf(operator2.address)).to.equal(parseEther("2000"))
    })
})
