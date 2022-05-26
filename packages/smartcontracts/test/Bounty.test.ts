import { waffle, upgrades, ethers } from "hardhat"
import { expect, use } from "chai"
import { Contract, ContractFactory, utils } from "ethers"

import { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, ILeavePolicy, StakeWeightedAllocationPolicy, TestToken } from "../typechain"
import { AbiCoder } from "ethers/lib/utils"

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
    let bountyFromAdmin: Bounty
    let bountyFromBroker: Bounty
    let allocationPolicy: Contract
    let leavePolicy: Contract
    let testJoinPolicy: Contract
    let testAllocationPolicy: Contract

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

        testJoinPolicy = await (await ethers.getContractFactory("TestJoinPolicy", adminWallet)).deploy() as Contract
        await testJoinPolicy.deployed()

        testAllocationPolicy = await (await ethers.getContractFactory("TestAllocationPolicy", adminWallet)).deploy() as Contract
        await testAllocationPolicy.deployed()

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

    // stakeweight or testallocpolicy params must be set
    type BaseBountyConfig = {
        minStake?: string,
        maxBrokers?: string,
        // stakeWeight?: string,
        leavePol?: string,
        testJoinPol?: string,
        // testAllocPol?: string
    }
    type BountyConfig1 = BaseBountyConfig & {
        stakeWeight: string
    }
    type BountyConfig2 = BaseBountyConfig & {
        testAllocPolicy: string
    }
    // type BountyConfig = BountyConfig1 | BountyConfig2

    const createBounty = async (config: BountyConfig1 | BountyConfig2): Promise<Bounty> => {
        const joinPolicies = []
        const joinPolicyParams = []
        if (config.minStake) {
            joinPolicies.push(minStakeJoinPolicy.address)
            joinPolicyParams.push(config.minStake)
        }
        if (config.maxBrokers) {
            joinPolicies.push(maxBrokersJoinPolicy.address)
            joinPolicyParams.push(config.maxBrokers)
        }
        if (config.testJoinPol) {
            joinPolicies.push(testJoinPolicy.address)
            joinPolicyParams.push(config.testJoinPol)
        }
        const leavePolicyParam = config.leavePol ? config.leavePol : "0"
        const allocationPolicyAddr: string = (<BountyConfig2>config).testAllocPolicy ? testAllocationPolicy.address : allocationPolicy.address
        let allocPolicyParam = ""
        if ((<BountyConfig1>config).stakeWeight !== undefined) {
            allocPolicyParam = (<BountyConfig1>config).stakeWeight
        } else {
            allocPolicyParam = (<BountyConfig2>config).testAllocPolicy
        }
        // console.log("deploying bounty with params: ", joinPolicies, joinPolicyParams, allocationPolicyAddr, allocPolicyParam)
        // const bountyDeployTx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty-" + bountyCounter++, joinPolicies,
        //     joinPolicyParams, allocationPolicyAddr, allocPolicyParam, leavePolicy.address, leavePolicyParam)
        const data = ethers.utils.defaultAbiCoder.encode(["uint", "uint", "string", "address[]", "uint[]", "address", "uint", "address", "uint"],
            [0, 0, "Bounty-" + bountyCounter++, joinPolicies, joinPolicyParams, allocationPolicyAddr,
                allocPolicyParam, leavePolicy.address, leavePolicyParam])
        const bountyDeployTx = await token.transferAndCall(bountyFactory.address, ethers.utils.parseEther("100"), data)
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        expect(newBountyAddress).to.be.not.undefined
        // console.log("bounty " + newBountyAddress)

        const agreementFactory = await ethers.getContractFactory("Bounty")
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty
        return bountyFromAdmin
    }

    it.only("positivetest atomic fund and deploy bounty", async function(): Promise<void> {
        const data = ethers.utils.defaultAbiCoder.encode(["uint", "uint", "string", "address[]", "uint[]", "address", "uint", "address", "uint"],
            [0, 0, "Bounty-" + bountyCounter++, [minStakeJoinPolicy.address], ["2000000000000000000"], 
                allocationPolicy.address, "1", leavePolicy.address, "0"])
        const bountyDeployTx = await token.transferAndCall(bountyFactory.address, ethers.utils.parseEther("100"), data)
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        expect(newBountyAddress).to.be.not.undefined
    })

    it("positivetest deploy bounty through factory, join bounty", async function(): Promise<void> {
        // await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000")).wait()
        // await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, "1")).wait()
        await createBounty({ minStake: "2000000000000000000", maxBrokers: "1", stakeWeight: "1" })
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
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther("1"))).to.be.reverted // token.transferFrom fails without revert reason string
    })

    it("negativetest min stake join policy", async function(): Promise<void> {
        // await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000")).wait()
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
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther("1"))).to.be.revertedWith("")
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
            .to.be.revertedWith("") // 4 -> will throw empty error
    })

    it("negativetest calling fallback function", async function(): Promise<void> {
        await expect(adminWallet.sendTransaction({to: bountyFromAdmin.address})).to.be.revertedWith("error_mustBeThis")
    })
})