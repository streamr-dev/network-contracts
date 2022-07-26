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
})
