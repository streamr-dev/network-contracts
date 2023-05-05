import { expect } from "chai"
import { ethers as hardhatEthers } from "hardhat"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deployOperatorContract } from "./deployOperatorContract"
import { Wallet } from "ethers"

const { getSigners } = hardhatEthers

describe("OperatorFactory", function(): void {
    let deployer: Wallet        // deploys all test contracts
    let operatorWallet: Wallet  // creates Operator contract

    // many tests don't need their own clean set of contracts that take time to deploy
    let sharedContracts: TestContracts

    before(async (): Promise<void> => {
        [deployer, operatorWallet] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(deployer)
    })

    it("does NOT allow same operator signer deploy a second Operator contract", async function(): Promise<void> {
        await deployOperatorContract(sharedContracts, operatorWallet)
        await expect(deployOperatorContract(sharedContracts, operatorWallet))
            .to.be.revertedWith("error_operatorAlreadyDeployed")
    })
})
