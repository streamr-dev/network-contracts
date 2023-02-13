import { expect } from "chai"
import { ethers } from "hardhat"
import { utils, Wallet } from "ethers"
// import { StakeWeightedAllocationPolicy } from "../typechain"

import { advanceToTimestamp, getBlockTimestamp, log, deployTestContracts, TestContracts } from "./deployTestContracts"

import { deployBountyContract } from "./deployBountyContract"

const { parseEther, formatEther } = utils

describe("AdminKickPolicy", (): void => {
    let admin: Wallet
    let broker: Wallet
    let broker2: Wallet
    let broker3: Wallet

    let contracts: TestContracts
    before(async (): Promise<void> => {
        [admin, broker, broker2, broker3] = await ethers.getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(await broker.getAddress(), parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()
        await (await token.transfer(broker3.address, parseEther("100000"))).wait()
    })

    it("doesn't penalize a kicked broker like it penalizes a leaving broker", async function(): Promise<void> {
        // time:        0 ... 100 ... 200 ... 300
        // join/leave: +b1    +b2   b1 kick  b2 leave
        // broker1:       100  +  50                = 150 - penalty 1wei = 150 - 1wei
        // broker2:               50   +  100       = 150 - penalty 100  = 50
        const { token } = contracts
        const bounty = await deployBountyContract(contracts, { penaltyPeriodSeconds: 1000 })

        await bounty.sponsor(parseEther("10000"))

        const balanceBefore = await token.balanceOf(await broker.getAddress())
        const balanceBefore2 = await token.balanceOf(broker2.address)
        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), await broker.getAddress())).wait()

        await advanceToTimestamp(timeAtStart + 100, "broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        log("IsAdmin %o", await bounty.isAdmin(admin.address))

        // event BrokerReported(address indexed broker, address indexed reporter);
        // event BrokerKicked(address indexed broker, uint slashedWei);
        const brokerCountBeforeKick = await bounty.getBrokerCount()
        await advanceToTimestamp(timeAtStart + 200, "broker 1 is kicked out")
        expect (await bounty.connect(admin).report(await broker.getAddress()))
            .to.emit(bounty, "BrokerReported")
            .withArgs(await broker.getAddress(), admin.address)
            .and.to.emit(bounty, "BrokerKicked")
            .withArgs(await broker.getAddress(), "1")
        const brokerCountAfterKick = await bounty.getBrokerCount()

        await advanceToTimestamp(timeAtStart + 300, "broker 2 leaves and gets slashed")
        await (await bounty.connect(broker2).leave()).wait()

        const balanceChange = (await token.balanceOf(await broker.getAddress())).sub(balanceBefore)
        const balanceChange2 = (await token.balanceOf(broker2.address)).sub(balanceBefore2)

        expect(brokerCountBeforeKick.toString()).to.equal("2")
        expect(brokerCountAfterKick.toString()).to.equal("1")
        expect(formatEther(balanceChange.add(1))).to.equal("150.0")
        expect(formatEther(balanceChange2)).to.equal("50.0")
    })

    it("doesn't allow non-admins to kick", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts)
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), await broker.getAddress())).wait()

        // event BrokerReported(address indexed broker, address indexed reporter);
        const brokerCountBeforeReport = await bounty.getBrokerCount()
        expect(bounty.connect(broker2).report(await broker.getAddress()))
            .to.emit(bounty, "BrokerReported")
            .withArgs(await broker.getAddress(), broker2.address)
        const brokerCountAfterReport = await bounty.getBrokerCount()

        expect(brokerCountBeforeReport.toString()).to.equal("1")
        expect(brokerCountAfterReport.toString()).to.equal("1")
    })
})