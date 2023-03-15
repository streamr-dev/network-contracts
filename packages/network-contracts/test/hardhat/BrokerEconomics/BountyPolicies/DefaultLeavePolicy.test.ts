import { ethers } from "hardhat"
import { expect } from "chai"
import { utils, Wallet } from "ethers"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"
import { deployBountyContract } from "../deployBounty"

const { parseEther, formatEther } = utils

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
        await (await token.transfer(broker.address, parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()
    })

    it("FAILS to deploy if penaltyPeriodSeconds is higher than the global max", async function(): Promise<void> {
        await expect(deployBountyContract(contracts, { minBrokerCount: 2, penaltyPeriodSeconds: 2678000 }))
            .to.be.revertedWith("error_penaltyPeriodTooLong")
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
        expect(!await bounty.isRunning())
        expect(!await bounty.isFunded())

        await bounty.sponsor(parseEther("10000"))
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        const balanceBefore = await token.balanceOf(broker.address)
        const balanceBefore2 = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "broker 1 joins, bounty still not started")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 100, "broker 2 joins, bounty starts")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()
        expect(await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 300, "broker 1 leaves while bounty is running, loses 10% of 1000 = 100")
        await (await bounty.connect(broker).unstake()).wait()
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        await advanceToTimestamp(timeAtStart + 400, "broker 2 leaves when bounty is stopped, keeps stake")
        await (await bounty.connect(broker2).unstake()).wait()
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        const balanceChange = (await token.balanceOf(broker.address)).sub(balanceBefore)
        const balanceChange2 = (await token.balanceOf(broker2.address)).sub(balanceBefore2)

        expect(formatEther(balanceChange)).to.equal("0.0") // loses 10% of 1000 = 100, gets 900 back + 100 earnings = 1000 same as staked
        expect(formatEther(balanceChange2)).to.equal("100.0") // keeps stake, gets 1000 back + 100 earnings = 1100
    })

    it("doesn't penalize a broker that leaves after the leave period (even when contract is running)", async function(): Promise<void> {
        // time:        0 ... 400 ... 1000 ... 1700
        // join/leave: +b1    +b2      -b1      -b2
        // broker1:       400  +  300               =  700
        // broker2:               300  +  700       = 1000
        const { token } = contracts
        const bounty = await deployBountyContract(contracts, { penaltyPeriodSeconds: 1000 })
        expect(!await bounty.isRunning())
        expect(!await bounty.isFunded())

        await bounty.sponsor(parseEther("10000"))
        expect(!await bounty.isRunning())
        expect(await bounty.isFunded())

        const balanceBefore = await token.balanceOf(broker.address)
        const balanceBefore2 = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

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

        const balanceChange = (await token.balanceOf(broker.address)).sub(balanceBefore)
        const balanceChange2 = (await token.balanceOf(broker2.address)).sub(balanceBefore2)

        expect(formatEther(balanceChange)).to.equal("700.0")
        expect(formatEther(balanceChange2)).to.equal("1000.0")
    })
})
