import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { Contract, utils as ethersUtils, Wallet } from "ethers"

import { Bounty, IAllocationPolicy, TestJoinPolicy, TestAllocationPolicy, TestToken } from "../typechain"

const { defaultAbiCoder, parseEther } = ethersUtils
const { getSigners, getContractFactory } = hardhatEthers

import {
    deployTestContracts,
    // deployBountyContract, // TODO: replace createBounty with this
    deployBrokerPool,
    TestContracts,
} from "./utils"

// TODO: testcases to not forget:
// - increase stake if already joined

describe("Bounty", (): void => {
    let admin: Wallet
    let broker: Wallet
    let broker2: Wallet

    let token: TestToken

    let testJoinPolicy: TestJoinPolicy
    let testAllocationPolicy: TestAllocationPolicy

    let contracts: TestContracts

    let bountyCounter = 0

    // some test cases just want "any bounty", no need to deploy a new contract
    let defaultBounty: Bounty

    before(async (): Promise<void> => {
        [admin, broker, broker2] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { bountyFactory } = contracts
        testAllocationPolicy = await (await (await getContractFactory("TestAllocationPolicy", admin)).deploy()).deployed()
        testJoinPolicy = await (await (await getContractFactory("TestJoinPolicy", admin)).deploy()).deployed()
        await (await bountyFactory.addTrustedPolicies([ testJoinPolicy.address, testAllocationPolicy.address])).wait()

        token = contracts.token
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(broker.address, parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()

        defaultBounty = await createBounty(contracts, { incomePerSecond: "1" }) // TODO: probably use BigNumber (from parseEther) instead of string...
    })

    // TODO: replace createBounty with utils.ts:deployBountyContract
    // TODO: should these typings be distributed in the NPM package? They look complex for just this test file
    // TODO: maybe make it more explicit to call points which policies are included. Don't add layers of abstraction to test code.
    //         Probably remove these config types unless they become part of some kind of JS library API (maybe in streamr-client?)
    // stakeweight or testallocpolicy params must be set
    type BaseBountyConfig = {
        minStake?: string,
        maxBrokers?: string,
        penaltyPeriod?: string,
        brokerPoolsOnly?: boolean,
        useTestJoinPolicy?: string,
    }
    type DefaultBountyConfig = BaseBountyConfig & {
        incomePerSecond: string
    }
    type TestBountyConfig = BaseBountyConfig & {
        testAllocPolicy: string
    }
    const isDefaultBountyConfig = (config: BaseBountyConfig): config is DefaultBountyConfig =>
        (config as DefaultBountyConfig).incomePerSecond !== undefined

    const createBounty = async (contracts: TestContracts, config: DefaultBountyConfig | TestBountyConfig): Promise<Bounty> => {
        const {
            bountyFactory,
            minStakeJoinPolicy, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy, allocationPolicy, leavePolicy,
        } = contracts

        const joinPolicies: Contract[] = []
        const joinPolicyParams: string[] = []
        if (config.minStake) {
            joinPolicies.push(minStakeJoinPolicy)
            joinPolicyParams.push(config.minStake)
        }
        if (config.maxBrokers) {
            joinPolicies.push(maxBrokersJoinPolicy)
            joinPolicyParams.push(config.maxBrokers)
        }
        if (config.brokerPoolsOnly) {
            joinPolicies.push(brokerPoolOnlyJoinPolicy)
            joinPolicyParams.push("0")
        }
        if (config.useTestJoinPolicy) {
            joinPolicies.push(testJoinPolicy)
            joinPolicyParams.push(config.useTestJoinPolicy)
        }
        const leavePolicyParam = config.penaltyPeriod ?? "0"
        const chosenAllocationPolicy = isDefaultBountyConfig(config) ? allocationPolicy : testAllocationPolicy
        const allocPolicyParam = isDefaultBountyConfig(config) ? config.incomePerSecond : config.testAllocPolicy

        /**
         * Policies array is interpreted as follows:
         *   0: allocation policy (address(0) for none)
         *   1: leave policy (address(0) for none)
         *   2: kick policy (address(0) for none)
         *   3+: join policies (leave out if none)
         * @param policies smart contract addresses found in the trustedPolicies
         function deployBountyAgreement(
            uint32 initialMinHorizonSeconds,
            uint32 initialMinBrokerCount,
            string memory bountyName,
            address[] memory policies,
            uint[] memory initParams
        )
        */
        const bountyDeployTx = await bountyFactory.deployBountyAgreement(
            0,
            1,
            "Bounty-" + bountyCounter++,
            [
                chosenAllocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
                ...joinPolicies.map((policy) => policy.address)
            ], [
                allocPolicyParam,
                leavePolicyParam,
                "0",
                ...joinPolicyParams
            ]
        )
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.undefined
        // console.log("bounty " + newBountyAddress)

        const agreementFactory = await getContractFactory("Bounty")
        const bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, admin) as Bounty
        return bountyFromAdmin
    }

    it("positivetest deploy bounty through factory, join bounty", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { minStake: "2000000000000000000", maxBrokers: "1", incomePerSecond: "1" })
        const tx = await token.transferAndCall(bounty.address, parseEther("2"), admin.address)
        await tx.wait()
    })

    it("positivetest atomic fund and deploy bounty", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, minStakeJoinPolicy, bountyFactory } = contracts
        // for bountyFactory.deployBountyAgreement arguments, see createBounty function
        const data = defaultAbiCoder.encode(["uint32", "uint32", "string", "address[]", "uint[]"],
            [0, 1, "Bounty-" + bountyCounter++, [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
                minStakeJoinPolicy.address,
            ], [
                "2000000000000000000",
                "0",
                "0",
                "1",
            ]]
        )
        const bountyDeployTx = await token.transferAndCall(bountyFactory.address, parseEther("100"), data)
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        expect(newBountyAddress).to.be.not.undefined
    })

    it("negativetest zero minBrokerCount", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, minStakeJoinPolicy, bountyFactory } = contracts
        const data = defaultAbiCoder.encode(["uint32", "uint32", "string", "address[]", "uint[]"],
            [0, 0, "Bounty-" + bountyCounter++, [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
                minStakeJoinPolicy.address,
            ], [
                "2000000000000000000",
                "0",
                "0",
                "1",
            ]]
        )
        await expect(token.transferAndCall(bountyFactory.address, parseEther("100"), data))
            .to.be.revertedWith("error_minBrokerCountZero")
    })

    it("negativetest addjoinpolicy from non-admin", async function(): Promise<void> {
        const { minStakeJoinPolicy } = contracts
        const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"
        await expect(defaultBounty.connect(broker).addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000"))
            .to.be.revertedWith(`AccessControl: account ${broker.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`)
    })

    it("negativetest trying to join with wrong token", async function(): Promise<void> {
        const newToken = await (await (await (await getContractFactory("TestToken", admin)).deploy("Test2", "T2")).deployed())
        await (await newToken.mint(admin.address, parseEther("1000000"))).wait()
        await expect(newToken.transferAndCall(defaultBounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("error_badToken")
    })

    // this should actually fail, but there might be a hardhat bug that allows calling functions on non-existing contracts, so we skip it for now
    // it('negativetest setjoinpolicy pointing to nonexistant contract', async function(): Promise<void> {
    //     await expect(bountyFromAdmin.addJoinPolicy(wallets[4].address, ethers.BigNumber.from('2000000000000000000')))
    //         .to.be.revertedWith('error adding join policy')
    // })

    it("negativetest sponsor with no allowance", async function(): Promise<void> {
        await expect(defaultBounty.sponsor(parseEther("1"))).to.be.reverted // token.transferFrom fails without revert reason string
    })

    it("negativetest min stake join policy", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { minStake: "2000000000000000000", incomePerSecond: "1" })
        await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("error_stakeUnderMinimum")
    })

    it("negativetest max brokers join policy", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { maxBrokers: "0", incomePerSecond: "1" })
        await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("error_tooManyBrokers")
    })

    it("negativetest zero stake", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { incomePerSecond: "1" })
        await expect(token.transferAndCall(bounty.address, parseEther("0"), admin.address))
            .to.be.revertedWith("error_cannotStakeZero")
    })

    it("negativetest sponsor with no allowance", async function(): Promise<void> {
        await expect(defaultBounty.sponsor(parseEther("1"))).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
    })

    it("negativetest error setting param on joinpolicy", async function(): Promise<void> {
        await expect(createBounty(contracts, { useTestJoinPolicy: "1", incomePerSecond: "1" })) // it will throw with 1
            .to.be.revertedWith("test-error: setting param join policy")
        await expect(createBounty(contracts, { useTestJoinPolicy: "2", incomePerSecond: "1" })) // it will throw with 1
            .to.be.revertedWith("error_addJoinPolicyFailed")
    })

    it("negativetest error joining on joinpolicy", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { useTestJoinPolicy: "100", incomePerSecond: "1" })
        await expect(token.transferAndCall(bounty.address, 1, admin.address))
            .to.be.revertedWith("test-error: onJoin join policy")
    })

    it("negativetest error joining on joinpolicy, empty error", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { useTestJoinPolicy: "100", incomePerSecond: "1" })
        await expect(token.transferAndCall(bounty.address, 2, admin.address))
            .to.be.revertedWith("error_joinPolicyOnJoin")
    })

    it("negativetest error setting param on allocationPolicy", async function(): Promise<void> {
        await expect(createBounty(contracts, { testAllocPolicy: "1" }) ) // it will thrown with 1
            .to.be.revertedWith("test-error: setting param allocation policy")
    })

    it("negativetest error onJoin on allocationPolicy", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "2" })
        await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("test-error: onJoin allocation policy")
    })

    it("negativetest error onJoin on allocationPolicy, empty error", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "5" })
        await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("error_allocationPolicyOnJoin")
    })

    it("negativetest error onstakeIncrease", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "7" })
        await (await token.transferAndCall(bounty.address, parseEther("1"), admin.address)).wait()
        await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("test-error: onStakeIncrease allocation policy")
    })

    it("negativetest error onstakeIncrease, empty error", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "8" })
        await (await token.transferAndCall(bounty.address, parseEther("1"), admin.address)).wait()
        await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("error_stakeIncreaseFailed")
    })

    it("negativetest error onleave on allocationPolicy", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "3" })        // 3 -> will throw on leave
        await (await token.transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()
        await expect(bounty.connect(broker).leave()).to.be.revertedWith("test-error: onLeave allocation policy")
    })

    it("negativetest error onleave on allocationPolicy, empty error", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "6" })// 6 -> throw empty on leave
        await (await token.transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()
        await expect(bounty.connect(broker).leave()).to.be.revertedWith("error_brokerLeaveFailed")
    })

    it("send 32 length data on transferAndCall", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "3" }) // 3 -> will throw on leave
        await (await token.transferAndCall(bounty.address, parseEther("1"),
            defaultAbiCoder.encode(["address"], [broker.address]))).wait()
        expect(await bounty.connect(broker).getMyStake()).to.be.equal(parseEther("1"))
    })

    it("stake through stake() function", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "3" }) // 3 -> will throw on leave
        await (await token.approve(bounty.address, parseEther("1"))).wait()
        await (await bounty.stake(broker.address, parseEther("1"))).wait()
        expect(await bounty.connect(broker).getMyStake()).to.be.equal(parseEther("1"))
    })

    it.skip("send length data on transferAndCall", async function(): Promise<void> {
        const bounty = await createBounty(contracts, { testAllocPolicy: "3" }) // 3 -> will throw on leave
        await (await token.transferAndCall(bounty.address, parseEther("1"), defaultAbiCoder.encode(["address"], [broker.address]))).wait()
        expect(await bounty.connect(broker).getMyStake()).to.be.equal(parseEther("1"))
    })

    it("handles empty errors from policies", async function(): Promise<void> {
        const jpMS = await getContractFactory("TestAllocationPolicy", admin)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(admin).deployed() as IAllocationPolicy
        await expect(defaultBounty.setAllocationPolicy(testAllocPolicy.address, "4"))
            .to.be.revertedWith("AccessControl: account 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 is missing "
            + "role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("negativetest calling fallback function", async function(): Promise<void> {
        await expect(admin.sendTransaction({to: defaultBounty.address})).to.be.revertedWith("error_mustBeThis")
    })

    it("negativetest try to create bounty with untrusted policies", async function(): Promise<void> {
        const { bountyFactory, allocationPolicy, leavePolicy } = contracts
        /**
         * Policies array is interpreted as follows:
         *   0: allocation policy (address(0) for none)
         *   1: leave policy (address(0) for none)
         *   2: kick policy (address(0) for none)
         *   3+: join policies (leave out if none)
         * @param policies smart contract addresses found in the trustedPolicies
         function deployBountyAgreement(
            uint initialMinHorizonSeconds,
            uint initialMinBrokerCount,
            string memory bountyName,
            address[] memory policies,
            uint[] memory initParams
        ) */
        const untrustedAddress = "0x1234567890123456789012345678901234567890"
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        // allocationpolicy
        await expect(bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + bountyCounter++,
            [untrustedAddress, leavePolicy.address, kickPolicyAddress, testJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // leavepolicy
        await expect(bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + bountyCounter++,
            [allocationPolicy.address, untrustedAddress, kickPolicyAddress, testJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // kickpolicy
        await expect(bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + bountyCounter++,
            [allocationPolicy.address, leavePolicy.address, untrustedAddress, testJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // joinpolicy
        await expect(bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + bountyCounter++,
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress, untrustedAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
    })

    it("negativetest try to create bounty with mismatching number of policies and params", async function(): Promise<void> {
        const { bountyFactory, allocationPolicy, leavePolicy } = contracts
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        await expect(bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + bountyCounter++,
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_badArguments")
    })

    // must be last test, will remove all policies in the bountyFactory
    it("positivetest remove trusted policies", async function(): Promise<void> {
        const {
            bountyFactory,
            minStakeJoinPolicy, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy, allocationPolicy, leavePolicy,
        } = contracts
        expect(await bountyFactory.isTrustedPolicy(minStakeJoinPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(allocationPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(leavePolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(testAllocationPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(testJoinPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).to.be.true
        await (await bountyFactory.removeTrustedPolicy(minStakeJoinPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(maxBrokersJoinPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(allocationPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(leavePolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(testAllocationPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(testJoinPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).wait()
        expect(await bountyFactory.isTrustedPolicy(minStakeJoinPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(allocationPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(leavePolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(testAllocationPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(testJoinPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).to.be.false
    })
})
