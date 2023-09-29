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

    it("can't deploy an operator having a cut over 100%", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("1.01"), // 101%
            "OperatorTokenName",
            "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        ))
            .to.be.revertedWith("error_invalidOperatorsCut")
    })

    it("can remove a trusted policy", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        const randomAddress = Wallet.createRandom().address
        await (await operatorFactory.addTrustedPolicy(randomAddress)).wait()

        expect(await operatorFactory.isTrustedPolicy(randomAddress)).to.be.true
        await (await operatorFactory.removeTrustedPolicy(randomAddress)).wait()
        expect(await operatorFactory.isTrustedPolicy(randomAddress)).to.be.false
    })

    // TODO: useless once the policy checks are in place
    // it("can deploy an operator without any policies", async function(): Promise<void> {
    //     const { operatorFactory } = sharedContracts
    //     const zeroAddress = hardhatEthers.constants.AddressZero
    //     await expect(operatorFactory.deployOperator(
    //         parseEther("0.1"),
    //         "OperatorTokenName2",
    //         "{}",
    //         [zeroAddress, zeroAddress, zeroAddress],
    //         [0, 0, 0]
    //     ))
    //         .to.emit(operatorFactory, "NewOperator")
    // })

    // it("can't put exchangeRatePolicy in the delegationPolicy's slot", async function(): Promise<void> {})

    // it("should require ExchangeRatePolicy", async function(): Promise<void> {})

    // it("other (than ExchangeRatePolicy) policies can be zero", async function(): Promise<void> {})

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
            .to.be.revertedWith("error_exchangeRatePolicyRequired")
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

    // it.only("reverts if incorrect delegation policy is provided", async function(): Promise<void> {
    //     const { operatorFactory, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
    //     await expect(operatorFactory.deployOperator(
    //         parseEther("0.1"),
    //         "OperatorTokenName",
    //         "{}",
    //         [defaultExchangeRatePolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
    //         [0, 0, 0]
    //     ))
    //         .to.be.revertedWith("error_delegationPolicyNotSupported")
    // })

    // it.only("reverts if incorrect exchange rate policy is provided", async function(): Promise<void> {
    //     const { operatorFactory, defaultDelegationPolicy, defaultUndelegationPolicy } = sharedContracts
    //     await expect(operatorFactory.deployOperator(
    //         parseEther("0.1"),
    //         "OperatorTokenName",
    //         "{}",
    //         [defaultDelegationPolicy.address, defaultDelegationPolicy.address, defaultUndelegationPolicy.address],
    //         [0, 0, 0]
    //     ))
    //         .to.be.revertedWith("error_exchangeRatePolicyNotSupported")
    // })

    // it.only("reverts if incorrect undelegation policy is provided", async function(): Promise<void> {
    //     const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
    //     await expect(operatorFactory.deployOperator(
    //         parseEther("0.1"),
    //         "OperatorTokenName",
    //         "{}",
    //         [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
    //         [0, 0, 0]
    //     ))
    //         .to.be.revertedWith("error_undelegationPolicyNotSupported")
    // })

    // it("ExchangeRatePolicy must be trusted AND can NOT be zero address", async function(): Promise<void> {})
    // it("DelegationPolicy must be trusted OR zero address", async function(): Promise<void> {})

    it("reverts on operator deploy if any of the policies are not trusted", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        const untrustedPolicyAddress = Wallet.createRandom().address

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
            [untrustedPolicyAddress, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address], [0, 0, 0]))
            .to.be.revertedWith("error_policyNotTrusted")

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
            [defaultDelegationPolicy.address, untrustedPolicyAddress, defaultUndelegationPolicy.address], [0, 0, 0]))
            .to.be.revertedWith("error_policyNotTrusted")

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, untrustedPolicyAddress], [0, 0, 0]))
            .to.be.revertedWith("error_policyNotTrusted")
    })

    it("only operators can call registerAsLive", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        await expect(operatorFactory.registerAsLive()).to.revertedWith("error_onlyOperators")
    })

    it("only operators can call registerAsNotLive", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        await expect(operatorFactory.registerAsNotLive()).to.revertedWith("error_onlyOperators")
    })

    // it.only("can't deploy operators having any untrusted policies", async function(): Promise<void> {
    //     const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
    //     await (await operatorFactory.addTrustedPolicies(
    //             [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address])).wait()
    //     // const untrustedPolicyAddress = Wallet.createRandom().address

    //     // await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
    //     //     [untrustedPolicyAddress, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address], [0, 0, 0]))
    //     //     .to.be.revertedWith("error_policyNotTrusted")

    //     // await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
    //     //     [defaultDelegationPolicy.address, untrustedPolicyAddress, defaultUndelegationPolicy.address], [0, 0, 0]))
    //     //     .to.be.revertedWith("error_policyNotTrusted")

    //     // await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
    //     //     [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, untrustedPolicyAddress], [0, 0, 0]))
    //     //     .to.be.revertedWith("error_policyNotTrusted")
        
    //     await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
    //         [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address], [0, 0, 0]))
    //         .to.emit(operatorFactory, "NewOperator")
    // })

    // it("can deploy operators without setting tge policies", async function(): Promise<void> {
    //     const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
    //     const zeroAddress = hardhatEthers.constants.AddressZero

    //     await expect(operatorFactory.deployOperator(parseEther("0.1"), "OperatorTokenName", "{}",
    //         [defaultDelegationPolicy.address, zeroAddress, defaultUndelegationPolicy.address], [0, 0, 0]))
    //         .to.emit(operatorFactory, "NewOperator")
    // })
})
