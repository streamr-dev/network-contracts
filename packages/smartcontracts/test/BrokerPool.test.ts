import { ethers, waffle } from "hardhat"
import { expect, use } from "chai"
import { utils } from "ethers"

import {
    deployTestContracts,
    deployBountyContract,
    TestContracts,
    advanceToTimestamp,
    getBlockTimestamp,
    newPoolName
} from "./utils"
import { BrokerPool } from "../typechain"

const { parseEther, formatEther } = utils
use(waffle.solidity)

describe.only("BrokerPool", (): void => {
    const [
        admin,
        broker,
        investor,
        investor2,
        sponsor,
    ] = waffle.provider.getWallets()

    let contracts: TestContracts
    let pool: BrokerPool

    before(async (): Promise<void> => {
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(sponsor.address, parseEther("1000000"))).wait()
        await (await token.mint(investor.address, parseEther("1000000"))).wait()
    })

    beforeEach(async (): Promise<void> => {
        const brokerPoolRc = await (await contracts.poolFactory.deployBrokerPool(0, newPoolName(),
            [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
            [0, 0, 0])).wait()
        const newPoolAddress = brokerPoolRc.events?.filter((e) => e.event === "NewBrokerPool")[0]?.args?.poolAddress
        pool = (await ethers.getContractFactory("BrokerPool")).attach(newPoolAddress) as BrokerPool
    })

    it("positivetest configure joinpolicy", async function(): Promise<void> {
        const brokerPoolRc = await (await contracts.poolFactory.deployBrokerPool(
            0,
            newPoolName(),
            [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
            [0, 0, 0],
        )).wait()
        const newPoolAddress = brokerPoolRc.events?.filter((e) => e.event === "NewBrokerPool")[0]?.args?.poolAddress
        pool = (await ethers.getContractFactory("BrokerPool")).attach(newPoolAddress) as BrokerPool
    })

    it("allows invest and withdraw", async function(): Promise<void> {
        const { token } = contracts
        // const pool = await deployBrokerPool(broker, token)
        await (await token.connect(investor).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(investor).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address) // await pool.unallocatedWei()
        const pooltokensInvestor = await pool.connect(investor).balanceOf(investor.address)

        await expect(pool.connect(investor).withdraw(parseEther("1000")))
            .to.emit(pool, "InvestmentReturned").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterWithdraw = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        expect(formatEther(freeFundsAfterInvest)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterWithdraw)).to.equal("0.0")
    })

    it("allows invest, transfer of poolTokens, and withdraw by 2n party", async function(): Promise<void> {
        const { token } = contracts
        // const pool = await deployBrokerPool(broker, token)
        await (await token.connect(investor).approve(pool.address, parseEther("1000"))).wait()
        await expect(pool.connect(investor).invest(parseEther("1000")))
            .to.emit(pool, "InvestmentReceived").withArgs(investor.address, parseEther("1000"))
        const freeFundsAfterInvest = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        const pooltokensInvestor = await pool.connect(investor).balanceOf(investor.address)

        await (await pool.connect(investor).transfer(investor2.address, parseEther("1000"))).wait()
    
        await expect(pool.connect(investor2).withdraw(parseEther("1000")))
            .to.emit(pool, "InvestmentReturned").withArgs(investor2.address, parseEther("1000"))
        const freeFundsAfterWithdraw = await token.balanceOf(pool.address) // await pool.unallocatedWei()

        expect(formatEther(freeFundsAfterInvest)).to.equal("1000.0")
        expect(formatEther(freeFundsAfterWithdraw)).to.equal("0.0")
    })

    it("stakes, and unstakes with gains", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        // const pool = await deployBrokerPool(broker, token)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const balanceBefore = await token.balanceOf(pool.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "Unstake from bounty")
        await expect(pool.unstake(bounty.address))
            .to.emit(pool, "Unstaked").withArgs(bounty.address, parseEther("1000"), parseEther("1000"))

        const gains = (await token.balanceOf(pool.address)).sub(balanceBefore)
        expect(formatEther(gains)).to.equal("1000.0")
    })

    // https://hackmd.io/QFmCXi8oT_SMeQ111qe6LQ
    it("revenue sharing szenario", async function(): Promise<void> {
        const { token: dataToken } = contracts
        const balanceInvestorBefore = await dataToken.balanceOf(investor.address)
        // 1
        const brokerPoolRc = await (await contracts.poolFactory.deployBrokerPool(0, newPoolName(),
            [contracts.defaultPoolJoinPolicy.address, contracts.defaultPoolYieldPolicy.address, contracts.defaultPoolExitPolicy.address],
            [0, 20, 0])).wait()
        const newPoolAddress = brokerPoolRc.events?.filter((e) => e.event === "NewBrokerPool")[0]?.args?.poolAddress
        pool = (await ethers.getContractFactory("BrokerPool")).attach(newPoolAddress) as BrokerPool

        const bounty = await deployBountyContract(contracts)
        // const pool = await deployBrokerPool(broker, token)
        await (await dataToken.connect(investor).transferAndCall(pool.address, parseEther("5"), "0x")).wait()
        await (await dataToken.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        // 2
        const balanceBefore = await dataToken.balanceOf(pool.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("5")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("5"))
        const allocbefore = (await bounty.getAllocation(pool.address)).toString()
        const a = (await dataToken.balanceOf(pool.address)).toString()
        // 3, 4
        await advanceToTimestamp(timeAtStart + 25, "Unstake from bounty")
        const allocafter = (await bounty.getAllocation(pool.address)).toString()
        const b = (await dataToken.balanceOf(pool.address)).toString()
        await pool.withdrawWinningsFromBounty(bounty.address)
        const c = (await dataToken.balanceOf(pool.address)).toString()
        // pool should have 20 (25- 5 broker fee) tokens
        expect(await dataToken.balanceOf(pool.address)).to.equal(parseEther("20"))
        // delegator should still have 5 pooltokens
        const pooltokensInvestor = await pool.balanceOf(investor.address)
        expect(pooltokensInvestor).to.equal(parseEther("5"))
        
        // 5
        await pool.connect(investor).withdraw(parseEther("5"))
        const balanceInvestorAfter = await dataToken.balanceOf(investor.address)
        // investor has 5 still staked, was able to withdraw 20
        expect(balanceInvestorAfter).to.equal(balanceInvestorBefore.
            add(parseEther("20").sub(parseEther("5"))))
        const investorQueuedPayout = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayout).to.equal(parseEther("5"))
    })

    it("queue payout, increase, decrease, payout all", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        // const pool = await deployBrokerPool(broker, token)
        await (await token.connect(investor).transferAndCall(pool.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(sponsor).transferAndCall(bounty.address, parseEther("1000"), "0x")).wait()

        const balanceBefore = await token.balanceOf(pool.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "Stake to bounty")
        await expect(pool.stake(bounty.address, parseEther("1000")))
            .to.emit(pool, "Staked").withArgs(bounty.address, parseEther("1000"))

        await advanceToTimestamp(timeAtStart + 1000, "Unstake from bounty")
        await expect(pool.unstake(bounty.address))
            .to.emit(pool, "Unstaked").withArgs(bounty.address, parseEther("1000"), parseEther("1000"))

        const gains = (await token.balanceOf(pool.address)).sub(balanceBefore)
        expect(formatEther(gains)).to.equal("1000.0")
        // queue payout
        await pool.connect(investor).queueDataPayout(parseEther("1000"))
        const investorQueuedPayout = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayout).to.equal(parseEther("1000"))
        // increase
        await pool.connect(investor).increaseDataPayout(parseEther("1000"))
        const investorQueuedPayout2 = await pool.connect(investor).getQueuedDataPayout()
        expect(investorQueuedPayout2).to.equal(investorQueuedPayout.add(parseEther("1000")))
        // decrease
        await pool.connect(investor).decreaseDataPayout(parseEther("1000"))
    })
})
