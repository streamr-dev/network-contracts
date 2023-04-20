import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

const { parseEther } = ethersUtils
const { getSigners, getContractFactory } = hardhatEthers

import {
    deployTestContracts,
    TestContracts,
} from "../deployTestContracts"
import { deployBrokerPool } from "../deployBrokerPool"
import { deployBounty } from "../deployBounty"

describe("BrokerPoolOnlyJoinPolicy", (): void => {
    let admin: Wallet
    let broker: Wallet

    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, broker] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("10"))).wait()
    })

    it("only allows BrokerPools to stake", async function(): Promise<void> {
        const { streamrConfig, token } = contracts
        const bounty = await deployBounty(contracts, { brokerPoolOnly: true })

        await (await token.approve(bounty.address, parseEther("100"))).wait()
        await expect(bounty.stake(broker.address, parseEther("100")))
            .to.be.revertedWith("error_onlyBrokerPools")

        const badPool = await (await (await getContractFactory("BrokerPool", broker)).deploy()).deployed()
        await (await badPool.initialize(token.address, streamrConfig.address, broker.address, ["testpool", "metadata"], "1")).wait()
        await (await token.transferAndCall(badPool.address, parseEther("100"), "0x")).wait()
        await expect(badPool.stake(bounty.address, parseEther("100")))
            .to.be.revertedWith("error_onlyBrokerPools")

        const pool = await deployBrokerPool(contracts, broker)
        await (await token.transferAndCall(pool.address, parseEther("100"), "0x")).wait()
        await expect(pool.stake(bounty.address, parseEther("100")))
            .to.emit(bounty, "BrokerJoined").withArgs(pool.address)
            .to.emit(pool, "Staked")
    })
})
