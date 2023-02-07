import { upgrades, ethers } from "hardhat"
import { expect } from "chai"
import { Contract, ContractFactory, utils, Wallet } from "ethers"

import { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, ILeavePolicy, StreamrConstants, TestToken } from "../typechain"

const { defaultAbiCoder } = utils

// testcases to not forget:
// - increase stake if already joined

describe("Bounty", (): void => {
    let wallets: Wallet[]
    let adminWallet: Wallet
    let brokerWallet: Wallet
    let broker2Wallet: Wallet
    // const trustedForwarderAddress: string = wallets[9].address
    let streamrConstants: StreamrConstants
    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let token: TestToken
    let minStakeJoinPolicy: IJoinPolicy
    let maxBrokersJoinPolicy: IJoinPolicy
    let brokerPoolOnlyJoinPolicy: IJoinPolicy
    let bountyCounter = 0
    let bountyFromAdmin: Bounty
    let bountyFromBroker: Bounty
    let allocationPolicy: Contract
    let leavePolicy: Contract
    let testJoinPolicy: Contract
    let testAllocationPolicy: Contract

    before(async (): Promise<void> => {
        wallets = await ethers.getSigners() as unknown as Wallet[]
        adminWallet = wallets[0]
        brokerWallet = wallets[1]
        broker2Wallet = wallets[2]

        streamrConstants = await upgrades.deployProxy(await ethers.getContractFactory("StreamrConstants", adminWallet), []) as StreamrConstants
        await streamrConstants.deployed()

        token = await (await ethers.getContractFactory("TestToken", adminWallet)).deploy("Test token", "TEST") as TestToken
        await token.deployed()

        minStakeJoinPolicy = await (await ethers.getContractFactory("MinimumStakeJoinPolicy", adminWallet)).deploy() as IJoinPolicy
        await minStakeJoinPolicy.deployed()

        maxBrokersJoinPolicy = await (await ethers.getContractFactory("MaxAmountBrokersJoinPolicy", adminWallet)).deploy() as IJoinPolicy
        await maxBrokersJoinPolicy.deployed()

        brokerPoolOnlyJoinPolicy = await (await ethers.getContractFactory("BrokerPoolOnlyJoinPolicy", adminWallet)).deploy() as IJoinPolicy
        await brokerPoolOnlyJoinPolicy.deployed() // TODO: add test

        allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy", adminWallet)).deploy() as IAllocationPolicy
        await allocationPolicy.deployed()

        leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy", adminWallet)).deploy() as ILeavePolicy
        await leavePolicy.deployed()

        testJoinPolicy = await (await ethers.getContractFactory("TestJoinPolicy", adminWallet)).deploy() as Contract
        await testJoinPolicy.deployed()

        testAllocationPolicy = await (await ethers.getContractFactory("TestAllocationPolicy", adminWallet)).deploy() as Contract
        await testAllocationPolicy.deployed()

        const bountyTemplate = await (await ethers.getContractFactory("Bounty")).deploy() as Bounty
        await bountyTemplate.deployed()

        bountyFactoryFactory = await ethers.getContractFactory("BountyFactory", adminWallet)
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
            [ bountyTemplate.address, token.address, streamrConstants.address ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
        await (await bountyFactory.addTrustedPolicies([minStakeJoinPolicy.address, maxBrokersJoinPolicy.address, brokerPoolOnlyJoinPolicy.address,
            allocationPolicy.address, leavePolicy.address, testJoinPolicy.address, testAllocationPolicy.address])).wait()

        await (await streamrConstants.setBountyFactory(bountyFactory.address)).wait()

        await (await token.mint(adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
        await (await token.transfer(brokerWallet.address, ethers.utils.parseEther("100000"))).wait()
        await (await token.transfer(broker2Wallet.address, ethers.utils.parseEther("100000"))).wait()
    })

    // stakeweight or testallocpolicy params must be set
    type BaseBountyConfig = {
        minStake?: string,
        maxBrokers?: string,
        leavePol?: string,
        testJoinPol?: string,
    }
    type DefaultBountyConfig = BaseBountyConfig & {
        stakeWeight: string
    }
    type TestBountyConfig = BaseBountyConfig & {
        testAllocPolicy: string
    }
    const isDefaultBountyConfig = (config: BaseBountyConfig): config is DefaultBountyConfig => "stakeWeight" in config
    // const isTestBountyConfig = (config: BaseBountyConfig): config is TestBountyConfig => "testAllocPolicy" in config

    const createBounty = async (config: DefaultBountyConfig | TestBountyConfig): Promise<Bounty> => {
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
        if (config.testJoinPol) {
            joinPolicies.push(testJoinPolicy)
            joinPolicyParams.push(config.testJoinPol)
        }
        const leavePolicyParam = config.leavePol ?? "0"
        const chosenAllocationPolicy = isDefaultBountyConfig(config) ? allocationPolicy : testAllocationPolicy
        const allocPolicyParam = isDefaultBountyConfig(config) ? config.stakeWeight : config.testAllocPolicy

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

        const agreementFactory = await ethers.getContractFactory("Bounty")
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty
        return bountyFromAdmin
    }

    it("positivetest atomic fund and deploy bounty", async function(): Promise<void> {
        // for bountyFactory.deployBountyAgreement arguments, see createBounty function
        const data = ethers.utils.defaultAbiCoder.encode(["uint32", "uint32", "string", "address[]", "uint[]"],
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
        const bountyDeployTx = await token.transferAndCall(bountyFactory.address, ethers.utils.parseEther("100"), data)
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        expect(newBountyAddress).to.be.not.undefined
    })

    it("positivetest deploy bounty through factory, join bounty", async function(): Promise<void> {
        await createBounty({ minStake: "2000000000000000000", maxBrokers: "1", stakeWeight: "1" })
        const tx = await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("2"), adminWallet.address)
        await tx.wait()
    })

    it("negativetest zero minBrokerCount", async function(): Promise<void> {
        const data = ethers.utils.defaultAbiCoder.encode(["uint32", "uint32", "string", "address[]", "uint[]"],
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
        await expect(token.transferAndCall(bountyFactory.address, ethers.utils.parseEther("100"), data))
            .to.be.revertedWith("error_minBrokerCountZero")
    })

    it("negativetest addjoinpolicy from not-admin", async function(): Promise<void> {
        await expect(bountyFromBroker.addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000"))
            .to.be.revertedWith(
                "AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 " +
                "is missing role 0x0000000000000000000000000000000000000000000000000000000000000000"
            )
    })

    it("negativetest trying to join with wrong token", async function(): Promise<void> {
        const newtokenFactory = await ethers.getContractFactory("TestToken", adminWallet)
        const newToken = await newtokenFactory.deploy("Test2", "T2") as TestToken
        const newTokenFromAdmin = newToken.connect(adminWallet)
        await (await newToken.mint(adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
        // await expect(newTokenFromBroker.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), adminWallet.address))
        //     .to.be.revertedWith('error_onlyTokenContract')
        await expect(newTokenFromAdmin.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_onlyTokenContract")
    })

    // this should actually fail, but there might be a hardhat bug that allows calling functions on non-existing contracts, so we skip it for now
    // it('negativetest setjoinpolicy pointing to nonexistant contract', async function(): Promise<void> {
    //     await expect(bountyFromAdmin.addJoinPolicy(wallets[4].address, ethers.BigNumber.from('2000000000000000000')))
    //         .to.be.revertedWith('error adding join policy')
    // })

    it("negativetest sponsor with no allowance", async function(): Promise<void> {
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther("1"))).to.be.reverted // token.transferFrom fails without revert reason string
    })

    it("negativetest min stake join policy", async function(): Promise<void> {
        await createBounty({ minStake: "2000000000000000000", stakeWeight: "1" })
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_stakeUnderMinimum")
    })

    it("negativetest max brokers join policy", async function(): Promise<void> {
        await createBounty({ maxBrokers: "0", stakeWeight: "1" })
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_tooManyBrokers")
    })

    it("negativetest zero stake", async function(): Promise<void> {
        await createBounty({ stakeWeight: "1" })
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("0"), adminWallet.address))
            .to.be.revertedWith("error_cannotStakeZero")
    })

    it("negativetest sponsor with no allowance", async function(): Promise<void> {
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther("1"))).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
    })

    it("negativetest error setting param on joinpolicy", async function(): Promise<void> {
        await expect(createBounty({ testJoinPol: "1", stakeWeight: "1" })) // it will throw with 1
            .to.be.revertedWith("test-error: setting param join policy")
        await expect(createBounty({ testJoinPol: "2", stakeWeight: "1" })) // it will throw with 1
            .to.be.revertedWith("error_addJoinPolicyFailed")
    })

    it("negativetest error joining on joinpolicy", async function(): Promise<void> {
        await createBounty({ testJoinPol: "100", stakeWeight: "1" })
        await expect(token.transferAndCall(bountyFromAdmin.address, 1, adminWallet.address))
            .to.be.revertedWith("test-error: onJoin join policy")
    })

    it("negativetest error joining on joinpolicy, empty error", async function(): Promise<void> {
        await createBounty({ testJoinPol: "100", stakeWeight: "1" })
        await expect(token.transferAndCall(bountyFromAdmin.address, 2, adminWallet.address))
            .to.be.revertedWith("error_joinPolicyOnJoin")
    })

    it("negativetest error setting param on allocationPolicy", async function(): Promise<void> {
        await expect(createBounty({ testAllocPolicy: "1" }) ) // it will thrown with 1
            .to.be.revertedWith("test-error: setting param allocation policy")
    })

    it("negativetest error onJoin on allocationPolicy", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "2" })
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("test-error: onJoin allocation policy")
    })

    it("negativetest error onJoin on allocationPolicy, empty error", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "5" })
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_allocationPolicyOnJoin")
    })

    it("negativetest error onstakeIncrease", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "7" })
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address)).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("test-error: onStakeIncrease allocation policy")
    })

    it("negativetest error onstakeIncrease, empty error", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "8" })
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address)).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_stakeIncreaseFailed")
    })

    it("negativetest error onleave on allocationPolicy", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "3" })        // 3 -> will throw on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), brokerWallet.address)).wait()
        await expect(bountyFromBroker.leave()).to.be.revertedWith("test-error: onLeave allocation policy")
    })

    it("negativetest error onleave on allocationPolicy, empty error", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "6" })// 6 -> throw empty on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), brokerWallet.address)).wait()
        await expect(bountyFromBroker.leave()).to.be.revertedWith("error_brokerLeaveFailed")
    })

    it("send 32 length data on transferAndCall", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "3" }) // 3 -> will throw on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"),
            defaultAbiCoder.encode(["address"], [brokerWallet.address]))).wait()
        expect(await bountyFromBroker.getMyStake()).to.be.equal(ethers.utils.parseEther("1"))
    })

    it("stake through stake() function", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "3" }) // 3 -> will throw on leave
        await (await token.approve(bountyFromAdmin.address, ethers.utils.parseEther("1"))).wait()
        await (await bountyFromAdmin.stake(brokerWallet.address, ethers.utils.parseEther("1"))).wait()
        expect(await bountyFromBroker.getMyStake()).to.be.equal(ethers.utils.parseEther("1"))
    })

    it.skip("send length data on transferAndCall", async function(): Promise<void> {
        await createBounty({ testAllocPolicy: "3" }) // 3 -> will throw on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"),
            defaultAbiCoder.encode(["address"], [brokerWallet.address]))).wait()
        expect(await bountyFromBroker.getMyStake()).to.be.equal(ethers.utils.parseEther("1"))
    })

    it("handles empty errors from policies", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await expect(bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "4"))
            .to.be.revertedWith("AccessControl: account 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 is missing "
            + "role 0x0000000000000000000000000000000000000000000000000000000000000000")
    })

    it("negativetest calling fallback function", async function(): Promise<void> {
        await expect(adminWallet.sendTransaction({to: bountyFromAdmin.address})).to.be.revertedWith("error_mustBeThis")
    })

    it("negativetest try to create bounty with untrusted policies", async function(): Promise<void> {
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
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        await expect(bountyFactory.deployBountyAgreement(0, 1, "Bounty-" + bountyCounter++,
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_badArguments")
    })

    // must be last test, will remove all policies
    it("positivetest remove trusted policies", async function(): Promise<void> {
        expect(await bountyFactory.isTrustedPolicy(minStakeJoinPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(allocationPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(leavePolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(testAllocationPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(testJoinPolicy.address)).to.be.true
        await (await bountyFactory.removeTrustedPolicy(minStakeJoinPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(maxBrokersJoinPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(allocationPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(leavePolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(testAllocationPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(testJoinPolicy.address)).wait()
        expect(await bountyFactory.isTrustedPolicy(minStakeJoinPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(allocationPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(leavePolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(testAllocationPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(testJoinPolicy.address)).to.be.false
    })
})
