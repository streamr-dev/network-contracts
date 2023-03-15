import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

const { parseEther } = ethersUtils
const { getSigners } = hardhatEthers

import {
    deployTestContracts,
    TestContracts,
} from "../deployTestContracts"

import { deployBountyContract } from "../deployBounty"

describe("MaxAmountBrokersJoinPolicy", (): void => {
    let admin: Wallet
    let broker: Wallet
    let broker2: Wallet

    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, broker, broker2] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("10"))).wait()
    })

    it("will NOT let too many brokers join", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBountyContract(contracts, { maxBrokerCount: 1 })
        await expect(token.transferAndCall(bounty.address, parseEther("1"), broker.address))
            .to.emit(bounty, "BrokerJoined")
        await expect(token.transferAndCall(bounty.address, parseEther("1"), broker2.address))
            .to.be.revertedWith("error_tooManyBrokers")
    })
})
