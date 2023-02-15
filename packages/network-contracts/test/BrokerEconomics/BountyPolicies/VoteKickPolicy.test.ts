import { ethers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, ContractTransaction, Wallet } from "ethers"

import { deployTestContracts, TestContracts, advanceToTimestamp, getBlockTimestamp } from "../deployTestContracts"
import { deployBountyContract } from "../deployBountyContract"

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
        const bounty = await deployBountyContract(contracts, { penaltyPeriodSeconds: 1000 })

        await bounty.sponsor(parseEther("10000"))

        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        await (await bounty.connect(broker).flag(broker2.address)).wait()
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