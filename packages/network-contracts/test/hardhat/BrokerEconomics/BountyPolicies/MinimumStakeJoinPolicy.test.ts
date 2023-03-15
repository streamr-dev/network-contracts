import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

const { parseEther } = ethersUtils
const { getSigners } = hardhatEthers

import {
    deployTestContracts,
    TestContracts,
} from "../deployTestContracts"

import { deployBounty } from "../deployBounty"

describe("MinimumStakeJoinPolicy", (): void => {
    let admin: Wallet
    let broker: Wallet

    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin, broker] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("10"))).wait()
    })

    it("will NOT let join with too small stake", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBounty(contracts, { minStakeWei: parseEther("2") })
        await expect(token.transferAndCall(bounty.address, parseEther("1"), broker.address))
            .to.be.revertedWith("error_stakeUnderMinimum")
    })
})
