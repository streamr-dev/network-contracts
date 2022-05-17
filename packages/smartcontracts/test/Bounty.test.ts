import { waffle, upgrades, ethers } from "hardhat"
import { expect, use } from "chai"
import { Contract, ContractFactory, utils } from "ethers"

import type { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, ILeavePolicy, TestToken } from "../typechain"

// const { deployContract } = waffle
const { provider } = waffle
const { defaultAbiCoder } = utils

use(waffle.solidity)

// testcases to not forget:
// - increase stake if already joined

describe("Bounty", (): void => {
    const wallets = provider.getWallets()
    const adminWallet = wallets[0]
    const brokerWallet = wallets[1]
    const broker2Wallet = wallets[2]
    const trustedForwarderAddress: string = wallets[9].address
    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let token: TestToken
    let minStakeJoinPolicy: IJoinPolicy
    let maxBrokersJoinPolicy: IJoinPolicy
    let bountyCounter = 0
    let bountyFromAdmin: Contract
    let bountyFromBroker: Contract
    let allocationPolicy: Contract
    let leavePolicy: Contract

    before(async (): Promise<void> => {
        token = await (await ethers.getContractFactory("TestToken", adminWallet)).deploy("Test token", "TEST") as TestToken
        await token.deployed()

        minStakeJoinPolicy = await (await ethers.getContractFactory("MinimumStakeJoinPolicy", adminWallet)).deploy() as IJoinPolicy
        await minStakeJoinPolicy.deployed()

        maxBrokersJoinPolicy = await (await ethers.getContractFactory("MaxAmountBrokersJoinPolicy", adminWallet)).deploy() as IJoinPolicy
        await maxBrokersJoinPolicy.deployed()

        allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy", adminWallet)).deploy() as IAllocationPolicy
        await allocationPolicy.deployed()

        leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy", adminWallet)).deploy() as ILeavePolicy
        await leavePolicy.deployed()

        const bountyTemplate = await (await ethers.getContractFactory("Bounty")).deploy() as Bounty
        await bountyTemplate.deployed()

        bountyFactoryFactory = await ethers.getContractFactory("BountyFactory", adminWallet)
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
            [ bountyTemplate.address, trustedForwarderAddress, token.address ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory

        await (await token.mint(adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
        await (await token.transfer(brokerWallet.address, ethers.utils.parseEther("100000"))).wait()
        await (await token.transfer(broker2Wallet.address, ethers.utils.parseEther("100000"))).wait()
    })

    beforeEach(async (): Promise<void> => {
        const bountyDeployTx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty-" + bountyCounter++)
        const bountyDeployReceipt = await bountyDeployTx.wait()

        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        // console.log("bounty " + newBountyAddress)

        const agreementFactory = await ethers.getContractFactory("Bounty")
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty

        await(await bountyFromAdmin.setLeavePolicy(leavePolicy.address, "0")).wait()
        await(await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, "2000000000000000000")).wait()
    })

    it("positivetest deploy bounty through factory, join bounty", async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000")).wait()
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, "1")).wait()
        const tx = await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("2"), adminWallet.address)
        await tx.wait()
    })

    it("negativetest addjoinpolicy from not-admin", async function(): Promise<void> {
        await expect(bountyFromBroker.addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000"))
            .to.be.revertedWith("error_mustBeAdminRole")
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
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther("1"))).to.be.reverted
    })

    it("negativetest min stake join policy", async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000")).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_stakeUnderMinimum")
    })

    it("negativetest max brokers join policy", async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, "0")).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("0"), adminWallet.address))
            .to.be.revertedWith("error_tooManyBrokers")
    })

    it("negativetest sponsor with no allowance", async function(): Promise<void> {
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther("1"))).to.be.revertedWith("")
    })

    it("negativetest error setting param on joinpolicy", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestJoinPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testJoinPolicy = await jpMSC.connect(adminWallet).deployed() as IJoinPolicy
        await expect(bountyFromAdmin.addJoinPolicy(testJoinPolicy.address, "1")) // it will throw with 1
            .to.be.revertedWith("test-error: setting param join policy")
        await expect(bountyFromAdmin.addJoinPolicy(testJoinPolicy.address, "2")) // 2: it will throw with empty error
            .to.be.revertedWith("error_addJoinPolicyFailed")
    })

    it("negativetest error joining on joinpolicy", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestJoinPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testJoinPolicy = await jpMSC.connect(adminWallet).deployed() as IJoinPolicy
        await (await bountyFromAdmin.addJoinPolicy(testJoinPolicy.address, "100")).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, 1, adminWallet.address))
            .to.be.revertedWith("test-error: onJoin join policy")
    })

    it("negativetest error joining on joinpolicy, empty error", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestJoinPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testJoinPolicy = await jpMSC.connect(adminWallet).deployed() as IJoinPolicy
        await (await bountyFromAdmin.addJoinPolicy(testJoinPolicy.address, "100")).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, 2, adminWallet.address))
            .to.be.revertedWith("error_joinPolicyOnJoin")
    })

    it("negativetest error setting param on allocationPolicy", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await expect(bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "1")) // it will thrown with 1
            .to.be.revertedWith("test-error: setting param allocation policy")
    })

    it("negativetest error onJoin on allocationPolicy", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "2")).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("test-error: onJoin allocation policy")
    })

    it("negativetest error onJoin on allocationPolicy, empty error", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "5")).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_allocationPolicyOnJoin")
    })

    it("negativetest error onstakeIncrease", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "7")).wait()
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address)).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("test-error: onStakeIncrease allocation policy")
    })

    it("negativetest error onstakeIncrease, empty error", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "8")).wait()
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address)).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), adminWallet.address))
            .to.be.revertedWith("error_stakeIncreaseFailed")
    })

    it("negativetest error onleave on allocationPolicy", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "3")).wait() // 3 -> will throw on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), brokerWallet.address)).wait()
        await expect(bountyFromBroker.leave()).to.be.revertedWith("test-error: onLeave allocation policy")
    })

    it("negativetest error onleave on allocationPolicy, empty error", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "6")).wait() // 6 -> throw empty on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"), brokerWallet.address)).wait()
        await expect(bountyFromBroker.leave()).to.be.revertedWith("error_brokerLeaveFailed")
    })

    it("send 32 length data on transferAndCall", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "3")).wait() // 3 -> will throw on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"),
            defaultAbiCoder.encode(["address"], [brokerWallet.address]))).wait()
        expect(await bountyFromBroker.getMyStake()).to.be.equal(ethers.utils.parseEther("1"))
    })

    it("stake through stake() function", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "3")).wait() // 3 -> will throw on leave
        await (await token.approve(bountyFromAdmin.address, ethers.utils.parseEther("1"))).wait()
        await (await bountyFromAdmin.stake(brokerWallet.address, ethers.utils.parseEther("1"))).wait()
        expect(await bountyFromBroker.getMyStake()).to.be.equal(ethers.utils.parseEther("1"))
    })

    it.skip("send length data on transferAndCall", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "3")).wait() // 3 -> will throw on leave
        await (await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("1"),
            defaultAbiCoder.encode(["address"], [brokerWallet.address]))).wait()
        expect(await bountyFromBroker.getMyStake()).to.be.equal(ethers.utils.parseEther("1"))
    })

    it("handles empty errors from policies", async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory("TestAllocationPolicy", adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await expect(bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, "4"))
            .to.be.revertedWith("") // 4 -> will throw empty error
    })

    it("negativetest calling fallback function", async function(): Promise<void> {
        await expect(adminWallet.sendTransaction({to: bountyFromAdmin.address})).to.be.revertedWith("error_mustBeThis")
    })
})