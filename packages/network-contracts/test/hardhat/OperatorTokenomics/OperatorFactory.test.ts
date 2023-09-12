import { expect } from "chai"
import { ethers as hardhatEthers } from "hardhat"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deployOperatorContract } from "./deployOperatorContract"
import { Wallet } from "ethers"
import { defaultAbiCoder, parseEther } from "ethers/lib/utils"

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

    it("can create an Operator with transferAndCall (atomic fund and deploy operator)", async function(): Promise<void> {
        const { operatorFactory, token, defaultDelegationPolicy, defaultPoolYieldPolicy, defaultUndelegationPolicy } = sharedContracts
        const operatorSharePercent = 10
        const operatorsCutFraction = parseEther("1").mul(operatorSharePercent).div(100)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[3]", "uint[3]"],
            [
                operatorsCutFraction,
                "PoolTokenName",
                "{}",
                [
                    defaultDelegationPolicy.address,
                    defaultPoolYieldPolicy.address,
                    defaultUndelegationPolicy.address
                ],
                [
                    0,
                    0,
                    0
                ]
            ]
        )

        const operatorDeployTx = await token.connect(deployer).transferAndCall(operatorFactory.address, parseEther("10"), data)
        const operatorDeployReceipt = await operatorDeployTx.wait()
        const newOperatorAddress = operatorDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        const newOperatorLog = operatorDeployReceipt.logs.find((e) => e.address == operatorFactory.address)
        if (!newOperatorLog) { throw new Error("NewOperator event not found") }  // typescript can't infer not-undefined from expect
        const newOperatorEvent = operatorFactory.interface.parseLog(newOperatorLog)

        expect(newOperatorEvent.name).to.equal("NewOperator")
        expect(newOperatorEvent.args.operatorAddress).to.equal(deployer.address)
        expect(newOperatorEvent.args.operatorContractAddress).to.equal(newOperatorAddress)
    })

    it("transferAndCall revets for missing / incomplete data encoded", async function(): Promise<void> {
        const { operatorFactory, token } = sharedContracts

        // missing encoded data
        await expect(token.connect(deployer).transferAndCall(operatorFactory.address, parseEther("10"), "0x"))
            .to.be.reverted

        // missing encoded policies and policies params
        const operatorSharePercent = 10
        const operatorsCutFraction = parseEther("1").mul(operatorSharePercent).div(100)
        const data = defaultAbiCoder.encode(["uint", "string", "string"],
            [
                operatorsCutFraction,
                "PoolTokenName",
                "{}"
            ]
        )
        await expect(token.connect(deployer).transferAndCall(operatorFactory.address, parseEther("10"), data))
            .to.be.reverted
    })
})
