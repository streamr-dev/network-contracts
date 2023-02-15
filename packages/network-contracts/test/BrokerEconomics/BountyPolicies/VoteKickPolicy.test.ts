import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, ContractTransaction, Wallet } from "ethers"

import { deployTestContracts, TestContracts, advanceToTimestamp, getBlockTimestamp } from "../deployTestContracts"
import { deployBountyContract } from "../deployBountyContract"
import { deployBrokerPool } from "../deployBrokerPool"

const { parseEther, formatEther } = utils

describe.only("VoteKickPolicy", (): void => {
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
        await (await token.transfer(broker.address, parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()
        await (await token.transfer(broker3.address, parseEther("100000"))).wait()
    })

    it("allows to kick a broker by flagging and voting", async function(): Promise<void> {
        const { token } = contracts
        const pool1 = await deployBrokerPool(contracts, broker)
        const pool2 = await deployBrokerPool(contracts, broker2)
        const pool3 = await deployBrokerPool(contracts, broker3)
        await (await token.connect(broker).transferAndCall(pool1.address, parseEther("1000"), "0x")).wait()
        await (await token.connect(broker2).transferAndCall(pool2.address, parseEther("1000"), "0x")).wait()
        const bounty = await deployBountyContract(contracts, { penaltyPeriodSeconds: 1000, brokerPoolOnly: true })
        await bounty.sponsor(parseEther("10000"))
        await pool1.stake(bounty.address, parseEther("1000"))
        await pool2.stake(bounty.address, parseEther("1000"))

        const flagReceipt = await (await bounty.connect(broker).flag(pool2.address, pool1.address)).wait()
        // flagReceipt.events.filter((e) => e.event === "ReviewRequest")

        const event = flagReceipt.events.find((e) => e.event === "ReviewRequest")
        expect(event.args?.bounty).to.equal(bounty.address)
        expect(event.args?.target).to.equal(pool2.address)
        expect(event.args?.reviewer).to.equal(broker3.address)
    })

    it("does NOT allow to flag with a too small flagstakes", async function(): Promise<void> {
        // TODO
    })

    it("allowes to cancel a flag", async function(): Promise<void> {
        // TODO
    })

    it("does NOT allow to flag a broker that is not participating in the bounty", async function(): Promise<void> {
        // TODO
    })
    
    it("does NOT allow to flag a broker that is already flagged", async function(): Promise<void> {
        // TODO
    })

    it("does NOT allow to flag a broker that is not in the bounty", async function(): Promise<void> {
        // TODO
    })

})