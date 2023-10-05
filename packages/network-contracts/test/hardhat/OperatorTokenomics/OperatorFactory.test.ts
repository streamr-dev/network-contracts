import { expect } from "chai"
import { ethers as hardhatEthers } from "hardhat"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deployOperatorContract } from "./deployOperatorContract"

import type { Wallet } from "ethers"

const { getSigners } = hardhatEthers
const { defaultAbiCoder, parseEther } = hardhatEthers.utils

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
            .to.be.revertedWithCustomError(sharedContracts.operatorFactory, "OperatorAlreadyDeployed")
    })

    it("can create an Operator with transferAndCall (atomic fund and deploy operator)", async function(): Promise<void> {
        const { operatorFactory, token, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        const operatorSharePercent = 10
        const operatorsCutFraction = parseEther("1").mul(operatorSharePercent).div(100)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[3]", "uint[3]"],
            [
                operatorsCutFraction,
                "OperatorTokenName",
                "{}",
                [
                    defaultDelegationPolicy.address,
                    defaultExchangeRatePolicy.address,
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
                "OperatorTokenName",
                "{}"
            ]
        )
        await expect(token.connect(deployer).transferAndCall(operatorFactory.address, parseEther("10"), data))
            .to.be.reverted
    })

    it("predicts the correct address for a new operator contract", async function(): Promise<void> {
        const contracts = await deployTestContracts(deployer)
        const predictedOperatorAddress = await contracts.operatorFactory.predictAddress("OperatorTokenName")
        const operator = await deployOperatorContract(contracts, deployer, parseEther("0"), {}, "OperatorTokenName")
        expect(predictedOperatorAddress).to.equal(operator.address)
    })

    it("can't deploy an operator having a cut over 100%", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("1.01"), // 101%
            "OperatorTokenName",
            "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        )).to.be.revertedWithCustomError(operatorFactory, "InvalidOperatorsCut")
    })

    it("can remove a trusted policy", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        const randomAddress = await operatorFactory.predictAddress("TokenName" + Date.now())
        await (await operatorFactory.addTrustedPolicy(randomAddress)).wait()

        expect(await operatorFactory.isTrustedPolicy(randomAddress)).to.be.true
        await (await operatorFactory.removeTrustedPolicy(randomAddress)).wait()
        expect(await operatorFactory.isTrustedPolicy(randomAddress)).to.be.false
    })

    it("only the factory can add a trusted policy", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.connect(operatorWallet).addTrustedPolicy(defaultExchangeRatePolicy.address))
            .to.be.rejectedWith("AccessControl: account " + operatorWallet.address.toLowerCase() +
                " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("only the factory can add trusted policies", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.connect(operatorWallet).addTrustedPolicies([defaultExchangeRatePolicy.address]))
            .to.be.rejectedWith("AccessControl: account " + operatorWallet.address.toLowerCase() +
                " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("only the factory can remove a trusted policy", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.connect(operatorWallet).removeTrustedPolicy(defaultExchangeRatePolicy.address))
            .to.be.rejectedWith("AccessControl: account " + operatorWallet.address.toLowerCase() +
                " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("DelegationPolicy can be the zero address", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy, defaultUndelegationPolicy } = await deployTestContracts(deployer)
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "OperatorTokenName",
            "{}",
            [hardhatEthers.constants.AddressZero, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        ))
            .to.emit(operatorFactory, "NewOperator")
    })

    it("ExchangeRatePolicy can NOT be the zero address", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "OperatorTokenName0",
            "{}",
            [defaultDelegationPolicy.address, hardhatEthers.constants.AddressZero, defaultUndelegationPolicy.address],
            [0, 0, 0]
        ))
            .to.be.revertedWithCustomError(operatorFactory, "ExchangeRatePolicyRequired")
    })

    it("UnelegationPolicy can be the zero address", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy } = await deployTestContracts(deployer)
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "OperatorTokenName",
            "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, hardhatEthers.constants.AddressZero],
            [0, 0, 0]
        ))
            .to.emit(operatorFactory, "NewOperator")
    })

    it("reverts if incorrect delegation policy is provided", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "OperatorTokenName1",
            "{}",
            [defaultExchangeRatePolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        ))
            .to.be.revertedWithCustomError(operatorFactory, "NotDelegationPolicy")
    })

    it("reverts if incorrect exchange rate policy is provided", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "OperatorTokenName2",
            "{}",
            [defaultDelegationPolicy.address, defaultDelegationPolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        ))
            .to.be.revertedWithCustomError(operatorFactory, "NotExchangeRatePolicy")
    })

    it("reverts if incorrect undelegation policy is provided", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "OperatorTokenName3",
            "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultDelegationPolicy.address],
            [0, 0, 0]
        ))
            .to.be.revertedWithCustomError(operatorFactory, "NotUndelegationPolicy")
    })

    it("reverts on operator deploy if any of the policies are not trusted", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        const untrustedPolicyAddress = await operatorFactory.predictAddress("TokenName" + Date.now())

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
            [untrustedPolicyAddress, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address], [0, 0, 0])
        ).to.be.revertedWithCustomError(operatorFactory, "PolicyNotTrusted")

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
            [defaultDelegationPolicy.address, untrustedPolicyAddress, defaultUndelegationPolicy.address], [0, 0, 0])
        ).to.be.revertedWithCustomError(operatorFactory, "PolicyNotTrusted")

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, untrustedPolicyAddress], [0, 0, 0])
        ).to.be.revertedWithCustomError(operatorFactory, "PolicyNotTrusted")
    })

    it("only operators can call registerAsLive", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        await expect(operatorFactory.registerAsLive()).to.revertedWithCustomError(operatorFactory, "OnlyOperators")
    })

    it("only operators can call registerAsNotLive", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        await expect(operatorFactory.registerAsNotLive()).to.revertedWithCustomError(operatorFactory, "OnlyOperators")
    })
})
