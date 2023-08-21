import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

const { parseEther } = ethersUtils
const { getSigners } = hardhatEthers

import {
    deployTestContracts,
    TestContracts,
} from "../deployTestContracts"

import { deploySponsorshipWithoutFactory } from "../deploySponsorshipContract"

describe("MaxOperatorsJoinPolicy", (): void => {
    let admin: Wallet
    let operator: Wallet
    let operator2: Wallet

    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, operator, operator2] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000"))).wait()
    })

    it.skip("will NOT let too many operators join", async function(): Promise<void> {
        const { token } = contracts
        const sponsorship = await deploySponsorshipWithoutFactory(contracts, { maxOperatorCount: 1 })
        await expect(token.transferAndCall(sponsorship.address, parseEther("100"), operator.address))
            .to.emit(sponsorship, "OperatorJoined")
        await expect(token.transferAndCall(sponsorship.address, parseEther("100"), operator2.address))
            .to.be.revertedWith("error_tooManyOperators")
    })
})
