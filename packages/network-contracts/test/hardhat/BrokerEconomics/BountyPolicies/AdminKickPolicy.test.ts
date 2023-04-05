import { expect } from "chai"
import { ethers } from "hardhat"
import { utils, Wallet } from "ethers"

import { deployTestContracts, TestContracts } from "../deployTestContracts"
import { advanceToTimestamp, getBlockTimestamp } from "../utils"

import { deployBountyWithoutFactory } from "../deployBounty"

const { parseEther, formatEther } = utils

describe("AdminKickPolicy", (): void => {
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

    it("doesn't penalize a kicked broker like it penalizes a leaving broker", async function(): Promise<void> {
        // time:        0 ... 100 ... 200 ... 300
        // join/leave: +b1    +b2   b1 kick  b2 leave
        // broker1:       100  +  50                = 150
        // broker2:               50   +  100       = 150 - penalty 100  = 50
        const { token } = contracts
        await (await token.mint(broker.address, parseEther("1000"))).wait()
        await (await token.mint(broker2.address, parseEther("1000"))).wait()
        const bounty = await deployBountyWithoutFactory(contracts, {
            penaltyPeriodSeconds: 1000,
            adminKickInsteadOfVoteKick: true
        })

        await bounty.sponsor(parseEther("10000"))

        const timeAtStart = await getBlockTimestamp()

        await advanceToTimestamp(timeAtStart, "broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), await broker.getAddress())).wait()

        await advanceToTimestamp(timeAtStart + 100, "broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // event BrokerKicked(address indexed broker, uint slashedWei);
        const brokerCountBeforeKick = await bounty.brokerCount()
        await advanceToTimestamp(timeAtStart + 200, "broker 1 is kicked out")
        expect (await bounty.connect(admin).flag(await broker.getAddress()))
            .to.emit(bounty, "BrokerKicked")
            .withArgs(await broker.getAddress(), "0")
        const brokerCountAfterKick = await bounty.brokerCount()

        await advanceToTimestamp(timeAtStart + 300, "broker 2 leaves and gets slashed")
        await (await bounty.connect(broker2).forceUnstake()).wait()

        expect(brokerCountBeforeKick.toString()).to.equal("2")
        expect(brokerCountAfterKick.toString()).to.equal("1")
        expect(formatEther(await token.balanceOf(broker.address))).to.equal("1150.0")
        expect(formatEther(await token.balanceOf(broker2.address))).to.equal("1050.0")
    })

    it("doesn't allow non-admins to kick", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyWithoutFactory(contracts, { adminKickInsteadOfVoteKick: true })
        await (await token.mint(broker.address, parseEther("1000"))).wait()
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), await broker.getAddress())).wait()

        const brokerCountBeforeReport = await bounty.brokerCount()
        expect(bounty.connect(broker2).flag(await broker.getAddress()))
            .to.emit(bounty, "BrokerKicked")
            .withArgs(await broker.getAddress(), "0")
        const brokerCountAfterReport = await bounty.brokerCount()

        expect(brokerCountBeforeReport.toString()).to.equal("1")
        expect(brokerCountAfterReport.toString()).to.equal("1")
    })
})