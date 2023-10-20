import { expect } from "chai"
import { ethers as hardhatEthers, upgrades } from "hardhat"

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deployOperatorContract } from "./deployOperatorContract"

import { Wallet } from "ethers"
import { OperatorFactory } from "../../../typechain"

const { getSigners, getContractFactory } = hardhatEthers
const { defaultAbiCoder, parseEther, formatEther } = hardhatEthers.utils

describe("OperatorFactory", function(): void {
    let deployer: Wallet        // deploys all test contracts
    let operatorWallet: Wallet  // creates Operator contract
    let operator2Wallet: Wallet  // creates Operator contract

    // many tests don't need their own clean set of contracts that take time to deploy
    let sharedContracts: TestContracts

    before(async (): Promise<void> => {
        [ deployer, operatorWallet, operator2Wallet ] = await getSigners() as unknown as Wallet[]
        sharedContracts = await deployTestContracts(deployer)
    })

    describe("UUPS upgradeability", () => {
        it("admin can upgrade only after assigning themselves the UPGRADER_ROLE", async () => {
            const { operatorFactory } = sharedContracts
            const upgraderRole = await operatorFactory.UPGRADER_ROLE()
            const newContractFactory = await getContractFactory("OperatorFactory") // e.g. OperatorFactoryV2

            await expect(upgrades.upgradeProxy(operatorFactory.address, newContractFactory, { unsafeAllow: ["delegatecall"] }))
                .to.be.revertedWith(`AccessControl: account ${deployer.address.toLowerCase()} is missing role ${upgraderRole.toLowerCase()}`)

            await (await operatorFactory.grantRole(upgraderRole, deployer.address)).wait()

            const newOperatorFactoryTx = await upgrades.upgradeProxy(operatorFactory.address, newContractFactory, { unsafeAllow: ["delegatecall"] })
            const newOperatorFactory = await newOperatorFactoryTx.deployed() as OperatorFactory

            expect(operatorFactory.address).to.equal(newOperatorFactory.address)
        })

        it("notAdmin can NOT upgrade or assign the UPGRADER_ROLE", async () => {
            const { operatorFactory } = sharedContracts
            const adminRole = await operatorFactory.DEFAULT_ADMIN_ROLE()
            const upgraderRole = await operatorFactory.UPGRADER_ROLE()
            const newContractFactory = await getContractFactory("OperatorFactory", operatorWallet) // e.g. OperatorFactoryV2

            await expect(upgrades.upgradeProxy(operatorFactory.address, newContractFactory, { unsafeAllow: ["delegatecall"] }))
                .to.be.revertedWith(`AccessControl: account ${operatorWallet.address.toLowerCase()} is missing role ${upgraderRole.toLowerCase()}`)
            await expect(operatorFactory.connect(operatorWallet).grantRole(upgraderRole, deployer.address))
                .to.be.revertedWith(`AccessControl: account ${operatorWallet.address.toLowerCase()} is missing role ${adminRole.toLowerCase()}`)
        })

        it("storage is preserved after the upgrade", async () => {
            const { operatorFactory } = sharedContracts
            const randomAddress = Wallet.createRandom().address
            await (await operatorFactory.addTrustedPolicy(randomAddress)).wait()
            const operator = await deployOperatorContract(sharedContracts, operator2Wallet)

            const newContractFactory = await getContractFactory("OperatorFactory") // e.g. OperatorFactoryV2
            const newOperatorFactoryTx = await upgrades.upgradeProxy(operatorFactory.address, newContractFactory, { unsafeAllow: ["delegatecall"] })
            const newOperatorFactory = await newOperatorFactoryTx.deployed() as OperatorFactory

            expect(await newOperatorFactory.isTrustedPolicy(randomAddress)).to.be.true
            expect(await newOperatorFactory.deploymentTimestamp(operator.address)).to.not.equal(0)
        })

        it("reverts if trying to call initialize()", async () => {
            const { operatorFactory } = sharedContracts
            const zeroAddress = hardhatEthers.constants.AddressZero
            await expect(operatorFactory.initialize(zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress))
                .to.be.revertedWith("Initializable: contract is already initialized")
        })
    })

    it("lets only admin change template addresses", async function(): Promise<void> {
        const { operatorFactory, operatorTemplate, nodeModule, queueModule, stakeModule } = sharedContracts
        const adminRole = await operatorFactory.DEFAULT_ADMIN_ROLE()
        const dummyAddress = Wallet.createRandom().address

        await expect(operatorFactory.connect(operatorWallet).updateTemplates(dummyAddress, dummyAddress, dummyAddress, dummyAddress))
            .to.be.revertedWith(`AccessControl: account ${operatorWallet.address.toLowerCase()} is missing role ${adminRole.toLowerCase()}`)
        await expect(operatorFactory.updateTemplates(dummyAddress, dummyAddress, dummyAddress, dummyAddress))
            .to.emit(operatorFactory, "TemplateAddresses").withArgs(dummyAddress, dummyAddress, dummyAddress, dummyAddress)

        // restore the addresses...
        await expect(operatorFactory.updateTemplates(operatorTemplate.address, nodeModule.address, queueModule.address, stakeModule.address))
            .to.emit(operatorFactory, "TemplateAddresses")
            .withArgs(operatorTemplate.address, nodeModule.address, queueModule.address, stakeModule.address)
    })

    it("does NOT allow same operator signer deploy a second Operator contract", async function(): Promise<void> {
        await deployOperatorContract(sharedContracts, operatorWallet)
        await expect(deployOperatorContract(sharedContracts, operatorWallet))
            .to.be.revertedWithCustomError(sharedContracts.operatorFactory, "OperatorAlreadyDeployed")
    })

    it("can create an Operator with transferAndCall (atomic fund and deploy operator)", async function(): Promise<void> {
        const {
            operatorFactory,
            token,
            defaultDelegationPolicy,
            defaultExchangeRatePolicy,
            defaultUndelegationPolicy
        } = await deployTestContracts(deployer)
        const operatorsCutFraction = parseEther("0.1")
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[3]", "uint[3]"],
            [
                operatorsCutFraction,
                "TransferAndCallTest",
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

        const operatorDeployTx = await token.connect(deployer).transferAndCall(operatorFactory.address, parseEther("1000"), data)
        const operatorDeployReceipt = await operatorDeployTx.wait()
        const newOperatorAddress = operatorDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        const newOperatorLog = operatorDeployReceipt.logs.find((e) => e.address == operatorFactory.address)
        if (!newOperatorLog) { throw new Error("NewOperator event not found") }  // typescript can't infer not-undefined from expect
        const newOperatorEvent = operatorFactory.interface.parseLog(newOperatorLog)

        expect(newOperatorEvent.name).to.equal("NewOperator")
        expect(newOperatorEvent.args.operatorAddress).to.equal(deployer.address)
        expect(newOperatorEvent.args.operatorContractAddress).to.equal(newOperatorAddress)
        expect(formatEther(await token.balanceOf(newOperatorAddress))).to.equal("1000.0")
    })

    it("transferAndCall reverts for missing / incomplete data encoded", async function(): Promise<void> {
        const { operatorFactory, token } = sharedContracts

        // missing encoded data
        await expect(token.connect(deployer).transferAndCall(operatorFactory.address, parseEther("10"), "0x"))
            .to.be.reverted

        // missing encoded policies and policies params
        const operatorsCutFraction = parseEther("0.1")
        const data = defaultAbiCoder.encode(["uint", "string", "string"],
            [
                operatorsCutFraction,
                "BadDataTest",
                "{}"
            ]
        )
        await expect(token.connect(deployer).transferAndCall(operatorFactory.address, parseEther("10"), data))
            .to.be.reverted
    })

    it("transferAndCall reverts for wrong token", async function(): Promise<void> {
        const {
            operatorFactory,
            defaultDelegationPolicy,
            defaultExchangeRatePolicy,
            defaultUndelegationPolicy
        } = await deployTestContracts(deployer)
        const wrongToken = await (await getContractFactory("TestToken", { deployer })).deploy("TestToken", "TEST")
        await (await wrongToken.mint(deployer.address, parseEther("1000"))).wait()
        const operatorsCutFraction = parseEther("0.1")
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[3]", "uint[3]"],
            [
                operatorsCutFraction,
                "TransferAndCallWrongToken",
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

        await expect(wrongToken.connect(deployer).transferAndCall(operatorFactory.address, parseEther("1000"), data))
            .to.be.revertedWithCustomError(operatorFactory, "AccessDeniedDATATokenOnly")
    })

    it("predicts the correct address for a new operator contract", async function(): Promise<void> {
        const contracts = await deployTestContracts(deployer)
        const predictedOperatorAddress = await contracts.operatorFactory.predictAddress("PredictTest")
        const operator = await deployOperatorContract(contracts, deployer, parseEther("0"), {}, "PredictTest")
        expect(predictedOperatorAddress).to.equal(operator.address)
    })

    it("can't deploy an operator having a cut over 100%", async function(): Promise<void> {
        const { operatorFactory, operatorTemplate, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("1.01"), // 101%
            "BadOperatorCutTest",
            "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        )).to.be.revertedWithCustomError(operatorTemplate, "InvalidOperatorsCut").withArgs(parseEther("1.01"))
    })

    it("can remove a trusted policy", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        const randomAddress = await operatorFactory.predictAddress("TokenName" + Date.now())
        await (await operatorFactory.addTrustedPolicy(randomAddress)).wait()

        expect(await operatorFactory.isTrustedPolicy(randomAddress)).to.be.true
        await (await operatorFactory.removeTrustedPolicy(randomAddress)).wait()
        expect(await operatorFactory.isTrustedPolicy(randomAddress)).to.be.false
    })

    it("only admin can add a trusted policy", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.connect(operatorWallet).addTrustedPolicy(defaultExchangeRatePolicy.address))
            .to.be.rejectedWith("AccessControl: account " + operatorWallet.address.toLowerCase() +
                " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("only admin can add trusted policies", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.connect(operatorWallet).addTrustedPolicies([defaultExchangeRatePolicy.address]))
            .to.be.rejectedWith("AccessControl: account " + operatorWallet.address.toLowerCase() +
                " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("only admin can remove a trusted policy", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.connect(operatorWallet).removeTrustedPolicy(defaultExchangeRatePolicy.address))
            .to.be.rejectedWith("AccessControl: account " + operatorWallet.address.toLowerCase() +
                " is missing role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("DelegationPolicy can be the zero address", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy, defaultUndelegationPolicy } = await deployTestContracts(deployer)
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "DelegationPolicyZero",
            "{}",
            [hardhatEthers.constants.AddressZero, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        )).to.emit(operatorFactory, "NewOperator")
    })

    it("ExchangeRatePolicy can NOT be the zero address", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "ExchangeRatePolicyZero",
            "{}",
            [defaultDelegationPolicy.address, hardhatEthers.constants.AddressZero, defaultUndelegationPolicy.address],
            [0, 0, 0]
        )).to.be.revertedWithCustomError(operatorFactory, "ExchangeRatePolicyRequired")
    })

    it("UnelegationPolicy can be the zero address", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy } = await deployTestContracts(deployer)
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "UnelegationPolicyZero",
            "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, hardhatEthers.constants.AddressZero],
            [0, 0, 0]
        )).to.emit(operatorFactory, "NewOperator")
    })

    it("reverts if incorrect delegation policy is provided", async function(): Promise<void> {
        const { operatorFactory, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "BadDelegationPolicyTest",
            "{}",
            [defaultExchangeRatePolicy.address, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        )).to.be.revertedWithCustomError(operatorFactory, "NotDelegationPolicy")
    })

    it("reverts if incorrect exchange rate policy is provided", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultUndelegationPolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "BadExchangeRatePolicyTest",
            "{}",
            [defaultDelegationPolicy.address, defaultDelegationPolicy.address, defaultUndelegationPolicy.address],
            [0, 0, 0]
        )).to.be.revertedWithCustomError(operatorFactory, "NotExchangeRatePolicy")
    })

    it("reverts if incorrect undelegation policy is provided", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy } = sharedContracts
        await expect(operatorFactory.deployOperator(
            parseEther("0.1"),
            "BadUndelegationPolicyTest",
            "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, defaultDelegationPolicy.address],
            [0, 0, 0]
        )).to.be.revertedWithCustomError(operatorFactory, "NotUndelegationPolicy")
    })

    it("reverts on operator deploy if any of the policies are not trusted", async function(): Promise<void> {
        const { operatorFactory, defaultDelegationPolicy, defaultExchangeRatePolicy, defaultUndelegationPolicy } = sharedContracts
        const untrustedPolicyAddress = await operatorFactory.predictAddress("TokenName" + Date.now())

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "NotTrustedTest", "{}",
            [untrustedPolicyAddress, defaultExchangeRatePolicy.address, defaultUndelegationPolicy.address], [0, 0, 0])
        ).to.be.revertedWithCustomError(operatorFactory, "PolicyNotTrusted")

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "NotTrustedTest", "{}",
            [defaultDelegationPolicy.address, untrustedPolicyAddress, defaultUndelegationPolicy.address], [0, 0, 0])
        ).to.be.revertedWithCustomError(operatorFactory, "PolicyNotTrusted")

        await expect(operatorFactory.deployOperator(parseEther("0.1"), "NotTrustedTest", "{}",
            [defaultDelegationPolicy.address, defaultExchangeRatePolicy.address, untrustedPolicyAddress], [0, 0, 0])
        ).to.be.revertedWithCustomError(operatorFactory, "PolicyNotTrusted")
    })

    it("only operators can register as voters", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        await expect(operatorFactory.registerAsVoter()).to.revertedWithCustomError(operatorFactory, "OnlyOperators")
    })

    it("only operators can register as non-voters", async function(): Promise<void> {
        const { operatorFactory } = sharedContracts
        await expect(operatorFactory.registerAsNonVoter()).to.revertedWithCustomError(operatorFactory, "OnlyOperators")
    })
})
